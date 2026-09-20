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
  type CatalogAssetEntry,
  type CatalogCategory,
  type CatalogIndexRoot,
  CatalogIndexRootSchema,
  type CatalogIndexShard,
  CatalogIndexShardSchema,
} from '@aikami/schemas';
import { Value } from 'typebox/value';
import type { CatalogEntry } from './catalog_entries.ts';
import { type MergeReport, mergeCatalogEntries } from './published_catalog.ts';

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

export const entryToShardEntry = (entry: CatalogEntry) => ({
  tag: entry.tag,
  hash: entry.hash,
  sizeBytes: entry.sizeBytes,
  // Manifest categories are exactly the scan categories (tilesets are
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
  /** Already-projected shard entries, in the final wire shape. */
  entries: readonly CatalogAssetEntry[];
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
    entries: [...entries],
  };
  if (!Value.Check(CatalogIndexShardSchema, shard)) {
    throw new Error(`Generated shard ${id} failed CatalogIndexShardSchema validation`);
  }
  return shard;
};

/**
 * One category's entries, grouped. Insertion order is the merged entry order.
 */
const groupByCategory = (
  entries: readonly CatalogAssetEntry[],
): Map<string, CatalogAssetEntry[]> => {
  const byCategory = new Map<string, CatalogAssetEntry[]>();
  for (const entry of entries) {
    const list = byCategory.get(entry.category) ?? [];
    list.push(entry);
    byCategory.set(entry.category, list);
  }
  return byCategory;
};

type ShardedCategory = {
  shards: GeneratedShard[];
  categories: CatalogIndexRoot['categories'];
};

/**
 * Shards ONE category: the whole category when it fits the gzip budget,
 * otherwise split by subcategory.
 */
const shardCategory = (options: {
  category: string;
  entries: readonly CatalogAssetEntry[];
  publishedAt: string;
  originUrl: string;
}): ShardedCategory => {
  const { category, entries, publishedAt, originUrl } = options;
  const wholeJson = JSON.stringify(
    buildShardDocument({
      id: category,
      category: category as CatalogCategory,
      entries,
      publishedAt,
      originUrl,
    }),
    null,
    2,
  );
  const wholeSize = gzipBytes(wholeJson);
  if (wholeSize <= SHARD_MAX_GZIP_BYTES) {
    return {
      shards: [
        {
          id: category,
          category,
          key: `index/v1/${category}.json`,
          json: wholeJson,
          gzipBytes: wholeSize,
        },
      ],
      categories: [{ id: category, count: entries.length }],
    };
  }
  return splitCategoryBySubcategory(options);
};

/** Over budget — split by subcategory, refusing a subcategory that is still too big. */
const splitCategoryBySubcategory = (options: {
  category: string;
  entries: readonly CatalogAssetEntry[];
  publishedAt: string;
  originUrl: string;
}): ShardedCategory => {
  const { category, publishedAt, originUrl } = options;
  const bySubcategory = new Map<string, CatalogAssetEntry[]>();
  for (const entry of options.entries) {
    const group = entry.subcategory ?? '__base';
    bySubcategory.set(group, [...(bySubcategory.get(group) ?? []), entry]);
  }

  const shards: GeneratedShard[] = [];
  const categories: CatalogIndexRoot['categories'] = [];
  const groups = [...bySubcategory.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [subcategory, subEntries] of groups) {
    const id = `${category}__${shardIdFragment(subcategory)}`;
    const json = JSON.stringify(
      buildShardDocument({
        id,
        category: category as CatalogCategory,
        entries: subEntries,
        publishedAt,
        originUrl,
      }),
      null,
      2,
    );
    const size = gzipBytes(json);
    if (size > SHARD_MAX_GZIP_BYTES) {
      throw new Error(
        `Category ${category} subcategory shard ${id} is ${size} bytes gzipped — over the 1 MB budget`,
      );
    }
    shards.push({ id, category, key: `index/v1/${id}.json`, json, gzipBytes: size });
    categories.push({ id, count: subEntries.length });
  }
  return { shards, categories };
};

/**
 * Generate the root index and category shards for a catalog entry list.
 *
 * Splits any category whose gzipped shard exceeds SHARD_MAX_GZIP_BYTES by
 * subcategory (entries without a subcategory group under `__base`).
 *
 * @param options.carriedEntries - Entries the published catalog already carries
 *   that this publish does not produce. They are unioned back in (see
 *   {@link mergeCatalogEntries}) so a pack-scoped publish cannot truncate the catalog.
 * @returns The root document + every shard, each with its object key and
 *   measured gzipped size.
 */
export const generateCatalogIndex = (options: {
  entries: readonly CatalogEntry[];
  originUrl: string;
  publishedAt?: string;
  /**
   * Entries the published release already carries that this candidate does not
   * produce. Unioned back in (see `mergeCatalogEntries`) so a pack-scoped
   * publish cannot truncate the catalog.
   */
  carriedEntries?: readonly CatalogAssetEntry[];
  /**
   * Tags explicitly declared retired. Without one, a tag absent from `entries`
   * is CARRIED FORWARD — a de-bundled checkout is not evidence of intent to
   * delete.
   */
  retireTags?: readonly string[];
}): {
  root: CatalogIndexRoot;
  shards: GeneratedShard[];
  merge: MergeReport;
} => {
  const { entries, originUrl } = options;
  const publishedAt = options.publishedAt ?? new Date().toISOString();

  // Merge GLOBALLY, before sharding, so the merge report describes the whole
  // release and a retirement cannot be half-applied across shards.
  const { entries: merged, report: merge } = mergeCatalogEntries({
    local: entries.map(entryToShardEntry),
    carried: options.carriedEntries ?? [],
    retire: options.retireTags,
  });

  const byCategory = groupByCategory(merged);

  const shards: GeneratedShard[] = [];
  const categories: CatalogIndexRoot['categories'] = [];

  for (const category of [...byCategory.keys()].sort((a, b) => a.localeCompare(b))) {
    const sharded = shardCategory({
      category,
      entries: byCategory.get(category) ?? [],
      publishedAt,
      originUrl,
    });
    shards.push(...sharded.shards);
    categories.push(...sharded.categories);
  }

  const root: CatalogIndexRoot = {
    schemaVersion: 1,
    publishedAt,
    originUrl,
    // Count the MERGED set, not the local candidate: the root's totalCount is
    // what a client uses to size its download, and reporting the local subset
    // would advertise a catalog that does not exist.
    totalCount: merged.length,
    categories,
  };
  if (!Value.Check(CatalogIndexRootSchema, root)) {
    throw new Error('Generated root index failed CatalogIndexRootSchema validation');
  }

  return { root, shards, merge };
};
