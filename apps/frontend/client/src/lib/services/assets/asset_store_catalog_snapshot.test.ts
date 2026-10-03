// apps/frontend/client/src/lib/services/assets/asset_store_catalog_snapshot.test.ts
// biome-ignore-all lint/style/useNamingConvention: mock properties mirror external API / enum names
//
// C-523 follow-up — the AssetStore's OFFLINE BOOT contract.
//
// The release graph was fetched from `PUBLIC_ASSETS_BASE_URL` on every boot and
// never written down, so a network-blocked reload came up with an empty store
// even though every byte it needed sat in OPFS: `resolveUrl` returned null for
// each tag, `loadContentPack` fell back to a relative manifest path the
// de-bundled client does not ship, and boot aborted on a 404.
//
// The catalog snapshot (seed rows + offline-core tags + installed pack lock)
// closes that gap. These tests pin the properties that make it safe:
//
//   - an online, fully verified release is persisted AS ONE COHERENT RECORD;
//   - a NEW store on a NEW boot restores the identical graph with the network
//     blocked — same manifest, hashes, core tags, lock and known blob URLs;
//   - cache-first boot never awaits a blocked origin;
//   - an unknown / corrupt / tampered snapshot is rejected, never partially
//     applied, and a device with nothing cached fails HONESTLY;
//   - a partial refresh keeps the last good catalog AND the last good snapshot;
//   - a newer release is reported but never blended into a live catalog;
//   - the production store writes through the real device-database helper
//     (no orphaned capability behind the seam).
//
// Run with:
//   bun test --isolate --preload ./src/lib/test_setup.ts \
//     --tsconfig-override=tsconfig.test.json \
//     src/lib/services/assets/asset_store_catalog_snapshot.test.ts

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

// $logger resolves to the SvelteKit sink which pulls $env at import time —
// mock it so the store loads cleanly in Bun.
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

const ORIGIN = 'https://catalog-snapshot-test.example.test';

mock.module('@aikami/frontend/configs', () => ({
  publicEnv: { PUBLIC_ASSETS_BASE_URL: ORIGIN },
}));

/**
 * The device binary cache, as `assetManager` sees it: a blob URL exists only
 * for a tag whose cached bytes were hash-verified against the local registry.
 */
const cachedBlobs = new Map<string, string>();

mock.module('./asset_manager.svelte.ts', () => ({
  assetManager: {
    acquireUrl: (tag: string): string | null => cachedBlobs.get(tag) ?? null,
    warm: async (): Promise<string | null> => null,
  },
}));

import {
  type CatalogSnapshot,
  decodeCatalogSnapshot,
  encodeCatalogSnapshot,
} from '@aikami/frontend/storage';
import { sha256Hex } from './asset_hasher.ts';
import type { AssetStore, CatalogOrigin } from './asset_store.svelte.ts';

// ---------------------------------------------------------------------------
// Release fixtures — a hash-pinned release graph, exactly as the publisher
// writes it (pointer + root + shard + seed + offline core + pack lock).
// ---------------------------------------------------------------------------

const HASH_BODY = 'a'.repeat(64);
const HASH_MUSIC = 'b'.repeat(64);

const CORE_TAG = 'lpc:body:bodies_male:walk';
const MUSIC_TAG = 'music:exploration:forest';

const sha256 = (value: string): Promise<string> => sha256Hex(new Blob([value]));

