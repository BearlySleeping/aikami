// packages/frontend/storage/src/lib/__tests__/assets_registry.test.ts
//
// C-373 AC-1 / C-435: AssetRegistryRepository — seeding from the compact boot
// seed, source derivation, upsert idempotency, the meta guard, querying, and
// install-state bookkeeping over the WASM in-memory DB.
//
// Tests:
// - seedFromCompactSeed populates assets + asset_sources in one pass
// - De-bundled assets get r2 at priority 0; offline-core assets get bundled at
//   priority 0 with r2 behind it, and pack_id 'core' so LRU skips them
// - Bundled URLs invert the tag correctly, including LPC state suffixes
// - Stale pre-C-435 bundled rows are pruned rather than left to 404 first
// - Re-seeding is idempotent; a hash change bumps version and reports it
// - meta.asset_registry_seeded guard (isSeeded) covers the derivation revision
// - findById / list / listSources return correct rows
// - Install-state transitions + resetInterruptedDownloads

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { AssetSeedDocument, AssetSeedRow } from '@aikami/types';
import { AssetRegistryRepository, BUNDLED_SOURCE_BACKEND } from '../assets.ts';
import { AIKAMI_MIGRATIONS } from '../migrations.ts';
import { WasmStorageAdapter } from '../wasm_storage_adapter.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

const R2_BASE = 'https://assets.bearlysleeping.com';

const HERO: AssetSeedRow = {
  tag: 'sprites:generic-fantasy:hero',
  hash: HASH_A,
  sizeBytes: 1024,
  category: 'sprites',
  ext: '.png',
};

const FOREST: AssetSeedRow = {
  tag: 'music:exploration:forest',
  hash: HASH_B,
  sizeBytes: 2048,
  category: 'music',
  ext: '.mp3',
};

/** LPC row — its trailing `walk` segment is a filename suffix, not a directory. */
const BODY_WALK: AssetSeedRow = {
  tag: 'lpc:body:bodies_male:walk',
  hash: HASH_C,
  sizeBytes: 4096,
  category: 'lpc',
  ext: '.webp',
};

const makeSeed = (
  rows: readonly AssetSeedRow[] = [HERO, FOREST, BODY_WALK],
  overrides?: Partial<AssetSeedDocument>,
): AssetSeedDocument => ({
  schemaVersion: 1,
  generatedAt: '2026-08-23T00:00:00.000Z',
  originUrl: R2_BASE,
  rows,
  ...overrides,
});

