// packages/frontend/storage/src/lib/__tests__/assets_catalog_snapshot.test.ts
//
// C-523 follow-up: the device-persisted catalog snapshot — the verified release
// graph (seed rows, offline-core tags, installed pack lock) that lets a cached
// device boot with no publish origin in reach.
//
// Tests:
// - a verified release round-trips through the real `meta` table, and a NEW
//   repository over the SAME database reads back the identical graph
// - the snapshot never disturbs the sibling asset-registry meta key
// - a tampered (digest-mismatched), truncated, unknown-version or
//   structurally invalid record is REJECTED, never partially applied
// - canonicalization: reordered rows / core tags still verify, because the
//   digest describes the value, not its serialization

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ASSET_REGISTRY_SEEDED_KEY, AssetRegistryRepository } from '../assets.ts';
import type { CatalogSnapshot } from '../assets_catalog_snapshot.ts';
import {
  CATALOG_SNAPSHOT_META_KEY,
  decodeCatalogSnapshot,
  encodeCatalogSnapshot,
  parseCatalogSnapshot,
  readCatalogSnapshot,
  writeCatalogSnapshot,
} from '../assets_catalog_snapshot.ts';
import { AIKAMI_MIGRATIONS } from '../migrations.ts';
import { WasmStorageAdapter } from '../wasm_storage_adapter.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HASH_BODY = 'a'.repeat(64);
const HASH_MUSIC = 'b'.repeat(64);
const ORIGIN = 'https://assets.example.test';

