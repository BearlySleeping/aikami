// scripts/src/lib/catalog/index_generation.ts
//
// Catalog index generation (C-395 AC-2).
//
// Produces two kinds of documents, written into the bucket under index/v1/:
//   - catalog.json      → CatalogIndexRootSchema  — category summaries ONLY.
//   - <shard>.json      → CatalogIndexShardSchema — per-asset entries.
//
// Size budgets (asserted in index_generation.test.ts, not in review
// comments): the root index must stay under 256 KB gzipped and each shard
// under 1 MB gzipped. The 7 MB manifest.json for the same 12,707 assets is
// the warning this design answers: per-asset entries belong in shards
// fetched on demand. If a category's shard exceeds 1 MB (LPC will), it is
// split further by subcategory — never shipped as a 7 MB browse document.
//
// The index is written by the publish orchestrator AFTER every object it
// references is confirmed uploaded — an index referencing a hash that failed
// to upload is worse than no index (it produces 404s the client will cache).

import { gzipSync } from 'node:zlib';
import {
  type CatalogCategory,
  type CatalogIndexRoot,
  CatalogIndexRootSchema,
  type CatalogIndexShard,
  CatalogIndexShardSchema,
} from '@aikami/schemas';
import { Value } from 'typebox/value';
import type { CatalogEntry } from './catalog_entries.ts';

export type { CatalogIndexRoot, CatalogIndexShard };

// ---------------------------------------------------------------------------
// Size budgets
// ---------------------------------------------------------------------------

/** Root index budget — must stay under 256 KB gzipped (AC-2). */
export const ROOT_INDEX_MAX_GZIP_BYTES = 256 * 1024;

/** Category shard budget — must stay under 1 MB gzipped (AC-2). */
export const SHARD_MAX_GZIP_BYTES = 1024 * 1024;

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** One generated index document. */
export type GeneratedShard = {
  /** Shard id — the category, or `<category>__<subcategory>` for splits. */
  id: string;
  /** Category this shard covers. */
  category: string;
  /** Object key under the bucket. */
  key: string;
  /** JSON bytes (pretty-printed). */
  json: string;
  /** Gzipped byte size (budget check). */
  gzipBytes: number;
};

const gzipBytes = (json: string): number => gzipSync(Buffer.from(json, 'utf8')).byteLength;

const entryToShardEntry = (entry: CatalogEntry) => ({
  tag: entry.tag,
  hash: entry.hash,
  sizeBytes: entry.sizeBytes,
  // Manifest categories are exactly the six scan categories (tilesets are
  // excluded upstream) — narrow to the schema union for validation.
  category: entry.category as CatalogCategory,
  ...(entry.subcategory ? { subcategory: entry.subcategory } : {}),
  ext: entry.ext,
  licenses: [...entry.licenses],
  authors: [...entry.authors],
  sourceUrls: [...entry.sourceUrls],
  ...(entry.licenseNote ? { licenseNote: entry.licenseNote } : {}),
  // C-396 AC-5: the thumbnail phase attaches this after generating the
  // single-frame preview; entries without one simply omit the field.
  ...(entry.thumbnailHash ? { thumbnailHash: entry.thumbnailHash } : {}),
});

/**
 * Sanitize a subcategory path into a url-safe, collision-free shard id
 * fragment. Alphanumerics are kept verbatim; every other character is
 * encoded as `-xx-` (lowercase hex), so distinct subcategories such as
 * "a/b" and "a-b" ALWAYS produce distinct fragments — the old scheme
 * collapsed both to "a-b", which collides shard ids and R2 keys.
 */
const shardIdFragment = (subcategory: string): string =>
  subcategory
    .split('')
    .map((char) =>
      /[a-zA-Z0-9]/.test(char) ? char : `-${char.charCodeAt(0).toString(16).padStart(2, '0')}-`,
    )
    .join('');

const buildShardDocument = (options: {
  id: string;
  category: CatalogCategory;
  entries: readonly CatalogEntry[];
  publishedAt: string;
  originUrl: string;
}): CatalogIndexShard => {
  const { id, category, entries, publishedAt, originUrl } = options;
  const shard: CatalogIndexShard = {
    schemaVersion: 1,
    publishedAt,
    originUrl,
    id,
    category,
    entries: entries.map(entryToShardEntry),
  };
  if (!Value.Check(CatalogIndexShardSchema, shard)) {
    throw new Error(`Generated shard ${id} failed CatalogIndexShardSchema validation`);
  }
  return shard;
};

/**
 * Generate the root index and category shards for a catalog entry list.
 *
 * Splits any category whose gzipped shard exceeds SHARD_MAX_GZIP_BYTES by
 * subcategory (entries without a subcategory group under `__base`).
 *
 * @returns The root document + every shard, each with its object key and
 *   measured gzipped size.
 */
export const generateCatalogIndex = (options: {
  entries: readonly CatalogEntry[];
  originUrl: string;
  publishedAt?: string;
}): { root: CatalogIndexRoot; shards: GeneratedShard[] } => {
  const { entries, originUrl } = options;
  const publishedAt = options.publishedAt ?? new Date().toISOString();

  const byCategory = new Map<string, CatalogEntry[]>();
  for (const entry of entries) {
    const list = byCategory.get(entry.category) ?? [];
    list.push(entry);
    byCategory.set(entry.category, list);
  }

  const shards: GeneratedShard[] = [];
  const categories: CatalogIndexRoot['categories'] = [];

  for (const [category, categoryEntries] of [...byCategory.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const wholeShard = buildShardDocument({
      id: category,
      category: category as CatalogCategory,
      entries: categoryEntries,
      publishedAt,
      originUrl,
    });
    const wholeJson = JSON.stringify(wholeShard, null, 2);

    if (gzipBytes(wholeJson) <= SHARD_MAX_GZIP_BYTES) {
      shards.push({
        id: category,
        category,
        key: `index/v1/${category}.json`,
        json: wholeJson,
        gzipBytes: gzipBytes(wholeJson),
      });
      categories.push({ id: category, count: categoryEntries.length });
      continue;
    }

    // Over budget — split by subcategory.
    const bySubcategory = new Map<string, CatalogEntry[]>();
    for (const entry of categoryEntries) {
      const group = entry.subcategory ?? '__base';
      const list = bySubcategory.get(group) ?? [];
      list.push(entry);
      bySubcategory.set(group, list);
    }
    for (const [subcategory, subEntries] of [...bySubcategory.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      const id = `${category}__${shardIdFragment(subcategory)}`;
      const shard = buildShardDocument({
        id,
        category: category as CatalogCategory,
        entries: subEntries,
        publishedAt,
        originUrl,
      });
      const json = JSON.stringify(shard, null, 2);
      const size = gzipBytes(json);
      if (size > SHARD_MAX_GZIP_BYTES) {
        throw new Error(
          `Category ${category} subcategory shard ${id} is ${size} bytes gzipped — over the 1 MB budget`,
        );
      }
      shards.push({ id, category, key: `index/v1/${id}.json`, json, gzipBytes: size });
      categories.push({ id, count: subEntries.length });
    }
  }

  const root: CatalogIndexRoot = {
    schemaVersion: 1,
    publishedAt,
    originUrl,
    totalCount: entries.length,
    categories,
  };
  if (!Value.Check(CatalogIndexRootSchema, root)) {
    throw new Error('Generated root index failed CatalogIndexRootSchema validation');
  }

  return { root, shards };
};
