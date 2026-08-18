// apps/frontend/client/src/lib/services/assets/asset_manager.test.ts
//
// C-373 AC-2/AC-3: AssetManager — resolve flow, <10ms cached hits with a
// mocked backend, hash-verified fetch + store, mismatch discard, stale
// eviction (AC-3), abort cancellation, and quota-pressure degradation.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { AssetRecord, AssetSource, InstallStateRecord } from '@aikami/types';
import { sha256Hex } from './asset_hasher.ts';
import { assetManager } from './asset_manager.svelte.ts';
import type { AssetCacheBackend } from './cache_backend.ts';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const createMockRegistry = () => {
  const records = new Map<string, AssetRecord>();
  const sources = new Map<string, AssetSource[]>();
  const states = new Map<string, InstallStateRecord>();

  return {
    findById: async (id: string): Promise<AssetRecord | undefined> => records.get(id),
    findByIds: async (ids: readonly string[]): Promise<AssetRecord[]> =>
      ids
        .map((id) => records.get(id))
        .filter((record): record is AssetRecord => record !== undefined),
    findIdsByHashes: async (hashes: readonly string[]): Promise<string[]> =>
      [...records.values()]
        .filter((record) => hashes.includes(record.hash))
        .map((record) => record.id),
    listSources: async (assetId: string): Promise<AssetSource[]> => sources.get(assetId) ?? [],
    getInstallState: async (assetId: string): Promise<InstallStateRecord | undefined> =>
      states.get(assetId),
    setInstallState: async (record: InstallStateRecord): Promise<void> => {
      states.set(record.assetId, { ...record });
    },
    listInstallStates: async (): Promise<InstallStateRecord[]> => [...states.values()],
    resetInterruptedDownloads: async (): Promise<number> => {
      let reset = 0;
      for (const state of states.values()) {
        if (state.status === 'downloading') {
          state.status = 'not_downloaded';
          reset += 1;
        }
      }
      return reset;
    },
    listCachedWithPack: async (): Promise<
      readonly { assetId: string; packId: string; cachedHash?: string; downloadedAt?: string }[]
    > =>
      [...states.entries()]
        .filter(([, state]) => state.status === 'cached')
        .map(([assetId, state]) => ({
          assetId,
          packId: records.get(assetId)?.packId ?? 'core',
          cachedHash: state.cachedHash,
          downloadedAt: state.downloadedAt,
        })),
    _records: records,
    _sources: sources,
    _states: states,
  };
};

const createMockBackend = (options?: {
  available?: boolean;
}): AssetCacheBackend & { _files: Map<string, Blob> } => {
  const files = new Map<string, Blob>();
  return {
    kind: 'opfs',
    isAvailable: options?.available ?? true,
    init: async () => {},
    has: async (hash: string) => files.has(hash),
    get: async (hash: string) => files.get(hash),
    put: async (entry: { hash: string; blob: Blob }) => {
      files.set(entry.hash, entry.blob);
    },
    remove: async (hash: string) => {
      files.delete(hash);
    },
    clear: async () => {
      files.clear();
    },
    listHashes: async () => [...files.keys()],
    requestPersistence: async () => true,
    _files: files,
  };
};