const makeSnapshot = (overrides?: Partial<CatalogSnapshot>): CatalogSnapshot => ({
  releaseId: '2026-09-16T00:00:00.000Z',
  releaseSource: 'release',
  seed: {
    schemaVersion: 1,
    generatedAt: '2026-09-16T00:00:00.000Z',
    originUrl: ORIGIN,
    rows: [
      {
        tag: 'lpc:body:bodies_male:walk',
        hash: HASH_BODY,
        sizeBytes: 2048,
        category: 'lpc',
        ext: '.webp',
        licenses: ['CC-BY-SA-3.0'],
      },
      {
        tag: 'music:exploration:forest',
        hash: HASH_MUSIC,
        sizeBytes: 4096,
        category: 'music',
        ext: '.mp3',
      },
    ],
  },
  coreTags: ['lpc:body:bodies_male:walk'],
  packLock: {
    schemaVersion: 'catalog.release.v1',
    releaseId: '2026-09-16T00:00:00.000Z',
    assets: [{ id: 'atlas', imageHash: 'c'.repeat(64), definitionHash: 'd'.repeat(64) }],
    audioAssets: [{ id: 'village.music', renditionHash: 'e'.repeat(64) }],
  },
  packLockSource: 'release',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Harness
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

/** Reads the raw envelope straight out of `meta`, bypassing the codec. */
const readRaw = async (registry: AssetRegistryRepository): Promise<string | undefined> =>
  registry.getMeta(CATALOG_SNAPSHOT_META_KEY);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('catalog snapshot persistence', () => {
  let db: WasmStorageAdapter;
  let registry: AssetRegistryRepository;

  beforeEach(async () => {
    ({ db, registry } = await createRegistry());
  });

  afterEach(async () => {
    await db.close();
  });

  test('a verified release round-trips and a fresh repository reads it back', async () => {
    const snapshot = makeSnapshot();
    await writeCatalogSnapshot(registry, snapshot);

    // A NEW repository over the SAME database — what the next boot gets.
    const restored = await readCatalogSnapshot(new AssetRegistryRepository(db));

    expect(restored).toEqual(snapshot);
    expect(restored?.releaseSource).toBe('release');
    expect(restored?.packLockSource).toBe('release');
    expect(restored?.packLock?.assets[0]?.imageHash).toBe('c'.repeat(64));
    expect(restored?.seed.rows[0]?.licenses).toEqual(['CC-BY-SA-3.0']);
    expect([...(restored?.coreTags ?? [])]).toEqual(['lpc:body:bodies_male:walk']);
  });

  test('the snapshot leaves the sibling asset-registry meta key untouched', async () => {
    await registry.setMeta(ASSET_REGISTRY_SEEDED_KEY, 'fingerprint-1');
    await writeCatalogSnapshot(registry, makeSnapshot());

    expect(await registry.getMeta(ASSET_REGISTRY_SEEDED_KEY)).toBe('fingerprint-1');
    expect(await registry.getMeta(CATALOG_SNAPSHOT_META_KEY)).toBeTruthy();
  });

  test('a second write replaces the record atomically (last good release wins)', async () => {
    await writeCatalogSnapshot(registry, makeSnapshot({ releaseId: 'release-1' }));
    await writeCatalogSnapshot(
      registry,
      makeSnapshot({
        releaseId: 'release-2',
        seed: {
          ...makeSnapshot().seed,
          rows: [
            {
              tag: 'music:exploration:forest',
              hash: HASH_MUSIC,
              sizeBytes: 1,
              category: 'music',
              ext: '.mp3',
            },
          ],
        },
        coreTags: [],
        packLock: undefined,
        packLockSource: 'absent',
      }),
    );

    const restored = await readCatalogSnapshot(new AssetRegistryRepository(db));
    expect(restored?.releaseId).toBe('release-2');
    expect(restored?.packLock).toBeUndefined();
    expect(restored?.packLockSource).toBe('absent');
    expect(restored?.seed.rows).toHaveLength(1);
  });

  test('a tampered row hash fails the digest check', async () => {
    await writeCatalogSnapshot(registry, makeSnapshot());
    const stored = JSON.parse((await readRaw(registry)) ?? '{}');
    stored.snapshot.seed.rows[0].hash = 'f'.repeat(64);

    // Written back as the record a corrupted device would hold.
    await registry.setMeta(CATALOG_SNAPSHOT_META_KEY, JSON.stringify(stored));
    expect(await readCatalogSnapshot(new AssetRegistryRepository(db))).toBeUndefined();
    expect(await decodeCatalogSnapshot(JSON.stringify(stored))).toBeUndefined();
  });

  test('a tampered core tag set fails the digest check', async () => {
    await writeCatalogSnapshot(registry, makeSnapshot());
    const stored = JSON.parse((await readRaw(registry)) ?? '{}');
    stored.snapshot.coreTags = ['lpc:body:bodies_male:walk', 'music:exploration:forest'];

    await registry.setMeta(CATALOG_SNAPSHOT_META_KEY, JSON.stringify(stored));
    expect(await readCatalogSnapshot(new AssetRegistryRepository(db))).toBeUndefined();
  });

  test('a rewritten release id fails the digest check', async () => {
    await writeCatalogSnapshot(registry, makeSnapshot());
    const stored = JSON.parse((await readRaw(registry)) ?? '{}');
    stored.snapshot.releaseId = '1999-01-01T00:00:00.000Z';

    await registry.setMeta(CATALOG_SNAPSHOT_META_KEY, JSON.stringify(stored));
    expect(await readCatalogSnapshot(new AssetRegistryRepository(db))).toBeUndefined();
  });

  test('truncated, unparseable and empty records are rejected, not coerced', async () => {
    await writeCatalogSnapshot(registry, makeSnapshot());
    const stored = (await readRaw(registry)) ?? '';

    expect(await decodeCatalogSnapshot('')).toBeUndefined();
    expect(await decodeCatalogSnapshot(stored.slice(0, stored.length / 2))).toBeUndefined();
    expect(await decodeCatalogSnapshot('{"version":1,"digest":"x"')).toBeUndefined();
  });

  test('an unknown record version is rejected rather than migrated', async () => {
    await writeCatalogSnapshot(registry, makeSnapshot());
    const stored = JSON.parse((await readRaw(registry)) ?? '{}');
    stored.version = 99;

    expect(await decodeCatalogSnapshot(JSON.stringify(stored))).toBeUndefined();
  });

  test('structurally invalid records are rejected field by field', async () => {
    const valid = makeSnapshot();

    // Unknown release provenance.
    expect(parseCatalogSnapshot({ ...valid, releaseSource: 'somewhere-else' })).toBeUndefined();
    // Non-string core tags.
    expect(parseCatalogSnapshot({ ...valid, coreTags: [1] })).toBeUndefined();
    // A pack lock that is not an InstalledPackLock.
    expect(parseCatalogSnapshot({ ...valid, packLock: { schemaVersion: 'nope' } })).toBeUndefined();
    // Provenance that contradicts the lock's presence.
    expect(parseCatalogSnapshot({ ...valid, packLockSource: 'absent' })).toBeUndefined();
    expect(
      parseCatalogSnapshot({ ...valid, packLock: null, packLockSource: 'release' }),
    ).toBeUndefined();
    expect(
      parseCatalogSnapshot({
        ...valid,
        seed: { ...valid.seed, rows: [] },
      }),
    ).toBeUndefined();
    expect(
      parseCatalogSnapshot({
        ...valid,
        seed: { ...valid.seed, rows: [{ ...valid.seed.rows[0], hash: 'not-a-hash' }] },
      }),
    ).toBeUndefined();
    expect(parseCatalogSnapshot(undefined)).toBeUndefined();
    expect(parseCatalogSnapshot('nope')).toBeUndefined();
  });

  test('the digest describes the value, not its serialization', async () => {
    const snapshot = makeSnapshot();
    const encoded = await encodeCatalogSnapshot(snapshot);

    // Same content, different array order and a re-encoded float.
    const shuffled = {
      ...snapshot,
      coreTags: [...snapshot.coreTags].reverse(),
      seed: {
        ...snapshot.seed,
        rows: [...snapshot.seed.rows].reverse(),
      },
    };
    const stored = JSON.parse(encoded);
    stored.snapshot = shuffled;

    expect(await decodeCatalogSnapshot(JSON.stringify(stored))).toEqual(shuffled);
  });

  test('a write failure surfaces to the caller instead of being swallowed', async () => {
    const failing = {
      getMeta: async () => undefined,
      setMeta: async () => {
        throw new Error('disk full');
      },
    };

    await expect(writeCatalogSnapshot(failing, makeSnapshot())).rejects.toThrow('disk full');
  });

  test('a read failure is a cache miss, never a throw', async () => {
    const failing = {
      getMeta: async () => {
        throw new Error('db closed');
      },
      setMeta: async () => {},
    };

    expect(await readCatalogSnapshot(failing)).toBeUndefined();
  });
});
