// scripts/src/lib/catalog/__tests__/release_graph_fixture.ts
//
// Fixtures for the release-graph and legacy-catalog tests.
//
// Everything here is in-memory bytes served through a `ReleaseDocumentReader`.
// No test that uses these touches a network, a bucket or a real origin — the
// readers are pure functions over a Map.

import { createHash } from 'node:crypto';
import type { CatalogAssetEntry, ReleaseDocumentReader } from '@aikami/schemas';

export const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

export const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

/** A catalog entry, as a shard would carry it. */
export const entry = (options: {
  tag: string;
  category: string;
  hash?: string;
  sizeBytes?: number;
  ext?: string;
  licenses?: string[];
  authors?: string[];
}): CatalogAssetEntry =>
  ({
    tag: options.tag,
    hash: options.hash ?? sha256(`entry:${options.tag}`),
    sizeBytes: options.sizeBytes ?? 42,
    category: options.category,
    ext: options.ext ?? '.webp',
    licenses: options.licenses ?? ['OGA-BY 3.0'],
    authors: options.authors ?? ['bluecarrot16'],
    sourceUrls: [],
  }) as CatalogAssetEntry;

/** A compact seed row. */
export const seedRow = (options: {
  tag: string;
  hash?: string;
  category?: string;
  ext?: string;
  sizeBytes?: number;
}) => ({
  t: options.tag,
  h: options.hash ?? sha256(`entry:${options.tag}`),
  s: options.sizeBytes ?? 42,
  c: options.category ?? 'sprites',
  e: options.ext ?? '.webp',
  l: ['OGA-BY 3.0'],
});

export type GraphFixture = {
  reader: ReleaseDocumentReader;
  documents: Map<string, Uint8Array>;
  pointer: Record<string, unknown>;
  rootBody: string;
  shardBody: string;
  rootHash: string;
};

/**
 * Builds a hash-consistent immutable release graph.
 *
 * `resolveReleaseGraph` verifies the pointer, the root, every shard and every
 * pinned dependency by SHA-256, so a fixture that is not internally consistent
 * would fail for the wrong reason.
 */
export const buildReleaseGraph = (options: {
  entries: CatalogAssetEntry[];
  originUrl?: string;
  releaseId?: string;
  seed?: string;
  extraDependencies?: { key: string; body: string }[];
  /** Serve no pointer at all — a first publish. */
  omitPointer?: boolean;
  /** Serve root bytes that do not match the pinned hash. */
  corruptRoot?: boolean;
  /** Serve a pointer that is not valid JSON. */
  corruptPointer?: boolean;
  /** Drop one shard so the graph is incomplete. */
  dropShard?: boolean;
}): GraphFixture => {
  const originUrl = options.originUrl ?? 'https://assets.example.test';
  const publishedAt = '2026-01-01T00:00:00.000Z';

  const shardBody = JSON.stringify({
    schemaVersion: 1,
    publishedAt,
    originUrl,
    id: 'sprites',
    category: 'sprites',
    entries: options.entries,
  });
  const rootBody = JSON.stringify({
    schemaVersion: 1,
    publishedAt,
    originUrl,
    totalCount: options.entries.length,
    categories: [{ id: 'sprites', count: options.entries.length }],
  });
  const seedBody = options.seed ?? '{"sv":1,"g":"2026-01-01T00:00:00.000Z","o":"","r":[]}';

  const documents = new Map<string, Uint8Array>([
    ['index/v1/catalog.json', bytes(options.corruptRoot ? '{"tampered":true}' : rootBody)],
    ['index/v1/sprites.json', bytes(shardBody)],
    ['seed/asset_seed.json', bytes(seedBody)],
    ...(options.extraDependencies ?? []).map(
      (dependency) => [dependency.key, bytes(dependency.body)] as const,
    ),
  ]);

  const pointer: Record<string, unknown> = {
    schemaVersion: 'catalog.release.v1',
    releaseId: options.releaseId ?? 'release-under-test',
    rootKey: 'index/v1/catalog.json',
    rootHash: sha256(rootBody),
    shards: [{ key: 'index/v1/sprites.json', hash: sha256(shardBody), category: 'sprites' }],
    dependencies: [
      { key: 'seed/asset_seed.json', hash: sha256(seedBody) },
      ...(options.extraDependencies ?? []).map((dependency) => ({
        key: dependency.key,
        hash: sha256(dependency.body),
      })),
    ],
    publishedAt,
  };

  const reader: ReleaseDocumentReader = async (key) => {
    if (key === 'index/v1/release.json') {
      if (options.omitPointer) {
        return undefined;
      }
      return bytes(options.corruptPointer ? '{not json' : JSON.stringify(pointer));
    }
    if (options.dropShard && key === 'index/v1/sprites.json') {
      return undefined;
    }
    return documents.get(key);
  };

  return { reader, documents, pointer, rootBody, shardBody, rootHash: sha256(rootBody) };
};

