// packages/frontend/repositories/src/lib/__tests__/assets_registry.test.ts
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
import { AIKAMI_SCHEMA_DDL } from '../storage_adapter.ts';
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

const makeHashes = (overrides?: Partial<AssetHashesFile>): AssetHashesFile => {
  return {
    scannedAt: '2026-08-03T00:00:00.000Z',
    hashes: {
      'sprites:generic-fantasy:hero': { hash: HASH_A, sizeBytes: 1024 },
      'music:exploration:forest': { hash: HASH_B, sizeBytes: 2048 },
      'lpc:body:bodies_male:walk': { hash: HASH_C, sizeBytes: 4096 },
    },
    ...overrides,
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createRegistry = async (): Promise<{
  db: WasmStorageAdapter;
  registry: AssetRegistryRepository;
}> => {
  const db = new WasmStorageAdapter({ databasePath: ':memory:' });
  await db.open();
  for (const ddl of AIKAMI_SCHEMA_DDL) {
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

  test('addFirebaseStorageSources mirrors bundled paths as priority-1 bucket URLs', async () => {
    await registry.seedFromManifest({ manifest: makeManifest(), hashes: makeHashes() });

    const added = await registry.addFirebaseStorageSources('aikami-staging.firebasestorage.app');
    expect(added).toBe(3);

    const sources = await registry.listSources('music:exploration:forest');
    expect(sources).toHaveLength(2);
    expect(sources[0]?.backend).toBe(BUNDLED_SOURCE_BACKEND);
    expect(sources[0]?.priority).toBe(0);
    expect(sources[1]?.backend).toBe('firebase-storage');
    expect(sources[1]?.priority).toBe(1);
    expect(sources[1]?.url).toBe(
      'https://firebasestorage.googleapis.com/v0/b/aikami-staging.firebasestorage.app/o/music%2Fexploration%2Fforest.mp3?alt=media',
    );

    // Idempotent — second call is a cheap no-op.
    expect(await registry.addFirebaseStorageSources('aikami-staging.firebasestorage.app')).toBe(0);
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
});
