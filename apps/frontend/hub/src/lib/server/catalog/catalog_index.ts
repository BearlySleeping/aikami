// apps/frontend/hub/src/lib/server/catalog/catalog_index.ts
//
// Server-side catalog index client (C-396 AC-2).
//
// The browse pages render from C-395's static index — never from Postgres
// (D-14, I-8). This module resolves the ACTIVE release through its versioned
// pointer (`index/v1/release.json`, C-496): the pointer pins the exact
// immutable root and shard revision keys, and the hub fetches ONLY those keys,
// SHA-256 verifying each against the pointer before it is parsed.
//
// Why the pointer and not the mutable `index/v1/<name>.json` aliases: the
// publish pipeline writes immutable `index/v1/revisions/<sha256>/<name>.json`
// objects and advances the pointer LAST; it no longer maintains the mutable
// aliases. Reading the aliases therefore only worked on origins last published
// before the C-496 migration, and a freshly published origin (staging) 404s on
// `index/v1/catalog.json`. The aliases survive here solely as the explicit
// legacy path for an origin with NO pointer at all (a genuine 404 on
// `release.json`), mirroring the client's `release_resolver.ts`.
//
// Fetch discipline (AC-2 watch point):
//   - A category page resolves the small pointer, then fetches ONLY that
//     category's shards.
//   - It never fetches another category's shards, and never the 7 MB client
//     boot manifest.
//   - The landing page fetches ONLY the root index — never a shard.
//
// Failure discipline:
//   - Fetch/validation/integrity failures throw CatalogIndexUnavailableError;
//     the load functions map that to the explicit page error state (never a
//     500).
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
  type ReleasePointer,
  ReleasePointerSchema,
} from '@aikami/schemas';
import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { CATALOG_ORIGIN_URL } from '$app/env/private';
import { logger } from '$logger';
import { resolveAssetUrl, resolveThumbnailUrl } from '$utils/catalog.ts';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Origin base URL for the catalog index (injected, never hardcoded). */
export const catalogOriginUrl = (): string => CATALOG_ORIGIN_URL ?? '';

/**
 * In-process document cache TTL. Matches the CDN's index cache-control
 * (`public, max-age=60`, C-395 AC-3) — a fetch is never re-issued within the
 * same TTL window, so a cold Worker isolate serves repeat hits from memory
 * instead of hammering the CDN.
 */
export const CATALOG_INDEX_CACHE_TTL_MS = 60_000;

/**
 * Failure cache TTL. While the origin is down, a hung/timeout fetch would
 * otherwise block every page view for the full request timeout; the negative
 * cache serves the degraded error state fast for a few seconds, then probes
 * the origin again.
 */
export const CATALOG_INDEX_FAILURE_TTL_MS = 5_000;

/** Request timeout for index fetches — a hung origin must degrade, not hang. */
const CATALOG_FETCH_TIMEOUT_MS = 10_000;

/** Versioned release pointer key (C-496) — the canonical entry point. */
const RELEASE_POINTER_KEY = 'index/v1/release.json';

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
// URLs
// ---------------------------------------------------------------------------

const stripTrailingSlash = (originUrl: string): string => originUrl.replace(/\/+$/, '');

/** URL of one legacy mutable index alias (`index/v1/<key>`). */
const indexUrl = (originUrl: string, key: string): string =>
  `${stripTrailingSlash(originUrl)}/index/v1/${key}`;

/** URL of a full catalog key, e.g. an immutable `index/v1/revisions/...` object. */
const catalogKeyUrl = (originUrl: string, key: string): string =>
  `${stripTrailingSlash(originUrl)}/${key}`;

// ---------------------------------------------------------------------------
// Fetch + cache
// ---------------------------------------------------------------------------

type CacheEntry =
  | { kind: 'ok'; fetchedAt: number; data: unknown }
  | { kind: 'absent'; fetchedAt: number }
  | { kind: 'error'; failedAt: number; error: CatalogIndexUnavailableError };

