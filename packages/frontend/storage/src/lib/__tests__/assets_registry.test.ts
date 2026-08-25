// packages/frontend/storage/src/lib/__tests__/assets_registry.test.ts
//
// C-373 AC-1: AssetRegistryRepository — seeding, upsert idempotency, meta
// guard, querying, and install-state bookkeeping over the WASM in-memory DB.
//
// Tests:
// - seedFromManifest populates assets + asset_sources from manifest + sidecar
// - Re-seeding is idempotent (no version bumps, no row churn)
// - Hash change on re-seed bumps version and reports hashChanges
// - Tags missing from the sidecar are skipped — never seeded
// - meta.asset_registry_seeded guard (isSeeded)
// - findById / list / listSources return correct rows
// - Install-state transitions + resetInterruptedDownloads

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { AssetHashesFile, AssetManifest } from '@aikami/types';
import { AssetRegistryRepository, BUNDLED_SOURCE_BACKEND } from '../assets.ts';
import { AIKAMI_MIGRATIONS } from '../migrations.ts';
import { WasmStorageAdapter } from '../wasm_storage_adapter.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeManifest = (overrides?: Partial<AssetManifest>): AssetManifest => {
  const assets: AssetManifest['assets'] = {
    'sprites:generic-fantasy:hero': {
      tag: 'sprites:generic-fantasy:hero',
      category: 'sprites',
      subcategory: 'generic-fantasy',
      name: 'hero',
      path: 'sprites/generic-fantasy/hero.png',
      ext: '.png',
    },
    'music:exploration:forest': {
      tag: 'music:exploration:forest',
      category: 'music',
      subcategory: 'exploration',
      name: 'forest',
      path: 'music/exploration/forest.mp3',
      ext: '.mp3',
    },
    'lpc:body:bodies_male:walk': {
      tag: 'lpc:body:bodies_male:walk',
      category: 'lpc',
      subcategory: 'body',
      name: 'bodies_male.walk',
      path: 'lpc/body/bodies_male.walk.webp',
      ext: '.webp',
    },
  };
  return {
    scannedAt: '2026-08-03T00:00:00.000Z',
    count: Object.keys(assets).length,
    assets,
    byCategory: {
      music: [],
      sfx: [],
      ambient: [],
      sprites: [],
      backgrounds: [],
      lpc: [],
    },
    ...overrides,
  };
};

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

