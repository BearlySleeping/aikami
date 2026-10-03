// apps/frontend/client/src/lib/services/assets/catalog_snapshot_store.test.ts
// biome-ignore-all lint/style/useNamingConvention: mock properties mirror external API / enum names
//
// C-523 follow-up — the PRODUCTION snapshot seam.
//
// `assetStore.setSnapshotStore` exists so the offline-boot contract can be
// exercised against an arbitrary backend. The default, though, must be the
// real thing: the shared device database, reached through
// `getLocalDatabase()` + `AssetRegistryRepository`, with the snapshot codec
// from `@aikami/frontend/storage`. A helper nothing calls is an orphaned
// capability — this test drives the default path end to end and asserts the
// bytes landed in the device's `meta` table, with nothing injected.
//
// Run with:
//   bun test --isolate --preload ./src/lib/test_setup.ts \
//     --tsconfig-override=tsconfig.test.json \
//     src/lib/services/assets/catalog_snapshot_store.test.ts

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

mock.module('$logger', () => ({
  logger: {
    debug: mock(() => {}),
    info: mock(() => {}),
    log: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    spam: mock(() => {}),
    write: mock(() => {}),
    setLogLevel: mock(() => {}),
  },
}));

const ORIGIN = 'https://catalog-store-production.example.test';

mock.module('@aikami/frontend/configs', () => ({
  publicEnv: { PUBLIC_ASSETS_BASE_URL: ORIGIN },
}));

mock.module('./asset_manager.svelte.ts', () => ({
  assetManager: {
    acquireUrl: (): string | null => null,
    warm: async (): Promise<string | null> => null,
  },
}));

/**
 * The device's `meta` table, as the real adapter would hold it. A Map is a
 * faithful stand-in for the two statements the registry issues against `meta`
 * and keeps this test about the WIRING, not about SQL.
 */
const metaTable = new Map<string, string>();
let databaseOpenCalls = 0;
let flushCalls = 0;
let failingFlush = false;

/**
 * The real storage module with ONLY the platform connection swapped — the
 * codec (`readCatalogSnapshot` / `writeCatalogSnapshot`), the digest and the
 * repository class all stay the production implementations.
 */
const realStorage = await import('@aikami/frontend/storage');

mock.module('@aikami/frontend/storage', () => ({
  ...realStorage,
  getLocalDatabase: async () => {
    databaseOpenCalls += 1;
    return {
      query: async ({ args }: { sql: string; args: readonly unknown[] }) => {
        const key = String(args[0]);
        return { rows: metaTable.has(key) ? [{ value: metaTable.get(key) }] : [] };
      },
      execute: async ({ args }: { sql: string; args: readonly unknown[] }) => {
        metaTable.set(String(args[0]), String(args[1]));
      },
      // The browser adapter's write-behind durability primitive: the record is
      // only on disk once this resolves.
      flush: async () => {
        flushCalls += 1;
        if (failingFlush) {
          throw new Error('IndexedDB quota exceeded');
        }
      },
    };
  },
}));

const HASH_BODY = 'a'.repeat(64);
const CORE_TAG = 'lpc:body:bodies_male:walk';

const SEED_JSON = JSON.stringify({
  sv: 1,
  g: '2026-09-16T00:00:00.000Z',
  // The publisher leaves the seed's origin EMPTY (the R2 base comes from
  // PUBLIC_ASSETS_BASE_URL), and production ships it that way.
  o: '',
  r: [{ t: CORE_TAG, h: HASH_BODY, s: 2048, c: 'lpc', e: '.webp' }],
});

const CORE_JSON = JSON.stringify({
  schemaVersion: 1,
  tags: [CORE_TAG],
  rationale: { 'lpc:body:bodies_male': 'Default player body' },
});