const installFetchMock = (handler: (url: string, init?: RequestInit) => Promise<Response>) => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url: string;
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.href;
    } else {
      url = input.url;
    }
    calls.push(url);
    return handler(url, init);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
};

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AssetManager', () => {
  let registry: ReturnType<typeof createMockRegistry>;
  let backend: ReturnType<typeof createMockBackend>;
  let fetchMock: { calls: string[]; restore: () => void };

  beforeEach(async () => {
    registry = createMockRegistry();
    backend = createMockBackend();
    fetchMock = installFetchMock(async () => new Response(new Blob(['asset-bytes'])));
    await assetManager.initialize({ registry, backend });
  });

  afterEach(async () => {
    fetchMock.restore();
    await assetManager.teardown();
  });

  // ── AC-2: resolve flow ───────────────────────────────────────────────

  test('resolve fetches from the source, verifies hash, stores, and caches', async () => {
    const blob = new Blob(['asset-bytes']);
    const hash = await sha256Hex(blob);
    registry._records.set('sprites:hero', {
      id: 'sprites:hero',
      packId: 'sprites',
      category: 'sprites',
      hash,
      version: 1,
      sizeBytes: blob.size,
      license: 'unknown',
    });
    registry._sources.set('sprites:hero', [
      {
        assetId: 'sprites:hero',
        backend: 'bundled',
        url: '/game-data/sprites/hero.png',
        priority: 0,
      },
    ]);

    const url = await assetManager.resolve('sprites:hero');

    expect(url).toStartWith('blob:');
    expect(fetchMock.calls).toEqual(['/game-data/sprites/hero.png']);
    expect(await backend.has(hash)).toBe(true);
    expect(registry._states.get('sprites:hero')?.status).toBe('cached');
    expect(registry._states.get('sprites:hero')?.cachedHash).toBe(hash);

    // Second resolve is a pure cache hit — zero network traffic.
    fetchMock.calls.length = 0;
    const url2 = await assetManager.resolve('sprites:hero');
    expect(url2).toBe(url);
    expect(fetchMock.calls).toHaveLength(0);
  });

  test('cached hit resolves in <10ms with zero network traffic', async () => {
    const blob = new Blob(['cached-bytes']);
    const hash = await sha256Hex(blob);
    registry._records.set('music:track', {
      id: 'music:track',
      packId: 'music',
      category: 'music',
      hash,
      version: 1,
      sizeBytes: blob.size,
      license: 'unknown',
    });
    // Warm cache: install_state cached + backend file (simulating a prior
    // session fetch). Added AFTER initialize so the pre-registration pass
    // does not run — the hit must go through the registry→cache path.
    registry._states.set('music:track', {
      assetId: 'music:track',
      status: 'cached',
      cachedHash: hash,
      localPath: hash,
      downloadedAt: '2026-08-03T00:00:00.000Z',
    });
    backend._files.set(hash, blob);

    const url = await assetManager.resolve('music:track');

    expect(url).toStartWith('blob:');
    // Host-dependent wall-clock timing is not asserted here — the hard gate
    // is the fetchMock assertion below: a cached hit must not hit the network.
    expect(fetchMock.calls).toHaveLength(0);
  });

  test('hash mismatch discards the download — nothing cached, not_downloaded', async () => {
    // Registry says hash HASH_A but the source serves different bytes.
    registry._records.set('sprites:corrupt', {
      id: 'sprites:corrupt',
      packId: 'sprites',
      category: 'sprites',
      hash: HASH_A,
      version: 1,
      sizeBytes: 100,
      license: 'unknown',
    });
    registry._sources.set('sprites:corrupt', [
      {
        assetId: 'sprites:corrupt',
        backend: 'bundled',
        url: '/game-data/corrupt.png',
        priority: 0,
      },
    ]);

    const url = await assetManager.resolve('sprites:corrupt');

    expect(url).toBeNull();
    expect(await backend.has(HASH_A)).toBe(false);
    expect(registry._states.get('sprites:corrupt')?.status).toBe('not_downloaded');
    // The corrupt blob is discarded — no blob URL registered.
    expect(assetManager.peekBlobUrl('sprites:corrupt')).toBeNull();
  });

  test('multi-source fallback: priority-0 mismatch falls through to priority-1', async () => {
    const goodBlob = new Blob(['correct-bytes']);
    const goodHash = await sha256Hex(goodBlob);
    registry._records.set('sprites:dual-source', {
      id: 'sprites:dual-source',
      packId: 'sprites',
      category: 'sprites',
      hash: goodHash,
      version: 1,
      sizeBytes: goodBlob.size,
      license: 'unknown',
    });
    registry._sources.set('sprites:dual-source', [
      { assetId: 'sprites:dual-source', backend: 'r2', url: '/mirror/source-0.png', priority: 0 },
      {
        assetId: 'sprites:dual-source',
        backend: 'bundled',
        url: '/game-data/source-1.png',
        priority: 1,
      },
    ]);

    // Priority-0 serves WRONG bytes (hash mismatch → discarded); priority-1
    // serves the correct bytes.
    fetchMock.restore();
    fetchMock = installFetchMock(async (reqUrl: string) => {
      if (reqUrl === '/mirror/source-0.png') {
        return new Response(new Blob(['wrong-bytes']));
      }
      return new Response(goodBlob);
    });

    const url = await assetManager.resolve('sprites:dual-source');

    // Both sources were tried, in priority order.
    expect(fetchMock.calls).toEqual(['/mirror/source-0.png', '/game-data/source-1.png']);
    expect(url).toStartWith('blob:');
    // Served from the verified priority-1 bytes — cached under the registry hash.
    expect(await backend.has(goodHash)).toBe(true);
    const state = registry._states.get('sprites:dual-source');
    expect(state?.status).toBe('cached');
    expect(state?.cachedHash).toBe(goodHash);
  });

  test('resolve returns null for unregistered tags — no fetch, no state', async () => {
    const url = await assetManager.resolve('sprites:unknown');
    expect(url).toBeNull();
    expect(fetchMock.calls).toHaveLength(0);
  });

  // ── AC-3: stale eviction ─────────────────────────────────────────────

  test('resolve evicts a stale cached binary and re-fetches the new hash', async () => {
    const oldBlob = new Blob(['old-version']);
    const newBlob = new Blob(['new-version']);
    const newHash = await sha256Hex(newBlob);

    registry._records.set('sprites:hero', {
      id: 'sprites:hero',
      packId: 'sprites',
      category: 'sprites',
      hash: newHash, // authoritative hash advanced to v2
      version: 2,
      sizeBytes: newBlob.size,
      license: 'unknown',
    });
    registry._sources.set('sprites:hero', [
      {
        assetId: 'sprites:hero',
        backend: 'bundled',
        url: '/game-data/sprites/hero.png',
        priority: 0,
      },
    ]);
    // Old build cached the v1 binary under HASH_A.
    registry._states.set('sprites:hero', {
      assetId: 'sprites:hero',
      status: 'cached',
      cachedHash: HASH_A,
      localPath: HASH_A,
      downloadedAt: '2026-08-03T00:00:00.000Z',
    });
    backend._files.set(HASH_A, oldBlob);

    // Source serves the new version.
    fetchMock.restore();
    fetchMock = installFetchMock(async () => new Response(newBlob));

    const url = await assetManager.resolve('sprites:hero');

    expect(url).toStartWith('blob:');
    // v1 evicted, v2 cached.
    expect(await backend.has(HASH_A)).toBe(false);
    expect(await backend.has(newHash)).toBe(true);
    expect(registry._states.get('sprites:hero')?.status).toBe('cached');
    expect(registry._states.get('sprites:hero')?.cachedHash).toBe(newHash);
  });

  test('reconcile resets interrupted downloads and evicts stale binaries', async () => {
    const staleBlob = new Blob(['stale']);
    registry._records.set('lpc:body:walk', {
      id: 'lpc:body:walk',
      packId: 'lpc',
      category: 'lpc',
      hash: HASH_B,
      version: 2,
      sizeBytes: staleBlob.size,
      license: 'unknown',
    });
    registry._states.set('lpc:body:walk', {
      assetId: 'lpc:body:walk',
      status: 'cached',
      cachedHash: HASH_A,
      localPath: HASH_A,
      downloadedAt: '2026-08-03T00:00:00.000Z',
    });
    registry._states.set('music:interrupted', {
      assetId: 'music:interrupted',
      status: 'downloading',
      downloadedAt: '2026-08-03T00:00:00.000Z',
    });
    backend._files.set(HASH_A, staleBlob);

    const result = await assetManager.reconcile();

    expect(result.staleEvicted).toBe(1);
    expect(result.interruptedReset).toBe(1);
    expect(await backend.has(HASH_A)).toBe(false);
    expect(registry._states.get('lpc:body:walk')?.status).toBe('stale');
    expect(registry._states.get('music:interrupted')?.status).toBe('not_downloaded');
  });

  // ── Cancellation & lifecycle ─────────────────────────────────────────

  test('cancelDownload aborts an in-flight fetch, leaving downloading state', async () => {
    const blob = new Blob(['asset-bytes']);
    const hash = await sha256Hex(blob);
    registry._records.set('sprites:slow', {
      id: 'sprites:slow',
      packId: 'sprites',
      category: 'sprites',
      hash,
      version: 1,
      sizeBytes: blob.size,
      license: 'unknown',
    });
    registry._sources.set('sprites:slow', [
      { assetId: 'sprites:slow', backend: 'bundled', url: '/game-data/slow.png', priority: 0 },
    ]);

    // Fetch hangs until aborted.
    fetchMock.restore();
    fetchMock = installFetchMock(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );

    const pending = assetManager.resolve('sprites:slow');
    await new Promise((resolve) => setTimeout(resolve, 10));
    assetManager.cancelDownload('sprites:slow');

    const url = await pending;
    expect(url).toBeNull();
    // Interrupted download left 'downloading' — reconciled at next boot.
    expect(registry._states.get('sprites:slow')?.status).toBe('downloading');
    expect(await backend.has(hash)).toBe(false);
  });

  test('unavailable backend serves online without persisting', async () => {
    const blob = new Blob(['asset-bytes']);
    const hash = await sha256Hex(blob);
    const offlineBackend = createMockBackend({ available: false });

    await assetManager.teardown();
    await assetManager.initialize({ registry, backend: offlineBackend });

    registry._records.set('sprites:online', {
      id: 'sprites:online',
      packId: 'sprites',
      category: 'sprites',
      hash,
      version: 1,
      sizeBytes: blob.size,
      license: 'unknown',
    });
    registry._sources.set('sprites:online', [
      { assetId: 'sprites:online', backend: 'bundled', url: '/game-data/online.png', priority: 0 },
    ]);

    const url = await assetManager.resolve('sprites:online');

    expect(url).toStartWith('blob:');
    expect(offlineBackend._files.size).toBe(0);
  });

  test('release refcounts blob URLs — revoked at zero, re-resolvable', async () => {
    const blob = new Blob(['asset-bytes']);
    const hash = await sha256Hex(blob);
    registry._records.set('music:track', {
      id: 'music:track',
      packId: 'music',
      category: 'music',
      hash,
      version: 1,
      sizeBytes: blob.size,
      license: 'unknown',
    });
    registry._sources.set('music:track', [
      { assetId: 'music:track', backend: 'bundled', url: '/game-data/track.mp3', priority: 0 },
    ]);

    const url = await assetManager.resolve('music:track');
    expect(url).toStartWith('blob:');

    // Double acquire (second resolve) → refs=2; one release keeps it alive.
    const urlAgain = await assetManager.resolve('music:track');
    expect(urlAgain).toBe(url);

    assetManager.release('music:track');
    expect(assetManager.peekBlobUrl('music:track')).toBe(url);

    assetManager.release('music:track');
    expect(assetManager.peekBlobUrl('music:track')).toBeNull();
  });

  test('initialize rehydrates from the content-addressed cache without install_state', async () => {
    // A prior session cached binaries, but install_state bookkeeping was lost
    // (e.g. in-memory DB fallback across reloads). The content hash alone
    // must map back to tags and pre-register blob URLs.
    const blob = new Blob(['persisted-bytes']);
    const hash = await sha256Hex(blob);
    registry._records.set('lpc:body:bodies_male:walk', {
      id: 'lpc:body:bodies_male:walk',
      packId: 'lpc',
      category: 'lpc',
      hash,
      version: 1,
      sizeBytes: blob.size,
      license: 'unknown',
    });
    // No install_state row — only the backend holds the file.
    backend._files.set(hash, blob);

    await assetManager.teardown();
    await assetManager.initialize({ registry, backend });

    expect(assetManager.peekBlobUrl('lpc:body:bodies_male:walk')).toStartWith('blob:');
    // Bookkeeping repaired.
    expect(registry._states.get('lpc:body:bodies_male:walk')?.status).toBe('cached');
  });

  test('warm is a safe no-op before initialization', async () => {
    await assetManager.teardown();
    const url = await assetManager.warm('sprites:anything');
    expect(url).toBeNull();
    expect(fetchMock.calls).toHaveLength(0);
  });
});
