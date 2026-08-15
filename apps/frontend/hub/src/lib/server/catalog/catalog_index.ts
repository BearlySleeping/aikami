// apps/frontend/hub/src/lib/server/catalog/catalog_index.ts
//
// Server-side catalog index client (C-396 AC-2).
//
// The browse pages render from C-395's static index — never from Postgres
// (D-14, I-8). This module fetches the root index and per-category shards
// from the configured origin (CATALOG_ORIGIN_URL), validates every document
// against the shared TypeBox schemas, and caches documents in-process with a
// short TTL matching the CDN's `public, max-age=60` index cache.
//
// Fetch discipline (AC-2 watch point):
//   - A category page fetches the small root index to DISCOVER its shard ids
//     (a category may be split into `lpc__<fragment>` shards), then fetches
//     ONLY that category's shards.
//   - It never fetches another category's shards, and never the 7 MB client
//     boot manifest.
//   - The landing page fetches ONLY the root index — never a shard.
//
// Failure discipline:
//   - Fetch/validation failures throw CatalogIndexUnavailableError; the load
//     functions map that to the explicit page error state (never a 500).
//   - Fetch failures are logged at `error` with the URL and status
//     (Observability requirement).
//
// No R2 credential, no database client and no write key ever touch this
// module (I-1, I-7) — it only ever performs public GETs against the CDN.

import {
  type CatalogAssetEntry,
  type CatalogIndexRoot,
  CatalogIndexRootSchema,
  type CatalogIndexShard,
  CatalogIndexShardSchema,
} from '@aikami/schemas';
import { Value } from 'typebox/value';
import { env } from '$env/dynamic/private';
import { logger } from '$logger';
import { resolveAssetUrl, resolveThumbnailUrl } from '$utils/catalog.ts';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Origin base URL for the catalog index (injected, never hardcoded). */
export const catalogOriginUrl = (): string => env.CATALOG_ORIGIN_URL ?? '';

/**
 * In-process document cache TTL. Matches the CDN's index cache-control
 * (`public, max-age=60`, C-395 AC-3) — a fetch is never re-issued within the
 * same TTL window, so a cold Cloud Run instance serves repeat hits from
 * memory instead of hammering the CDN.
 */
export const CATALOG_INDEX_CACHE_TTL_MS = 60_000;

/** Request timeout for index fetches — a hung origin must degrade, not hang. */
const CATALOG_FETCH_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The catalog index is unreachable, unconfigured, or failed schema validation. */
export class CatalogIndexUnavailableError extends Error {
  readonly url?: string;
  readonly status?: number;

  constructor(message: string, options?: { url?: string; status?: number; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = 'CatalogIndexUnavailableError';
    this.url = options?.url;
    this.status = options?.status;
  }
}

// ---------------------------------------------------------------------------
// Fetch + cache
// ---------------------------------------------------------------------------

type CacheEntry = {
  fetchedAt: number;
  data: unknown;
};

const documentCache = new Map<string, CacheEntry>();

const isCacheFresh = (entry: CacheEntry): boolean =>
  Date.now() - entry.fetchedAt < CATALOG_INDEX_CACHE_TTL_MS;

/** Fetch one JSON document with timeout + status check. */
const fetchJson = async (url: string): Promise<unknown> => {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(CATALOG_FETCH_TIMEOUT_MS),
    });
  } catch (cause) {
    logger.error('catalog:index fetch failed', { url, cause });
    throw new CatalogIndexUnavailableError(`Catalog index unreachable: ${url}`, { url, cause });
  }

  if (!response.ok) {
    logger.error('catalog:index fetch failed', { url, status: response.status });
    throw new CatalogIndexUnavailableError(
      `Catalog index returned HTTP ${response.status} for ${url}`,
      { url, status: response.status },
    );
  }

  try {
    return (await response.json()) as unknown;
  } catch (cause) {
    logger.error('catalog:index invalid JSON', { url, cause });
    throw new CatalogIndexUnavailableError(`Catalog index returned invalid JSON: ${url}`, {
      url,
      cause,
    });
  }
};