export type LegacyFixture = {
  reader: ReleaseDocumentReader;
  documents: Map<string, Uint8Array>;
  rootBody: string;
  seedBody: string;
};

/**
 * Builds the legacy MUTABLE production catalog: a root index, one mutable shard
 * per category, and the compact boot seed.
 *
 * The observed production shape is reproduced deliberately — the root declares
 * a per-category count, the shards carry the entries, and the seed carries far
 * more rows than the index (12,729 vs 108 in the real state), because the seed
 * is the complete inventory and the index is a truncated browse surface.
 */
export const buildLegacyCatalog = (options: {
  originUrl?: string;
  /** Entries per category, keyed by category id. */
  categories: Record<string, CatalogAssetEntry[]>;
  /** Seed rows. Defaults to one row per entry. */
  seedRows?: ReturnType<typeof seedRow>[];
  seed?: string;
  offlineCore?: string;
  packLock?: string;
  omitRoot?: boolean;
  omitSeed?: boolean;
  /** Serve a shard whose entry count disagrees with the root's declaration. */
  miscountShard?: string;
  /** Serve a root that fails CatalogIndexRootSchema. */
  corruptRoot?: boolean;
  /** Serve a shard that is not valid JSON. */
  corruptShard?: string;
  /** Drop a shard entirely. */
  dropShard?: string;
}): LegacyFixture => {
  const originUrl = options.originUrl ?? 'https://assets.bearlysleeping.com';
  const publishedAt = '2026-08-26T15:14:18.787Z';

  const documents = new Map<string, Uint8Array>();
  const categories = Object.entries(options.categories).map(([id, entries]) => ({
    id,
    count: options.miscountShard === id ? entries.length + 1 : entries.length,
  }));

  const rootBody = JSON.stringify({
    schemaVersion: 1,
    publishedAt,
    originUrl,
    totalCount: Object.values(options.categories).reduce((sum, list) => sum + list.length, 0),
    categories,
  });

  for (const [id, entries] of Object.entries(options.categories)) {
    if (options.dropShard === id) {
      continue;
    }
    documents.set(
      `index/v1/${id}.json`,
      bytes(
        options.corruptShard === id
          ? '{not json'
          : JSON.stringify({
              schemaVersion: 1,
              publishedAt,
              originUrl,
              id,
              category: id,
              entries,
            }),
      ),
    );
  }

  const allEntries = Object.values(options.categories).flat();
  const seedRows =
    options.seedRows ??
    allEntries.map((e) => seedRow({ tag: e.tag, hash: e.hash, category: e.category, ext: e.ext }));
  const seedBody =
    options.seed ?? JSON.stringify({ sv: 1, g: publishedAt, o: originUrl, r: seedRows });
  documents.set('seed/asset_seed.json', bytes(seedBody));

  if (options.offlineCore !== undefined) {
    documents.set('seed/offline_core.json', bytes(options.offlineCore));
  }
  if (options.packLock !== undefined) {
    documents.set('index/v1/pack_lock.json', bytes(options.packLock));
  }

  const reader: ReleaseDocumentReader = async (key) => {
    if (key === 'index/v1/catalog.json') {
      return options.omitRoot
        ? undefined
        : bytes(options.corruptRoot ? '{"schemaVersion":1}' : rootBody);
    }
    if (key === 'seed/asset_seed.json' && options.omitSeed) {
      return undefined;
    }
    return documents.get(key);
  };

  return { reader, documents, rootBody, seedBody };
};