/** Content-addressed R2 URL, mirroring the C-395 published layout. */
const r2Url = (hash: string, ext: string): string =>
  `${R2_BASE}/assets/${hash.slice(0, 2)}/${hash}${ext}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createRegistry = async (): Promise<{
  db: WasmStorageAdapter;
  registry: AssetRegistryRepository;
}> => {
  const db = new WasmStorageAdapter({ databasePath: ':memory:' });
  await db.open();
  for (const ddl of AIKAMI_MIGRATIONS[0].statements) {
    await db.execute({ sql: ddl, args: [] });
  }
  return { db, registry: new AssetRegistryRepository(db) };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AssetRegistryRepository', () => {
  let db: WasmStorageAdapter;
  let registry: AssetRegistryRepository;

  beforeEach(async () => {
    ({ db, registry } = await createRegistry());
  });

  afterEach(async () => {
    await db.close();
  });

  // ── Seeding + source derivation ──────────────────────────────────────

  test('seedFromCompactSeed populates assets and their rows', async () => {
    const stats = await registry.seedFromCompactSeed({ seed: makeSeed(), r2BaseUrl: R2_BASE });

    expect(stats.seeded).toBe(3);
    expect(stats.updated).toBe(0);
    expect(stats.unchanged).toBe(0);
    expect(stats.skipped).toBe(0);

    const hero = await registry.findById(HERO.tag);
    expect(hero).toBeDefined();
    expect(hero?.hash).toBe(HASH_A);
    expect(hero?.sizeBytes).toBe(1024);
    expect(hero?.version).toBe(1);
    expect(hero?.category).toBe('sprites');
    expect(hero?.license).toBe('unknown');

    expect(await registry.list()).toHaveLength(3);
    expect(await registry.isSeeded('2026-08-23T00:00:00.000Z')).toBe(true);
  });

  test('de-bundled assets resolve from R2 at priority 0', async () => {
    await registry.seedFromCompactSeed({ seed: makeSeed(), r2BaseUrl: R2_BASE });

    const sources = await registry.listSources(FOREST.tag);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.backend).toBe('r2');
    expect(sources[0]?.priority).toBe(0);
    expect(sources[0]?.url).toBe(r2Url(HASH_B, '.mp3'));

    // pack_id stays the category so LRU eviction can reach it.
    expect((await registry.findById(FOREST.tag))?.packId).toBe('music');
  });

  test('every asset gets a single R2 source at priority 0 (nothing is bundled)', async () => {
    await registry.seedFromCompactSeed({
      seed: makeSeed(),
      r2BaseUrl: R2_BASE,
      bundledTags: [HERO.tag, BODY_WALK.tag],
    });

    const sources = await registry.listSources(HERO.tag);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.backend).toBe('r2');
    expect(sources[0]?.priority).toBe(0);
    expect(sources[0]?.url).toBe(r2Url(HASH_A, '.png'));

    // Core assets are packed as 'core' so the eviction guard is a single id.
    expect((await registry.findById(HERO.tag))?.packId).toBe('core');

    // Core assets are packed as 'core' so the eviction guard is a single id.
    expect((await registry.findById(BODY_WALK.tag))?.packId).toBe('core');
  });

  test('LPC assets resolve to content-addressed R2 URLs', async () => {
    await registry.seedFromCompactSeed({
      seed: makeSeed(),
      r2BaseUrl: R2_BASE,
      bundledTags: [BODY_WALK.tag],
    });

    const sources = await registry.listSources(BODY_WALK.tag);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.backend).toBe('r2');
    expect(sources[0]?.url).toBe(r2Url(HASH_C, '.webp'));
  });

  test('stale pre-C-435 bundled rows are pruned for every asset', async () => {
    // Simulate a registry seeded before de-bundling: every asset carries a
    // priority-0 bundled row pointing at a file that no longer ships.
    await registry.seedFromCompactSeed({ seed: makeSeed() });
    for (const row of [HERO, FOREST, BODY_WALK]) {
      await db.execute({
        sql: `INSERT OR REPLACE INTO asset_sources (asset_id, backend, url, priority)
              VALUES (?, ?, ?, 0)`,
        args: [row.tag, BUNDLED_SOURCE_BACKEND, `/game-data/legacy/${row.tag}`],
      });
    }

    // The upgrade boot re-seeds against the same document.
    await registry.seedFromCompactSeed({
      seed: makeSeed(),
      r2BaseUrl: R2_BASE,
      bundledTags: [HERO.tag],
    });

    // All stale bundled rows are pruned — even for core assets (nothing is
    // bundled anymore). Every asset now resolves from R2 only.
    const heroSources = await registry.listSources(HERO.tag);
    expect(heroSources).toHaveLength(1);
    expect(heroSources[0]?.backend).toBe('r2');

    const forestSources = await registry.listSources(FOREST.tag);
    expect(forestSources).toHaveLength(1);
    expect(forestSources[0]?.backend).toBe('r2');
  });

  test('no R2 origin writes no sources at all', async () => {
    await registry.seedFromCompactSeed({ seed: makeSeed(), bundledTags: [HERO.tag] });

    // Without an R2 origin, no sources are written — nothing is bundled.
    expect(await registry.listSources(HERO.tag)).toHaveLength(0);
    expect(await registry.listSources(FOREST.tag)).toHaveLength(0);
  });

  // ── Idempotency + versioning ─────────────────────────────────────────

  test('re-seeding with identical hashes is idempotent — no version bumps', async () => {
    const seed = makeSeed();
    await registry.seedFromCompactSeed({ seed, r2BaseUrl: R2_BASE, bundledTags: [HERO.tag] });
    const stats = await registry.seedFromCompactSeed({
      seed,
      r2BaseUrl: R2_BASE,
      bundledTags: [HERO.tag],
    });

    expect(stats.seeded).toBe(0);
    expect(stats.updated).toBe(0);
    expect(stats.unchanged).toBe(3);
    expect(stats.hashChanges).toHaveLength(0);

    expect((await registry.findById(HERO.tag))?.version).toBe(1);

    // Sources must not duplicate — (asset_id, backend) is the primary key.
    expect(await registry.listSources(HERO.tag)).toHaveLength(1);
  });

  test('re-seed with a changed hash bumps version and reports hashChanges', async () => {
    await registry.seedFromCompactSeed({ seed: makeSeed([HERO]), r2BaseUrl: R2_BASE });

    const changed: AssetSeedRow = { ...HERO, hash: HASH_B, sizeBytes: 1100 };
    const stats = await registry.seedFromCompactSeed({
      seed: makeSeed([changed], { generatedAt: '2026-08-24T00:00:00.000Z' }),
      r2BaseUrl: R2_BASE,
    });

    expect(stats.updated).toBe(1);
    expect(stats.hashChanges).toEqual([{ id: HERO.tag, oldHash: HASH_A, newHash: HASH_B }]);

    const hero = await registry.findById(HERO.tag);
    expect(hero?.version).toBe(2);
    expect(hero?.sizeBytes).toBe(1100);

    // The R2 URL follows the new hash — it is the object key.
    const sources = await registry.listSources(HERO.tag);
    expect(sources[0]?.url).toBe(r2Url(HASH_B, '.png'));
  });

  test('isSeeded is false for a different seed revision', async () => {
    await registry.seedFromCompactSeed({ seed: makeSeed(), r2BaseUrl: R2_BASE });

    expect(await registry.isSeeded('2026-08-23T00:00:00.000Z')).toBe(true);
    expect(await registry.isSeeded('2099-01-01T00:00:00.000Z')).toBe(false);
  });

  test('isSeeded rejects a bare generatedAt written by an older derivation', async () => {
    // A pre-fix client stored the raw timestamp. The fingerprint now carries a
    // derivation revision, so that client's registry must re-seed once.
    await registry.setMeta('asset_registry_seeded', '2026-08-23T00:00:00.000Z');
    expect(await registry.isSeeded('2026-08-23T00:00:00.000Z')).toBe(false);
  });

  test('seeding spans chunk boundaries and reports progress', async () => {
    const rows: AssetSeedRow[] = [];
    for (let index = 0; index < 1200; index++) {
      rows.push({
        tag: `sprites:bulk:${index}`,
        hash: `${String(index).padStart(4, '0')}${'0'.repeat(60)}`,
        sizeBytes: 100,
        category: 'sprites',
        ext: '.png',
      });
    }

    const progress: { chunk: number; totalChunks: number }[] = [];
    const stats = await registry.seedFromCompactSeed({
      seed: makeSeed(rows),
      r2BaseUrl: R2_BASE,
      onProgress: (update) => progress.push(update),
    });

    expect(stats.seeded).toBe(1200);
    expect(await registry.list()).toHaveLength(1200);
    expect(progress[0]?.totalChunks).toBe(3); // 1200 / 500, rounded up
    expect(progress.at(-1)?.chunk).toBe(3);
  });

  // ── Queries ──────────────────────────────────────────────────────────

  test('unknown asset id resolves to undefined', async () => {
    await registry.seedFromCompactSeed({ seed: makeSeed(), r2BaseUrl: R2_BASE });
    expect(await registry.findById('sprites:missing')).toBeUndefined();
    expect(await registry.getInstallState('sprites:missing')).toBeUndefined();
  });

  test('findIdsByHashes reverse-maps content hashes to tags', async () => {
    await registry.seedFromCompactSeed({ seed: makeSeed(), r2BaseUrl: R2_BASE });

    const ids = await registry.findIdsByHashes([HASH_B, HASH_C, 'f'.repeat(64)]);
    expect(ids.sort()).toEqual([BODY_WALK.tag, FOREST.tag]);

    expect(await registry.findIdsByHashes([])).toEqual([]);
  });

  test('findIdsByHashes handles more than 500 hashes — chunked reverse lookup', async () => {
    // 600 distinct hashes exceed the 500-row IN-clause chunk bound, so the
    // chunking loop in findIdsByHashes is actually exercised.
    const rows: AssetSeedRow[] = [];
    const hashes: string[] = [];
    for (let index = 0; index < 600; index++) {
      const hash = `${String(index).padStart(4, '0')}${'0'.repeat(60)}`;
      rows.push({
        tag: `sprites:bulk:${index}`,
        hash,
        sizeBytes: 100,
        category: 'sprites',
        ext: '.png',
      });
      hashes.push(hash);
    }
    await registry.seedFromCompactSeed({ seed: makeSeed(rows), r2BaseUrl: R2_BASE });

    const ids = await registry.findIdsByHashes(hashes);
    expect(ids).toHaveLength(600);
    expect(new Set(ids).size).toBe(600);
  });

  // ── Install state ────────────────────────────────────────────────────

  test('install state transitions and resetInterruptedDownloads', async () => {
    await registry.seedFromCompactSeed({ seed: makeSeed(), r2BaseUrl: R2_BASE });

    // No install state before any download
    expect(await registry.getInstallState(HERO.tag)).toBeUndefined();

    // downloading → cached
    await registry.setInstallState({
      assetId: HERO.tag,
      status: 'downloading',
      downloadedAt: '2026-08-03T01:00:00.000Z',
    });
    await registry.setInstallState({
      assetId: HERO.tag,
      status: 'cached',
      cachedHash: HASH_A,
      localPath: HASH_A,
      downloadedAt: '2026-08-03T01:00:01.000Z',
    });

    const cached = await registry.getInstallState(HERO.tag);
    expect(cached?.status).toBe('cached');
    expect(cached?.cachedHash).toBe(HASH_A);
    expect(cached?.localPath).toBe(HASH_A);

    // Simulate an interrupted download on another asset
    await registry.setInstallState({ assetId: FOREST.tag, status: 'downloading' });

    expect(await registry.resetInterruptedDownloads()).toBe(1);
    expect((await registry.getInstallState(FOREST.tag))?.status).toBe('not_downloaded');
    expect(await registry.listInstallStates()).toHaveLength(2);
  });
});