/** Fetch a JSON document through the in-process TTL cache. */
const fetchCached = async (url: string): Promise<unknown> => {
  const cached = documentCache.get(url);
  if (cached && isCacheFresh(cached)) {
    return cached.data;
  }
  const data = await fetchJson(url);
  documentCache.set(url, { fetchedAt: Date.now(), data });
  return data;
};

/** Clear the in-process cache — used by tests. */
export const clearCatalogIndexCache = (): void => {
  documentCache.clear();
};

// ---------------------------------------------------------------------------
// Index documents
// ---------------------------------------------------------------------------

const indexUrl = (originUrl: string, key: string): string =>
  `${originUrl.replace(/\/+$/, '')}/index/v1/${key}`;

/** Fetch + validate the root index document. */
export const fetchRootIndex = async (): Promise<CatalogIndexRoot> => {
  const originUrl = catalogOriginUrl();
  if (!originUrl) {
    throw new CatalogIndexUnavailableError(
      'Catalog index is not configured: CATALOG_ORIGIN_URL is unset',
    );
  }
  const url = indexUrl(originUrl, 'catalog.json');
  const raw = await fetchCached(url);
  if (!Value.Check(CatalogIndexRootSchema, raw)) {
    logger.error('catalog:root index failed schema validation', { url });
    throw new CatalogIndexUnavailableError('Catalog root index failed schema validation', { url });
  }
  return raw;
};

/** Fetch + validate one category shard document. */
export const fetchShard = async (shardId: string): Promise<CatalogIndexShard> => {
  const originUrl = catalogOriginUrl();
  if (!originUrl) {
    throw new CatalogIndexUnavailableError(
      'Catalog index is not configured: CATALOG_ORIGIN_URL is unset',
    );
  }
  const url = indexUrl(originUrl, `${shardId}.json`);
  const raw = await fetchCached(url);
  if (!Value.Check(CatalogIndexShardSchema, raw)) {
    logger.error('catalog:shard failed schema validation', { url, shardId });
    throw new CatalogIndexUnavailableError(`Catalog shard ${shardId} failed schema validation`, {
      url,
    });
  }
  return raw;
};

// ---------------------------------------------------------------------------
// Category queries
// ---------------------------------------------------------------------------

/** Shard ids for one category: the category id itself plus any split shards. */
export const categoryShardIds = (root: CatalogIndexRoot, category: string): string[] =>
  root.categories
    .map((row) => row.id)
    .filter((id) => id === category || id.startsWith(`${category}__`));

/**
 * All entries for one category, merged from every shard whose id equals the
 * category or starts with `<category>__`. Fetches the root index (to
 * discover split-shard ids) plus only this category's shards.
 *
 * @returns `undefined` when the category has no shard in the index (the
 *   load turns that into a 404).
 */
export const getCategoryEntries = async (
  category: string,
): Promise<{ entries: readonly CatalogAssetEntry[]; originUrl: string } | undefined> => {
  const root = await fetchRootIndex();
  const shardIds = categoryShardIds(root, category);
  if (shardIds.length === 0) {
    return undefined;
  }

  const shards = await Promise.all(shardIds.map((id) => fetchShard(id)));
  const entries = shards.flatMap((shard) => shard.entries);
  return { entries, originUrl: shards[0]?.originUrl ?? root.originUrl };
};

/** One asset entry by tag, resolved within its category shard. */
export const getAssetEntry = async (
  category: string,
  tag: string,
): Promise<{ entry: CatalogAssetEntry; originUrl: string } | undefined> => {
  const categoryData = await getCategoryEntries(category);
  if (!categoryData) {
    return undefined;
  }
  const entry = categoryData.entries.find((candidate) => candidate.tag === tag);
  return entry ? { entry, originUrl: categoryData.originUrl } : undefined;
};

/** Resolve the thumbnail URL for an entry, or undefined when it has none. */
export { resolveAssetUrl, resolveThumbnailUrl };