const makeDocuments = async (options: {
  releaseId: string;
  bodyHash: string;
  seedHashes: { body: string; music: string };
}): Promise<Map<string, string>> => {
  const seedJson = JSON.stringify({
    sv: 1,
    g: '2026-09-16T00:00:00.000Z',
    o: ORIGIN,
    r: [
      { t: CORE_TAG, h: options.seedHashes.body, s: 2048, c: 'lpc', e: '.webp' },
      { t: MUSIC_TAG, h: options.seedHashes.music, s: 4096, c: 'music', e: '.mp3' },
    ],
  });
  const coreJson = JSON.stringify({
    schemaVersion: 1,
    tags: [CORE_TAG],
    rationale: { 'lpc:body:bodies_male': 'Default player body' },
  });
  const packLockJson = JSON.stringify({
    schemaVersion: 'catalog.release.v1',
    releaseId: options.releaseId,
    assets: [{ id: 'atlas', imageHash: 'c'.repeat(64), definitionHash: 'd'.repeat(64) }],
    audioAssets: [{ id: 'village.music', renditionHash: 'e'.repeat(64) }],
  });
  const rootJson = JSON.stringify({ categories: [] });
  const shardJson = JSON.stringify({ id: 'lpc', entries: [] });

  const [seedHash, coreHash, packLockHash, rootHash, shardHash] = await Promise.all([
    sha256(seedJson),
    sha256(coreJson),
    sha256(packLockJson),
    sha256(rootJson),
    sha256(shardJson),
  ]);

  const seedKey = `seed/${seedHash}/asset_seed.json`;
  const coreKey = `seed/${coreHash}/offline_core.json`;
  const rootKey = `index/v1/revisions/${rootHash}/catalog.json`;
  const shardKey = `index/v1/revisions/${shardHash}/lpc.json`;
  const packLockKey = `index/v1/revisions/${packLockHash}/pack_lock.json`;

  return new Map<string, string>([
    [
      'index/v1/release.json',
      JSON.stringify({
        schemaVersion: 'catalog.release.v1',
        releaseId: options.releaseId,
        rootKey,
        rootHash,
        shards: [{ category: 'lpc', key: shardKey, hash: shardHash }],
        dependencies: [
          { key: seedKey, hash: seedHash },
          { key: coreKey, hash: coreHash },
          { key: packLockKey, hash: packLockHash },
        ],
        publishedAt: '2026-09-16T00:00:00.000Z',
      }),
    ],
    [rootKey, rootJson],
    [shardKey, shardJson],
    [seedKey, seedJson],
    [coreKey, coreJson],
    [packLockKey, packLockJson],
  ]);
};

/** Release N: the graph a device verifies and caches. */
const releaseOne = (): Promise<Map<string, string>> =>
  makeDocuments({
    releaseId: 'release-one',
    bodyHash: HASH_BODY,
    seedHashes: { body: HASH_BODY, music: HASH_MUSIC },
  });

/** Release N+1: SAME release id, DIFFERENT bytes — a real content update. */
const releaseTwo = (): Promise<Map<string, string>> =>
  makeDocuments({
    releaseId: 'release-two',
    bodyHash: HASH_BODY,
    seedHashes: { body: '9'.repeat(64), music: HASH_MUSIC },
  });

const serve = (documents: Map<string, string>): void => {
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.startsWith(`${ORIGIN}/`)) {
      return new Response('not found', { status: 404 });
    }
    const body = documents.get(url.slice(ORIGIN.length + 1));
    return body === undefined
      ? new Response('not found', { status: 404 })
      : new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
};

/** An origin that is simply unreachable — the offline cold-start case. */
const serveUnreachable = (): void => {
  globalThis.fetch = mock(async () => {
    throw new TypeError('Failed to fetch');
  }) as unknown as typeof fetch;
};