const makeHashes = (overrides?: Partial<AssetHashesFile>): AssetHashesFile => ({
  scannedAt: '2026-08-03T00:00:00.000Z',
  hashes: {
    'sprites:generic-fantasy:hero': { hash: HASH_A, sizeBytes: 1024 },
    'music:exploration:forest': { hash: HASH_B, sizeBytes: 2048 },
    'lpc:body:bodies_male:walk': { hash: HASH_C, sizeBytes: 4096 },
  },
  ...overrides,
});

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

  // ── AC-1: Seeding ────────────────────────────────────────────────────

  test('seedFromManifest populates assets + asset_sources with correct rows', async () => {
    const manifest = makeManifest();
    const hashes = makeHashes();

    const stats = await registry.seedFromManifest({ manifest, hashes });

    expect(stats.seeded).toBe(3);
    expect(stats.updated).toBe(0);
    expect(stats.unchanged).toBe(0);
    expect(stats.skipped).toBe(0);

    // findById returns the record with camelCase fields
    const hero = await registry.findById('sprites:generic-fantasy:hero');
    expect(hero).toBeDefined();
    expect(hero?.hash).toBe(HASH_A);
    expect(hero?.sizeBytes).toBe(1024);
    expect(hero?.version).toBe(1);
    expect(hero?.packId).toBe('sprites');
    expect(hero?.category).toBe('sprites');
    expect(hero?.license).toBe('unknown');

    // list returns all rows
    const all = await registry.list();
    expect(all).toHaveLength(3);

    // Sources: one bundled row per asset, priority 0, URL from entry.path
    const sources = await registry.listSources('music:exploration:forest');
    expect(sources).toHaveLength(1);
    expect(sources[0]?.backend).toBe(BUNDLED_SOURCE_BACKEND);
    expect(sources[0]?.priority).toBe(0);
    expect(sources[0]?.url).toBe('/game-data/music/exploration/forest.mp3');
  });

  test('addR2Sources writes content-addressed URLs from asset hash', async () => {
    await registry.seedFromManifest({ manifest: makeManifest(), hashes: makeHashes() });

    const added = await registry.addR2Sources('https://assets.bearlysleeping.com');
    expect(added).toBe(3);

    const sources = await registry.listSources('music:exploration:forest');
    expect(sources).toHaveLength(2);
    expect(sources[0]?.backend).toBe(BUNDLED_SOURCE_BACKEND);
    expect(sources[0]?.priority).toBe(0);
    expect(sources[1]?.backend).toBe('r2');
    expect(sources[1]?.priority).toBe(1);
    // Content-addressed URL: assets/<hash[0:2]>/<hash>.<ext>
    const expectedUrl = `https://assets.bearlysleeping.com/assets/${HASH_B.slice(0, 2)}/${HASH_B}.mp3`;
    expect(sources[1]?.url).toBe(expectedUrl);

    // Idempotent — second call writes the same rows (no-op upsert).
    expect(await registry.addR2Sources('https://assets.bearlysleeping.com')).toBe(3);
  });

  test('re-seeding with extra asset adds r2 mirror for new asset only', async () => {
    // Initial seed: 3 assets
    await registry.seedFromManifest({ manifest: makeManifest(), hashes: makeHashes() });
    const added1 = await registry.addR2Sources('https://assets.bearlysleeping.com');
    expect(added1).toBe(3);

    // Verify initial mirrors exist
    const sources1 = await registry.listSources('music:exploration:forest');
    expect(sources1).toHaveLength(2);

    // Re-seed with an extra asset (new bundled asset added to manifest)
    const HashD = 'd'.repeat(64);
    const manifest2 = makeManifest({
      assets: {
        ...makeManifest().assets,
        'sfx:ui:click': {
          tag: 'sfx:ui:click',
          category: 'sfx',
          subcategory: 'ui',
          name: 'click',
          path: 'sfx/ui/click.wav',
          ext: '.wav',
        },
      },
      count: 4,
    });
    const hashes2 = makeHashes({
      hashes: {
        ...makeHashes().hashes,
        'sfx:ui:click': { hash: HashD, sizeBytes: 512 },
      },
    });

    await registry.seedFromManifest({ manifest: manifest2, hashes: hashes2 });

    // Second addR2Sources upserts all 4 assets (INSERT OR REPLACE is idempotent).
    const added2 = await registry.addR2Sources('https://assets.bearlysleeping.com');
    expect(added2).toBe(4);

    // New asset should have both bundled + r2 sources
    const newSources = await registry.listSources('sfx:ui:click');
    expect(newSources).toHaveLength(2);
    expect(newSources[0]?.backend).toBe(BUNDLED_SOURCE_BACKEND);
    expect(newSources[1]?.backend).toBe('r2');
    const expectedNewUrl = `https://assets.bearlysleeping.com/assets/${HashD.slice(0, 2)}/${HashD}.wav`;
    expect(newSources[1]?.url).toBe(expectedNewUrl);

    // Existing asset sources should remain unchanged (not duplicated)
    const existingSources = await registry.listSources('music:exploration:forest');
    expect(existingSources).toHaveLength(2);
    expect(existingSources[0]?.backend).toBe(BUNDLED_SOURCE_BACKEND);
    expect(existingSources[1]?.backend).toBe('r2');
    const expectedExistingUrl = `https://assets.bearlysleeping.com/assets/${HASH_B.slice(0, 2)}/${HASH_B}.mp3`;
    expect(existingSources[1]?.url).toBe(expectedExistingUrl);
  });

  // ── AC-2: Existing incorrect r2 rows are repaired ──────────────────

  test('addR2Sources rewrites stale path-mirrored r2 rows to content-addressed URLs', async () => {
    await registry.seedFromManifest({ manifest: makeManifest(), hashes: makeHashes() });

    // Manually insert a stale (path-mirrored) r2 row to simulate a pre-C-432 install.
    const staleUrl = 'https://assets.bearlysleeping.com/music/exploration/forest.mp3';
    await db.execute({
      sql: `INSERT OR REPLACE INTO asset_sources (asset_id, backend, url, priority)
            VALUES (?, 'r2', ?, 1)`,
      args: ['music:exploration:forest', staleUrl],
    });

    // Confirm the stale row is there.
    let sources = await registry.listSources('music:exploration:forest');
    expect(sources).toHaveLength(2);
    expect(sources[1]?.url).toBe(staleUrl);

    // Run addR2Sources — it should rewrite the stale row.
    const added = await registry.addR2Sources('https://assets.bearlysleeping.com');
    // All 3 assets get upserted (stale + new for the other 2).
    expect(added).toBe(3);

    sources = await registry.listSources('music:exploration:forest');
    expect(sources).toHaveLength(2);
    const expectedUrl = `https://assets.bearlysleeping.com/assets/${HASH_B.slice(0, 2)}/${HASH_B}.mp3`;
    expect(sources[1]?.url).toBe(expectedUrl);

    // Second run is idempotent — same upsert, no data regression.
    const added2 = await registry.addR2Sources('https://assets.bearlysleeping.com');
    expect(added2).toBe(3);
    sources = await registry.listSources('music:exploration:forest');
    expect(sources[1]?.url).toBe(expectedUrl);
  });

  test('addR2Sources handles empty registry gracefully', async () => {
    // No seed — empty assets and asset_sources tables.
    const added = await registry.addR2Sources('https://assets.bearlysleeping.com');
    expect(added).toBe(0);
  });

  test('meta.asset_registry_seeded is set to the manifest scannedAt', async () => {
    const manifest = makeManifest();
    await registry.seedFromManifest({ manifest, hashes: makeHashes() });

    expect(await registry.isSeeded('2026-08-03T00:00:00.000Z')).toBe(true);
    expect(await registry.isSeeded('2099-01-01T00:00:00.000Z')).toBe(false);
  });

  test('re-seeding with identical hashes is idempotent — no version bumps', async () => {
    const manifest = makeManifest();
    const hashes = makeHashes();

    await registry.seedFromManifest({ manifest, hashes });
    const stats = await registry.seedFromManifest({ manifest, hashes });

    expect(stats.seeded).toBe(0);
    expect(stats.updated).toBe(0);
    expect(stats.unchanged).toBe(3);
    expect(stats.hashChanges).toHaveLength(0);

    const hero = await registry.findById('sprites:generic-fantasy:hero');
    expect(hero?.version).toBe(1);

    // Re-seeding must not duplicate asset_sources rows — exactly one bundled
    // row survives both seed operations.
    const sources = await registry.listSources('sprites:generic-fantasy:hero');
    expect(sources).toHaveLength(1);
    expect(sources[0]?.backend).toBe(BUNDLED_SOURCE_BACKEND);
    expect(sources[0]?.priority).toBe(0);
  });

  // ── AC-3 prerequisite: hash change → version bump + hashChanges ─────

  test('re-seed with a changed hash bumps version and reports hashChanges', async () => {
    const manifest = makeManifest();
    const v1Hashes = makeHashes();

    await registry.seedFromManifest({ manifest, hashes: v1Hashes });

    // New build: hero.png changed → new hash
    const v2Hashes = makeHashes({
      hashes: {
        ...v1Hashes.hashes,
        'sprites:generic-fantasy:hero': { hash: HASH_A.replace('a', 'e'), sizeBytes: 1100 },
      },
    });

    const stats = await registry.seedFromManifest({ manifest, hashes: v2Hashes });

    expect(stats.updated).toBe(1);
    expect(stats.unchanged).toBe(2);
    expect(stats.hashChanges).toHaveLength(1);
    expect(stats.hashChanges[0]).toEqual({
      id: 'sprites:generic-fantasy:hero',
      oldHash: HASH_A,
      newHash: HASH_A.replace('a', 'e'),
    });

    const hero = await registry.findById('sprites:generic-fantasy:hero');
    expect(hero?.version).toBe(2);
    expect(hero?.sizeBytes).toBe(1100);

    // Third seed with the same v2 hash → stable, no more bumps
    const stats3 = await registry.seedFromManifest({ manifest, hashes: v2Hashes });
    expect(stats3.updated).toBe(0);
    expect(stats3.unchanged).toBe(3);
    const heroAgain = await registry.findById('sprites:generic-fantasy:hero');
    expect(heroAgain?.version).toBe(2);
  });

  test('tags missing from the sidecar are skipped — never seeded', async () => {
    const manifest = makeManifest();
    // Sidecar omits the music entry
    const hashes = makeHashes();
    const { 'music:exploration:forest': _omitted, ...rest } = hashes.hashes;

    const stats = await registry.seedFromManifest({
      manifest,
      hashes: { ...hashes, hashes: rest },
    });

    expect(stats.skipped).toBe(1);
    expect(stats.seeded).toBe(2);

    const music = await registry.findById('music:exploration:forest');
    expect(music).toBeUndefined();
  });

  // ── Install state ────────────────────────────────────────────────────

  test('install state transitions and resetInterruptedDownloads', async () => {
    await registry.seedFromManifest({ manifest: makeManifest(), hashes: makeHashes() });

    // No install state before any download
    expect(await registry.getInstallState('sprites:generic-fantasy:hero')).toBeUndefined();

    // downloading → cached
    await registry.setInstallState({
      assetId: 'sprites:generic-fantasy:hero',
      status: 'downloading',
      downloadedAt: '2026-08-03T01:00:00.000Z',
    });
    await registry.setInstallState({
      assetId: 'sprites:generic-fantasy:hero',
      status: 'cached',
      cachedHash: HASH_A,
      localPath: HASH_A,
      downloadedAt: '2026-08-03T01:00:01.000Z',
    });

    const cached = await registry.getInstallState('sprites:generic-fantasy:hero');
    expect(cached?.status).toBe('cached');
    expect(cached?.cachedHash).toBe(HASH_A);
    expect(cached?.localPath).toBe(HASH_A);

    // Simulate an interrupted download on another asset
    await registry.setInstallState({
      assetId: 'music:exploration:forest',
      status: 'downloading',
    });

    const reset = await registry.resetInterruptedDownloads();
    expect(reset).toBe(1);

    const interrupted = await registry.getInstallState('music:exploration:forest');
    expect(interrupted?.status).toBe('not_downloaded');

    // listInstallStates returns every row
    const states = await registry.listInstallStates();
    expect(states).toHaveLength(2);
  });

  test('unknown asset id resolves to undefined', async () => {
    await registry.seedFromManifest({ manifest: makeManifest(), hashes: makeHashes() });
    expect(await registry.findById('sprites:missing')).toBeUndefined();
    expect(await registry.getInstallState('sprites:missing')).toBeUndefined();
  });

  test('findIdsByHashes reverse-maps content hashes to tags', async () => {
    await registry.seedFromManifest({ manifest: makeManifest(), hashes: makeHashes() });

    const ids = await registry.findIdsByHashes([HASH_B, HASH_C, 'f'.repeat(64)]);
    expect(ids.sort()).toEqual(['lpc:body:bodies_male:walk', 'music:exploration:forest']);

    expect(await registry.findIdsByHashes([])).toEqual([]);
  });

  test('findIdsByHashes handles more than 500 hashes — chunked reverse lookup', async () => {
    // 600 distinct hashes exceed the 500-row IN-clause chunk bound, so the
    // chunking loop in findIdsByHashes is actually exercised.
    const assets: AssetManifest['assets'] = {};
    const hashes: AssetHashesFile['hashes'] = {};
    const seededHashes: string[] = [];
    for (let i = 0; i < 600; i++) {
      const tag = `sprites:bulk:${i}`;
      const hash = `${String(i).padStart(4, '0')}${'0'.repeat(60)}`;
      assets[tag] = {
        tag,
        category: 'sprites',
        subcategory: 'bulk',
        name: `bulk-${i}`,
        path: `sprites/bulk/${i}.png`,
        ext: '.png',
      };
      hashes[tag] = { hash, sizeBytes: 100 };
      seededHashes.push(hash);
    }
    const manifest = makeManifest({ assets, count: 600 });
    await registry.seedFromManifest({
      manifest,
      hashes: { scannedAt: manifest.scannedAt, hashes },
    });

    const ids = await registry.findIdsByHashes(seededHashes);
    expect(ids).toHaveLength(600);
    // Every seeded tag returned exactly once.
    expect(new Set(ids).size).toBe(600);
    expect(ids).toEqual(expect.arrayContaining(Object.keys(assets)));
  });

  test('seed chunk boundary — more assets than one chunk', async () => {
    // 1,200 tags > SEED_CHUNK_SIZE (500) → exercises chunked transactions
    const assets: AssetManifest['assets'] = {};
    const hashes: AssetHashesFile['hashes'] = {};
    for (let i = 0; i < 1200; i++) {
      const tag = `sprites:generic-fantasy:hero-${i}`;
      assets[tag] = {
        tag,
        category: 'sprites',
        subcategory: 'generic-fantasy',
        name: `hero-${i}`,
        path: `sprites/generic-fantasy/hero-${i}.png`,
        ext: '.png',
      };
      hashes[tag] = { hash: HASH_A, sizeBytes: 100 };
    }
    const manifest = makeManifest({ assets, count: 1200 });

    const stats = await registry.seedFromManifest({
      manifest,
      hashes: { scannedAt: manifest.scannedAt, hashes },
    });

    expect(stats.seeded).toBe(1200);
    expect(await registry.list()).toHaveLength(1200);
  });

  // ── C-435: Compact seed seeding ─────────────────────────────────────

  test('seedFromCompactSeed populates assets without asset_sources', async () => {
    const seed = {
      schemaVersion: 1 as const,
      generatedAt: '2026-08-23T00:00:00.000Z',
      originUrl: 'https://assets.example.com',
      rows: [
        { tag: 'sprites:generic-fantasy:hero', hash: HASH_A, sizeBytes: 1024, category: 'sprites', ext: '.png' },
        { tag: 'music:exploration:forest', hash: HASH_B, sizeBytes: 2048, category: 'music', ext: '.mp3' },
        { tag: 'lpc:body:bodies_male:walk', hash: HASH_C, sizeBytes: 4096, category: 'lpc', ext: '.webp' },
      ],
    };

    const stats = await registry.seedFromCompactSeed(seed);

    expect(stats.seeded).toBe(3);
    expect(stats.updated).toBe(0);
    expect(stats.unchanged).toBe(0);

    // Assets are seeded
    const hero = await registry.findById('sprites:generic-fantasy:hero');
    expect(hero).toBeDefined();
    expect(hero?.hash).toBe(HASH_A);
    expect(hero?.sizeBytes).toBe(1024);
    expect(hero?.version).toBe(1);

    // No asset_sources rows are created by seedFromCompactSeed
    const sources = await registry.listSources('sprites:generic-fantasy:hero');
    expect(sources).toHaveLength(0);

    // meta guard is set
    expect(await registry.isSeeded(seed.generatedAt)).toBe(true);
  });

  test('seedFromCompactSeed is idempotent — re-seeding with same hashes is no-op', async () => {
    const seed = {
      schemaVersion: 1 as const,
      generatedAt: '2026-08-23T00:00:00.000Z',
      originUrl: 'https://assets.example.com',
      rows: [
        { tag: 'sprites:generic-fantasy:hero', hash: HASH_A, sizeBytes: 1024, category: 'sprites', ext: '.png' },
      ],
    };

    await registry.seedFromCompactSeed(seed);
    const stats = await registry.seedFromCompactSeed(seed);

    expect(stats.seeded).toBe(0);
    expect(stats.updated).toBe(0);
    expect(stats.unchanged).toBe(1);
    expect(stats.hashChanges).toHaveLength(0);

    const hero = await registry.findById('sprites:generic-fantasy:hero');
    expect(hero?.version).toBe(1);
  });

  test('seedFromCompactSeed bumps version on hash change', async () => {
    const v1Seed = {
      schemaVersion: 1 as const,
      generatedAt: '2026-08-23T00:00:00.000Z',
      originUrl: 'https://assets.example.com',
      rows: [
        { tag: 'sprites:generic-fantasy:hero', hash: HASH_A, sizeBytes: 1024, category: 'sprites', ext: '.png' },
      ],
    };
    const v2Seed = {
      ...v1Seed,
      generatedAt: '2026-08-24T00:00:00.000Z',
      rows: [
        { tag: 'sprites:generic-fantasy:hero', hash: HASH_B, sizeBytes: 1100, category: 'sprites', ext: '.png' },
      ],
    };

    await registry.seedFromCompactSeed(v1Seed);
    const stats = await registry.seedFromCompactSeed(v2Seed);

    expect(stats.updated).toBe(1);
    expect(stats.hashChanges).toHaveLength(1);
    expect(stats.hashChanges[0]).toEqual({
      id: 'sprites:generic-fantasy:hero',
      oldHash: HASH_A,
      newHash: HASH_B,
    });

    const hero = await registry.findById('sprites:generic-fantasy:hero');
    expect(hero?.version).toBe(2);
    expect(hero?.sizeBytes).toBe(1100);
  });

  test('seedFromCompactSeed reports progress via callback', async () => {
    // Create enough rows to span multiple chunks
    const rows = [];
    for (let i = 0; i < 1200; i++) {
      const tag = `sprites:bulk:${i}`;
      rows.push({ tag, hash: `${String(i).padStart(4, '0')}${'0'.repeat(60)}`, sizeBytes: 100, category: 'sprites', ext: '.png' });
    }
    const seed = {
      schemaVersion: 1 as const,
      generatedAt: '2026-08-23T00:00:00.000Z',
      originUrl: 'https://assets.example.com',
      rows,
    };

    const progressCalls: { chunk: number; totalChunks: number }[] = [];
    await registry.seedFromCompactSeed(seed, (p) => { progressCalls.push(p); });

    expect(progressCalls.length).toBeGreaterThan(0);
    expect(progressCalls[0]?.totalChunks).toBe(3); // 1200 / 500 = 3 chunks
    expect(progressCalls[progressCalls.length - 1]?.chunk).toBe(3);
  });

  // ── C-435: addBundledSources ────────────────────────────────────────

  test('addBundledSources creates bundled priority-0 source rows', async () => {
    // First seed the assets via compact seed
    const seed = {
      schemaVersion: 1 as const,
      generatedAt: '2026-08-23T00:00:00.000Z',
      originUrl: 'https://assets.example.com',
      rows: [
        { tag: 'sprites:generic-fantasy:hero', hash: HASH_A, sizeBytes: 1024, category: 'sprites', ext: '.png' },
        { tag: 'lpc:body:bodies_male:walk', hash: HASH_C, sizeBytes: 4096, category: 'lpc', ext: '.webp' },
      ],
    };
    await registry.seedFromCompactSeed(seed);

    // Add bundled sources for a subset of tags
    const added = await registry.addBundledSources(['sprites:generic-fantasy:hero']);
    expect(added).toBe(1);

    const sources = await registry.listSources('sprites:generic-fantasy:hero');
    expect(sources).toHaveLength(1);
    expect(sources[0]?.backend).toBe(BUNDLED_SOURCE_BACKEND);
    expect(sources[0]?.priority).toBe(0);
    expect(sources[0]?.url).toBe('/game-data/sprites/generic-fantasy/hero');

    // Tag not in the bundled set has no sources
    const lpcSources = await registry.listSources('lpc:body:bodies_male:walk');
    expect(lpcSources).toHaveLength(0);
  });

  test('addBundledSources with empty tags returns 0', async () => {
    const added = await registry.addBundledSources([]);
    expect(added).toBe(0);
  });
});