const documentCache = new Map<string, CacheEntry>();

/** In-flight promises — concurrent cold requests share one fetch (coalescing). */
const inFlight = new Map<string, Promise<unknown>>();

const isCacheFresh = (entry: CacheEntry): boolean =>
  entry.kind === 'error'
    ? Date.now() - entry.failedAt < CATALOG_INDEX_FAILURE_TTL_MS
    : Date.now() - entry.fetchedAt < CATALOG_INDEX_CACHE_TTL_MS;

/** Lowercase hex SHA-256, via WebCrypto (present in Workers and Bun). */
const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  // Copy into a fresh ArrayBuffer-backed view: `crypto.subtle.digest` requires
  // `Uint8Array<ArrayBuffer>` while callers may hand back a `Buffer`-backed
  // view typed as `Uint8Array<ArrayBufferLike>`.
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
};

type FetchedDocument = { kind: 'ok'; data: unknown } | { kind: 'absent' };

/**
 * Fetch one JSON document with timeout, status check and optional SHA-256
 * verification against a release-pinned hash. A 404 is reported as `absent`
 * rather than thrown, so a caller can tell a genuinely missing document from a
 * transport failure.
 */
const fetchDocument = async (options: {
  url: string;
  expectedHash?: string;
}): Promise<FetchedDocument> => {
  let response: Response;
  try {
    response = await fetch(options.url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(CATALOG_FETCH_TIMEOUT_MS),
    });
  } catch (cause) {
    logger.error('catalog:index fetch failed', { url: options.url, cause });
    throw new CatalogIndexUnavailableError(`Catalog index unreachable: ${options.url}`, {
      url: options.url,
      cause,
    });
  }

  if (response.status === 404) {
    return { kind: 'absent' };
  }

  if (!response.ok) {
    logger.error('catalog:index fetch failed', { url: options.url, status: response.status });
    throw new CatalogIndexUnavailableError(
      `Catalog index returned HTTP ${response.status} for ${options.url}`,
      { url: options.url, status: response.status },
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (cause) {
    logger.error('catalog:index body unreadable', { url: options.url, cause });
    throw new CatalogIndexUnavailableError(`Catalog index body unreadable: ${options.url}`, {
      url: options.url,
      cause,
    });
  }

  if (options.expectedHash !== undefined) {
    const digest = await sha256Hex(bytes);
    if (digest !== options.expectedHash) {
      logger.error('catalog:index integrity failure', {
        url: options.url,
        expectedHash: options.expectedHash,
        actualHash: digest,
      });
      throw new CatalogIndexUnavailableError(`Catalog index integrity failure: ${options.url}`, {
        url: options.url,
      });
    }
  }

  try {
    return { kind: 'ok', data: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch (cause) {
    logger.error('catalog:index invalid JSON', { url: options.url, cause });
    throw new CatalogIndexUnavailableError(`Catalog index returned invalid JSON: ${options.url}`, {
      url: options.url,
      cause,
    });
  }
};

type DocumentOptions = {
  url: string;
  schema: TSchema;
  documentName: string;
  /** When true, a 404 resolves to `undefined` instead of throwing. */
  absentOn404?: boolean;
  /** When set, the raw bytes are verified against this SHA-256 before parsing. */
  expectedHash?: string;
};

/**
 * Load one JSON document through the TTL cache, validating it once per TTL
 * window and caching the VALIDATED document (schema validation and hash
 * verification never run against a cache hit). Coalesces concurrent cold
 * requests onto one fetch, and negative-caches failures for a short failure
 * TTL. Returns `undefined` only when `absentOn404` is set and the origin
 * answered 404.
 */
const loadDocumentInternal = async <T>(options: DocumentOptions): Promise<T | undefined> => {
  const { url } = options;

  const cached = documentCache.get(url);
  if (cached && isCacheFresh(cached)) {
    if (cached.kind === 'absent') {
      return undefined;
    }
    if (cached.kind === 'error') {
      throw cached.error;
    }
    return cached.data as T;
  }

  const pending = inFlight.get(url);
  if (pending) {
    return pending as Promise<T | undefined>;
  }

  const promise = (async (): Promise<T | undefined> => {
    try {
      const fetched = await fetchDocument({ url, expectedHash: options.expectedHash });
      if (fetched.kind === 'absent') {
        if (options.absentOn404) {
          documentCache.set(url, { kind: 'absent', fetchedAt: Date.now() });
          return undefined;
        }
        throw new CatalogIndexUnavailableError(`Catalog index returned HTTP 404 for ${url}`, {
          url,
          status: 404,
        });
      }
      if (!Value.Check(options.schema, fetched.data)) {
        logger.error('catalog:index failed schema validation', {
          url,
          documentName: options.documentName,
        });
        throw new CatalogIndexUnavailableError(`${options.documentName} failed schema validation`, {
          url,
        });
      }
      documentCache.set(url, { kind: 'ok', fetchedAt: Date.now(), data: fetched.data });
      return fetched.data as T;
    } catch (cause) {
      const error =
        cause instanceof CatalogIndexUnavailableError
          ? cause
          : new CatalogIndexUnavailableError(`Catalog index unavailable: ${url}`, { url, cause });
      documentCache.set(url, { kind: 'error', failedAt: Date.now(), error });
      throw error;
    } finally {
      inFlight.delete(url);
    }
  })();

  inFlight.set(url, promise);
  return promise;
};

/** Load a document that must exist; a 404 throws CatalogIndexUnavailableError. */
const loadDocument = async <T>(options: DocumentOptions): Promise<T> => {
  const document = await loadDocumentInternal<T>(options);
  if (document === undefined) {
    // Unreachable: without `absentOn404`, a 404 throws inside loadDocumentInternal.
    throw new CatalogIndexUnavailableError(`${options.documentName} unavailable`, {
      url: options.url,
    });
  }
  return document;
};

/** Load a document that may legitimately be absent (404 → undefined). */
const loadOptionalDocument = async <T>(options: DocumentOptions): Promise<T | undefined> =>
  await loadDocumentInternal<T>({ ...options, absentOn404: true });

/** Clear the in-process cache — used by tests. */
export const clearCatalogIndexCache = (): void => {
  documentCache.clear();
  inFlight.clear();
};

// ---------------------------------------------------------------------------
// Release resolution
// ---------------------------------------------------------------------------

/**
 * Fetch + validate the active release pointer, or `undefined` when the origin
 * has no pointer at all (the explicit legacy path). A corrupt pointer throws —
 * it is never silently treated as "no release".
 */
const fetchReleasePointer = async (originUrl: string): Promise<ReleasePointer | undefined> =>
  await loadOptionalDocument<ReleasePointer>({
    url: catalogKeyUrl(originUrl, RELEASE_POINTER_KEY),
    schema: ReleasePointerSchema,
    documentName: 'Catalog release pointer',
  });

// ---------------------------------------------------------------------------
// Index documents
// ---------------------------------------------------------------------------

/**
 * Fetch + validate the root index document. The active release's pinned,
 * hash-verified revision is preferred; an origin with no pointer falls back to
 * the mutable legacy `index/v1/catalog.json` alias.
 */
export const fetchRootIndex = async (): Promise<CatalogIndexRoot> => {
  const originUrl = catalogOriginUrl();
  if (!originUrl) {
    throw new CatalogIndexUnavailableError(
      'Catalog index is not configured: CATALOG_ORIGIN_URL is unset',
    );
  }

  const pointer = await fetchReleasePointer(originUrl);
  if (pointer) {
    return await loadDocument<CatalogIndexRoot>({
      url: catalogKeyUrl(originUrl, pointer.rootKey),
      schema: CatalogIndexRootSchema,
      documentName: 'Catalog root index',
      expectedHash: pointer.rootHash,
    });
  }

  return await loadDocument<CatalogIndexRoot>({
    url: indexUrl(originUrl, 'catalog.json'),
    schema: CatalogIndexRootSchema,
    documentName: 'Catalog root index',
  });
};

/** Shard ids for one category: the category id itself plus any split shards. */
const categoryShardIds = (root: CatalogIndexRoot, category: string): string[] =>
  root.categories
    .map((row) => row.id)
    .filter((id) => id === category || id.startsWith(`${category}__`));

/** A resolved shard document: where to fetch it and its pinned hash, if any. */
type ShardReference = {
  id: string;
  url: string;
  expectedHash?: string;
};

/**
 * Resolve the shard documents that make up one category. The active release's
 * pinned keys are preferred; an origin with no pointer falls back to the
 * mutable legacy aliases discovered from the root index. Returns `undefined`
 * when the category has no shard in the index (the load turns that into a 404).
 */
const resolveShardReferences = async (options: {
  originUrl: string;
  category: string;
}): Promise<ShardReference[] | undefined> => {
  const pointer = await fetchReleasePointer(options.originUrl);
  if (pointer) {
    // The pointer's `category` field is the shard id (`lpc` or `lpc__<fragment>`),
    // exactly like the root's `categories[].id`, so the same prefix rule applies.
    const matches = pointer.shards.filter(
      (shard) =>
        shard.category === options.category || shard.category.startsWith(`${options.category}__`),
    );
    if (matches.length === 0) {
      return undefined;
    }
    return matches.map((shard) => ({
      id: shard.category,
      url: catalogKeyUrl(options.originUrl, shard.key),
      expectedHash: shard.hash,
    }));
  }

  const root = await fetchRootIndex();
  const shardIds = categoryShardIds(root, options.category);
  if (shardIds.length === 0) {
    return undefined;
  }
  return shardIds.map((id) => ({
    id,
    url: indexUrl(options.originUrl, `${id}.json`),
  }));
};

// ---------------------------------------------------------------------------
// Category queries
// ---------------------------------------------------------------------------

/**
 * All entries for one category, merged from every shard whose id equals the
 * category or starts with `<category>__`. Resolves the active release pointer
 * (or the legacy root index when none exists) and fetches only this category's
 * shards.
 *
 * @returns `undefined` when the category has no shard in the index (the
 *   load turns that into a 404).
 */
export const getCategoryEntries = async (
  category: string,
): Promise<{ entries: readonly CatalogAssetEntry[]; originUrl: string } | undefined> => {
  const originUrl = catalogOriginUrl();
  if (!originUrl) {
    throw new CatalogIndexUnavailableError(
      'Catalog index is not configured: CATALOG_ORIGIN_URL is unset',
    );
  }

  const references = await resolveShardReferences({ originUrl, category });
  if (!references) {
    return undefined;
  }

  const shards = await Promise.all(
    references.map((reference) =>
      loadDocument<CatalogIndexShard>({
        url: reference.url,
        schema: CatalogIndexShardSchema,
        documentName: `Catalog shard ${reference.id}`,
        expectedHash: reference.expectedHash,
      }),
    ),
  );

  // Single-origin invariant: every shard of one publish shares the same
  // originUrl. A partial republish must not silently resolve later shards'
  // assets/thumbnails against the first shard's origin (D-14, AC-5).
  const shardOriginUrl = shards[0]?.originUrl ?? originUrl;
  if (shards.some((shard) => shard.originUrl !== shardOriginUrl)) {
    logger.error('catalog:shard origin mismatch', { category, originUrl: shardOriginUrl });
    throw new CatalogIndexUnavailableError(
      `Catalog shards for "${category}" disagree on originUrl — refusing to merge`,
    );
  }

  const entries = shards.flatMap((shard) => shard.entries);
  return { entries, originUrl: shardOriginUrl };
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