/** An origin that NEVER answers — the "blocked CDN" case. */
const serveBlockedForever = (): void => {
  globalThis.fetch = mock(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
};

// ---------------------------------------------------------------------------
// Device backend harness
// ---------------------------------------------------------------------------

/** The record the device persisted (undefined = nothing cached yet). */
let persistedRecord: string | undefined;
let writeCount = 0;

/**
 * A device backend handle. Each call is a NEW handle over the same persisted
 * record, which is what a later boot gets.
 */
const createDeviceBackend = () => ({
  read: async (): Promise<CatalogSnapshot | undefined> =>
    persistedRecord === undefined ? undefined : decodeCatalogSnapshot(persistedRecord),
  write: async (snapshot: CatalogSnapshot): Promise<void> => {
    writeCount += 1;
    persistedRecord = await encodeCatalogSnapshot(snapshot);
  },
});

let bootCounter = 0;

/** A brand-new AssetStore instance (fresh module instance, empty state). */
const bootStore = async (): Promise<AssetStore> => {
  bootCounter += 1;
  const module = await import(`./asset_store.svelte.ts?boot=${bootCounter}`);
  return module.assetStore;
};

const originalFetch = globalThis.fetch;

/** Bounded wait for a detached (non-awaited) store side effect. */
const waitFor = async (predicate: () => boolean, label: string): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AssetStore — verified catalog snapshot (offline boot)', () => {
  beforeEach(() => {
    persistedRecord = undefined;
    writeCount = 0;
    cachedBlobs.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('persists a fully verified release as one coherent record', async () => {
    serve(await releaseOne());
    const store = await bootStore();
    store.setSnapshotStore(createDeviceBackend());

    await store.rescanAssets();

    expect(store.catalogOrigin).toBe('network' satisfies CatalogOrigin);
    const persisted = await decodeCatalogSnapshot(persistedRecord ?? '');
    expect(persisted?.releaseId).toBe('release-one');
    expect(persisted?.releaseSource).toBe('release');
    expect([...(persisted?.coreTags ?? [])]).toEqual([CORE_TAG]);
    expect(persisted?.packLockSource).toBe('release');
    expect(persisted?.packLock?.assets[0]?.id).toBe('atlas');
    // The seed the release pinned — the same hashes the store resolved.
    expect(persisted?.seed.rows.map((row) => [row.tag, row.hash])).toEqual([
      [CORE_TAG, HASH_BODY],
      [MUSIC_TAG, HASH_MUSIC],
    ]);
  });

  it('restores the identical catalog on a new store with the origin unreachable', async () => {
    // ── First boot: online, verified, cached ──────────────────────────────
    serve(await releaseOne());
    const online = await bootStore();
    online.setSnapshotStore(createDeviceBackend());
    await online.rescanAssets();

    // The device has the bytes the release named.
    cachedBlobs.set(CORE_TAG, 'blob:mock/core-body');

    // ── Second boot: a NEW store instance, a NEW backend handle ──────────
    serveUnreachable();
    const offline = await bootStore();
    offline.setSnapshotStore(createDeviceBackend());
    await offline.fetchManifest();

    expect(offline.catalogOrigin).toBe('offline-snapshot');
    expect(offline.releaseId).toBe(online.releaseId);
    expect(offline.releaseSource).toBe(online.releaseSource);
    expect(offline.manifest?.count).toBe(online.manifest?.count);
    expect(offline.seed?.rows.map((row) => [row.tag, row.hash])).toEqual(
      online.seed?.rows.map((row) => [row.tag, row.hash]),
    );
    // coreTags + packLock restored verbatim: this is what rehydration and
    // audio verification read.
    expect([...offline.coreTags]).toEqual([...online.coreTags]);
    expect(offline.packLock).toEqual(online.packLock);
    expect(offline.packLockSource).toBe('release');
    // Known cached binaries resolve through the restored row, with no origin.
    expect(offline.resolveUrl(CORE_TAG)).toBe('blob:mock/core-body');
    expect(offline.resolveLicenses(CORE_TAG)).toEqual(online.resolveLicenses(CORE_TAG));
  });

  it('resolves a restored non-core tag through the content-addressed origin URL', async () => {
    serve(await releaseOne());
    const online = await bootStore();
    online.setSnapshotStore(createDeviceBackend());
    await online.rescanAssets();

    serveUnreachable();
    const offline = await bootStore();
    offline.setSnapshotStore(createDeviceBackend());
    await offline.fetchManifest();

    // Not cached locally → the exact R2 object the restored hash names.
    expect(offline.resolveUrl(MUSIC_TAG)).toBe(
      `${ORIGIN}/assets/${HASH_MUSIC.slice(0, 2)}/${HASH_MUSIC}.mp3`,
    );
  });

  it('cache-first boot does not await a blocked origin', async () => {
    serve(await releaseOne());
    const online = await bootStore();
    online.setSnapshotStore(createDeviceBackend());
    await online.rescanAssets();

    // The CDN accepts the connection and never answers.
    serveBlockedForever();
    const offline = await bootStore();
    offline.setSnapshotStore(createDeviceBackend());

    const started = Date.now();
    await offline.fetchManifest();
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(2_000);
    expect(offline.catalogOrigin).toBe('offline-snapshot');
    expect(offline.manifest?.count).toBe(2);
    expect([...offline.coreTags]).toEqual([CORE_TAG]);
  });

  it('rejects a tampered snapshot instead of partially applying it', async () => {
    serve(await releaseOne());
    const online = await bootStore();
    online.setSnapshotStore(createDeviceBackend());
    await online.rescanAssets();

    // A record edited on disk after it was written.
    const stored = JSON.parse(persistedRecord ?? '{}');
    stored.snapshot.seed.rows[0].hash = 'f'.repeat(64);
    stored.snapshot.coreTags = [CORE_TAG, MUSIC_TAG];
    persistedRecord = JSON.stringify(stored);

    serveUnreachable();
    const offline = await bootStore();
    offline.setSnapshotStore(createDeviceBackend());
    await offline.fetchManifest();

    // Nothing from the untrusted record reached the active catalog.
    expect(offline.seed).toBeNull();
    expect(offline.manifest).toBeNull();
    expect(offline.coreTags.size).toBe(0);
    expect(offline.releaseId).toBeNull();
    expect(offline.packLock).toBeNull();
    expect(offline.error).toBeTruthy();
    expect(offline.resolveUrl(CORE_TAG)).toBeNull();
  });

  it('rejects an unknown snapshot record version', async () => {
    serve(await releaseOne());
    const online = await bootStore();
    online.setSnapshotStore(createDeviceBackend());
    await online.rescanAssets();

    const stored = JSON.parse(persistedRecord ?? '{}');
    stored.version = 99;
    persistedRecord = JSON.stringify(stored);

    serveUnreachable();
    const offline = await bootStore();
    offline.setSnapshotStore(createDeviceBackend());
    await offline.fetchManifest();

    expect(offline.seed).toBeNull();
    expect(offline.error).toBeTruthy();
  });

  it('fails honestly on an offline first install, with an actionable message', async () => {
    serveUnreachable();
    const store = await bootStore();
    store.setSnapshotStore(createDeviceBackend());

    await store.fetchManifest();

    expect(store.seed).toBeNull();
    expect(store.manifest).toBeNull();
    expect(store.catalogOrigin).toBeNull();
    // No fabricated catalog, and nothing was written to the device.
    expect(writeCount).toBe(0);
    expect(persistedRecord).toBeUndefined();
    // The message says what the player has to do about it.
    expect(store.error).toContain('connect once');
    expect(store.error).toContain('Later runs boot offline');
  });

  it('keeps the last good catalog AND the last good snapshot through a partial refresh', async () => {
    serve(await releaseOne());
    const store = await bootStore();
    store.setSnapshotStore(createDeviceBackend());
    await store.rescanAssets();

    const recordAfterSuccess = persistedRecord;
    const manifestBefore = store.manifest;
    const seedBefore = store.seed;
    const lockBefore = store.packLock;
    const coreTagsBefore = [...store.coreTags];

    // A refresh that dies mid-flight (HTTP 500 on the pointer).
    globalThis.fetch = mock(
      async () => new Response('boom', { status: 500 }),
    ) as unknown as typeof fetch;
    const writesBefore = writeCount;
    await store.rescanAssets();

    expect(store.error).toBeTruthy();
    expect(store.seed).toBe(seedBefore);
    expect(store.manifest).toBe(manifestBefore);
    expect(store.packLock).toEqual(lockBefore);
    expect([...store.coreTags]).toEqual(coreTagsBefore);
    // A partial failure must never overwrite the last good record.
    expect(writeCount).toBe(writesBefore);
    expect(persistedRecord).toBe(recordAfterSuccess);
  });

  it('restores the snapshot after an explicit rescan fails with no active catalog', async () => {
    serve(await releaseOne());
    const online = await bootStore();
    online.setSnapshotStore(createDeviceBackend());
    await online.rescanAssets();

    // A boot whose first load failed closed (nothing active), then an explicit
    // rescan while offline: the verified record is still better than nothing.
    serveUnreachable();
    const offline = await bootStore();
    offline.setSnapshotStore(createDeviceBackend());
    await offline.fetchManifest();
    expect(offline.catalogOrigin).toBe('offline-snapshot');

    // Explicit rescan, still offline → keeps serving the snapshot.
    await offline.rescanAssets();
    expect(offline.catalogOrigin).toBe('offline-snapshot');
    expect(offline.seed?.rows).toHaveLength(2);
    expect(offline.error).toBeTruthy();
  });

  it('reports a newer release without blending it into the live catalog', async () => {
    serve(await releaseOne());
    const store = await bootStore();
    store.setSnapshotStore(createDeviceBackend());
    await store.rescanAssets();

    // A later boot: the device restores its cached release, and the origin has
    // moved on to different bytes.
    serve(await releaseTwo());
    const next = await bootStore();
    next.setSnapshotStore(createDeviceBackend());
    await next.fetchManifest();

    await waitFor(() => next.newerReleaseId !== undefined, 'the origin check');

    // Reported, not applied: the live catalog still describes release one.
    expect(next.newerReleaseId).toBe('release-two');
    expect(next.releaseId).toBe('release-one');
    expect(next.catalogOrigin).toBe('offline-snapshot');
    expect(next.seed?.rows.find((row) => row.tag === CORE_TAG)?.hash).toBe(HASH_BODY);
    expect(next.coreTags.size).toBe(1);
    // …and the persisted record is still the release the cache holds.
    const persisted = await decodeCatalogSnapshot(persistedRecord ?? '');
    expect(persisted?.releaseId).toBe('release-one');
  });

  it('adopts the newer release — and its new snapshot — on an explicit rescan', async () => {
    serve(await releaseOne());
    const store = await bootStore();
    store.setSnapshotStore(createDeviceBackend());
    await store.rescanAssets();

    serve(await releaseTwo());
    const next = await bootStore();
    next.setSnapshotStore(createDeviceBackend());
    await next.fetchManifest();
    await waitFor(() => next.newerReleaseId !== undefined, 'the origin check');

    await next.rescanAssets();

    expect(next.catalogOrigin).toBe('network');
    expect(next.releaseId).toBe('release-two');
    expect(next.seed?.rows.find((row) => row.tag === CORE_TAG)?.hash).toBe('9'.repeat(64));
    expect(next.newerReleaseId).toBeUndefined();

    const persisted = await decodeCatalogSnapshot(persistedRecord ?? '');
    expect(persisted?.releaseId).toBe('release-two');
    expect(persisted?.seed.rows.find((row) => row.tag === CORE_TAG)?.hash).toBe('9'.repeat(64));
  });

  it('leaves the catalog untouched when the background origin check fails', async () => {
    serve(await releaseOne());
    const store = await bootStore();
    store.setSnapshotStore(createDeviceBackend());
    await store.rescanAssets();

    serveUnreachable();
    const next = await bootStore();
    next.setSnapshotStore(createDeviceBackend());
    await next.fetchManifest();

    // The check is detached, so give it a chance to fail and finish.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(next.catalogOrigin).toBe('offline-snapshot');
    expect(next.releaseId).toBe('release-one');
    expect(next.newerReleaseId).toBeUndefined();
    expect(next.seed?.rows).toHaveLength(2);
  });

  it('serves a hash-verified cached binary when no catalog ever loaded', async () => {
    // Defence in depth: with no catalog at all, a blob URL that exists only
    // because the cached bytes verified against the local registry is still
    // safe to hand out.
    cachedBlobs.set(MUSIC_TAG, 'blob:mock/music');
    serveUnreachable();

    const store = await bootStore();
    store.setSnapshotStore(createDeviceBackend());
    await store.fetchManifest();

    expect(store.seed).toBeNull();
    expect(store.resolveUrl(MUSIC_TAG)).toBe('blob:mock/music');
    // Still null for a tag the device has never verified.
    expect(store.resolveUrl('music:exploration:unknown')).toBeNull();
  });

  it('restores the REAL published catalog shape', async () => {
    // The shape production actually publishes, captured verbatim from the live
    // release graph and trimmed to one row per distinct (category, ext) pair
    // plus every offline-core tag — see
    // packages/frontend/storage/src/lib/__tests__/fixtures/published_catalog_release.json
    //
    // Three properties matter and all three were true in production:
    //   • `originUrl` is EMPTY (the R2 base is PUBLIC_ASSETS_BASE_URL), and a
    //     validator that demanded a non-empty origin rejected the whole graph;
    //   • categories include `contentPacks` and extensions include `.jton`;
    //   • rows carry real `licenses` records.
    const realRows = [
      {
        tag: 'emberwatch:audio:emberwatch_combat',
        hash: '7989c905e85ef41948860ae0e7d042a9fc412ae478eb2ed2ee6b30e0634caf9a',
        sizeBytes: 1001415,
        category: 'contentPacks',
        ext: '.webm',
        licenses: ['Apache-2.0'],
      },
      {
        tag: 'maps:village',
        hash: 'a'.repeat(64),
        sizeBytes: 245760,
        category: 'maps',
        ext: '.jton',
        licenses: [],
      },
      {
        tag: 'portraits:emberwatch:merchant:neutral',
        hash: 'b'.repeat(64),
        sizeBytes: 4096,
        category: 'portraits',
        ext: '.png',
        licenses: ['CC-BY-SA-3.0'],
      },
    ];
    const realSnapshot: CatalogSnapshot = {
      releaseId: '2026-09-27T13:34:17.944Z',
      releaseSource: 'release',
      seed: {
        schemaVersion: 1,
        generatedAt: '2026-09-27T11:25:00.401Z',
        originUrl: '',
        rows: realRows,
      },
      coreTags: ['maps:village', 'emberwatch:audio:emberwatch_combat'],
      packLock: {
        schemaVersion: 'catalog.release.v1',
        releaseId: '2026-09-27T13:34:17.944Z',
        assets: [
          {
            id: 'sprites:tilesets:atlas.webp',
            imageHash: 'c'.repeat(64),
            definitionHash: 'd'.repeat(64),
          },
        ],
        audioAssets: [{ id: 'village.music', renditionHash: 'e'.repeat(64) }],
      },
      packLockSource: 'release',
    };
    persistedRecord = await encodeCatalogSnapshot(realSnapshot);

    serveUnreachable();
    const store = await bootStore();
    store.setSnapshotStore(createDeviceBackend());
    await store.fetchManifest();

    expect(store.catalogOrigin).toBe('offline-snapshot');
    expect(store.seed?.rows).toHaveLength(3);
    expect(store.seed?.originUrl).toBe('');
    expect(store.manifest?.count).toBe(3);
    expect(store.manifest?.assets['maps:village']?.category).toBe('maps');
    expect([...store.coreTags]).toEqual(['maps:village', 'emberwatch:audio:emberwatch_combat']);
    expect(store.packLock?.assets[0]?.id).toBe('sprites:tilesets:atlas.webp');
    expect(store.packLockSource).toBe('release');
    // The odd production extension still resolves to a real R2 object.
    expect(store.resolveUrl('maps:village')).toBe(
      `${ORIGIN}/assets/${'a'.repeat(2)}/${'a'.repeat(64)}.jton`,
    );
    expect(store.resolveLicenses('emberwatch:audio:emberwatch_combat')).toEqual(['Apache-2.0']);
  });
});