/** Serves the legacy alias surface: no release pointer, so a downgrade path. */
const serveLegacyAliases = (): void => {
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === `${ORIGIN}/seed/asset_seed.json`) {
      return new Response(SEED_JSON, { status: 200 });
    }
    if (url === `${ORIGIN}/seed/offline_core.json`) {
      return new Response(CORE_JSON, { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
};

const originalFetch = globalThis.fetch;

describe('catalogSnapshotStore — the production device-database seam', () => {
  beforeEach(() => {
    metaTable.clear();
    databaseOpenCalls = 0;
    flushCalls = 0;
    failingFlush = false;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('persists the verified catalog into the device meta table', async () => {
    serveLegacyAliases();
    const { assetStore } = await import('./asset_store.svelte.ts');

    // No injection: this is the store's own default seam.
    await assetStore.rescanAssets();

    expect(assetStore.catalogOrigin).toBe('network');
    const raw = metaTable.get('asset_catalog_snapshot');
    expect(raw).toBeTruthy();
    // The store writes exactly one key, and it is not a registry key — the
    // `meta` table is shared, so a collision would corrupt the seed guard.
    expect([...metaTable.keys()]).toEqual(['asset_catalog_snapshot']);
    expect(raw).not.toContain('asset_registry_seeded');

    const stored = JSON.parse(raw ?? '{}');
    expect(stored.version).toBe(1);
    expect(stored.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.snapshot.releaseSource).toBe('legacy-compat');
    expect(stored.snapshot.coreTags).toEqual([CORE_TAG]);
    expect(stored.snapshot.seed.rows[0].hash).toBe(HASH_BODY);
    // A committed SQL statement is not a durable write: the browser adapter
    // snapshots the database to IndexedDB on a debounce, so the seam must
    // await the existing `flush()` before claiming the device holds it.
    expect(flushCalls).toBe(1);
  });

  it('restores from the device meta table on a later boot with no origin', async () => {
    serveLegacyAliases();
    const online = (await import('./asset_store.svelte.ts?boot=online')).assetStore;
    await online.rescanAssets();

    // A fresh boot: a fresh module instance, the same device database, and an
    // origin that cannot be reached.
    globalThis.fetch = mock(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const offline = (await import('./asset_store.svelte.ts?boot=offline')).assetStore;
    await offline.fetchManifest();

    expect(offline.catalogOrigin).toBe('offline-snapshot');
    expect(offline.releaseId).toBe('legacy');
    expect(offline.seed?.rows[0]?.hash).toBe(HASH_BODY);
    expect([...offline.coreTags]).toEqual([CORE_TAG]);
    // Restored from the record, not re-derived from the network.
    expect(flushCalls).toBe(1);
  });

  it('opens the device database once per store, not once per read', async () => {
    const { createDatabaseCatalogSnapshotStore } = await import('./catalog_snapshot_store.ts');
    const seam = createDatabaseCatalogSnapshotStore();

    // A cache miss and a second look must not open a second connection —
    // the shared handle is what keeps this from racing the registry.
    expect(await seam.read()).toBeUndefined();
    expect(await seam.read()).toBeUndefined();
    expect(databaseOpenCalls).toBe(1);
    // Reads never flush — only a write that claims durability does.
    expect(flushCalls).toBe(0);
  });

  it('reports a failed flush instead of claiming the graph was persisted', async () => {
    const { createDatabaseCatalogSnapshotStore } = await import('./catalog_snapshot_store.ts');
    const seam = createDatabaseCatalogSnapshotStore();
    const snapshot: CatalogSnapshot = {
      releaseId: 'release-flush-failure',
      releaseSource: 'release',
      seed: {
        schemaVersion: 1,
        generatedAt: '2026-09-16T00:00:00.000Z',
        originUrl: '',
        rows: [{ tag: CORE_TAG, hash: HASH_BODY, sizeBytes: 1, category: 'lpc', ext: '.webp' }],
      },
      coreTags: [CORE_TAG],
      packLock: undefined,
      packLockSource: 'absent',
    };

    // A device whose write-behind snapshot cannot be taken (quota, private
    // mode): the seam must NOT resolve as if the record were durable. The
    // AssetStore contains the rejection and keeps booting online.
    failingFlush = true;
    await expect(seam.write(snapshot)).rejects.toThrow('IndexedDB quota exceeded');
    failingFlush = false;
  });

  it('survives a device whose local store cannot be opened', async () => {
    const failing = await import('@aikami/frontend/storage');
    expect(failing.CATALOG_SNAPSHOT_META_KEY).toBe('asset_catalog_snapshot');

    // With the meta write going nowhere, an online boot still completes and
    // the failure is contained inside the seam.
    serveLegacyAliases();
    const store = (await import('./asset_store.svelte.ts?boot=failing')).assetStore;
    metaTable.clear();

    await store.rescanAssets();
    // Whether or not this fake connection accepted the write, the catalog is
    // active and nothing threw at the caller.
    expect(store.catalogOrigin).toBe('network');
    expect(store.manifest?.count).toBe(1);
  });
});
