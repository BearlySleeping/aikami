// apps/frontend/client/src/lib/services/assets/registry_resolver_cache_ready.test.ts
// biome-ignore-all lint/style/useNamingConvention: mock properties mirror external API / enum names
//
// The cache-consumption handshake (`awaitRegistryReady`).
//
// Proven production failure this locks down: with the catalog restored from the
// device snapshot but the AssetManager not yet rehydrated, `resolveUrl` — being
// SYNCHRONOUS — falls through to `_originUrl(row)` and returns a NETWORK url
// for bytes the device already holds. A content-pack load starting in that
// window fetches the publish origin and, offline, aborts with
// `ContentPackLoader: failed to fetch manifest`, killing the composition root
// before the later, correctly hydrated map load could announce MAP_LOADED.
//
// The fix is ordering, not retry: a consumer awaits catalog + rehydration
// before it resolves a single tag.
//
// Run with:
//   bun test --isolate --preload ./src/lib/test_setup.ts \
//     --tsconfig-override=tsconfig.test.json \
//     src/lib/services/assets/registry_resolver_cache_ready.test.ts

import { describe, expect, it, mock } from 'bun:test';

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

/** The order the handshake actually performs its work in. */
const calls: string[] = [];
let catalogReady: Promise<void> | undefined;
let cacheReadyRejection: string | undefined;

const reset = (): void => {
  calls.length = 0;
  catalogReady = undefined;
  cacheReadyRejection = undefined;
};

mock.module('./asset_store.svelte.ts', () => ({
  assetStore: {
    fetchManifest: async (): Promise<void> => {
      catalogReady ??= (async () => {
        calls.push('fetchManifest:start');
        await Promise.resolve();
        calls.push('fetchManifest:end');
      })();
      await catalogReady;
    },
    coreTags: new Set(['emberwatch:manifest']),
  },
}));

mock.module('./asset_prefetch_service.svelte.ts', () => ({
  assetPrefetchService: {
    ensureRegistryReady: async (): Promise<void> => {
      calls.push('ensureRegistryReady:start');
      // A real rehydration takes time; the ordering assertion depends on it.
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (cacheReadyRejection !== undefined) {
        throw new Error(cacheReadyRejection);
      }
      calls.push('ensureRegistryReady:end');
    },
  },
}));

mock.module('@aikami/frontend/engine/sim', () => ({
  pathToTag: (filePath: string): string => filePath.replace(/\//g, ':'),
}));

import { assetPrefetchService } from './asset_prefetch_service.svelte.ts';
import { awaitRegistryReady, createAssetTagResolver } from './registry_resolver.ts';

describe('awaitRegistryReady — the cache-consumption handshake', () => {
  it('loads the catalog BEFORE rehydration, because rehydration needs coreTags', async () => {
    reset();
    await awaitRegistryReady();

    expect(calls).toEqual([
      'fetchManifest:start',
      'fetchManifest:end',
      'ensureRegistryReady:start',
      'ensureRegistryReady:end',
    ]);
  });

  it('does not resolve until rehydration has actually finished', async () => {
    reset();
    let settled = false;
    const handshake = awaitRegistryReady().then(() => {
      settled = true;
    });

    // Resolution is impossible before the work completes — this is the whole
    // point of the handshake, versus the old fire-and-forget ordering.
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(settled).toBe(false);

    await handshake;
    expect(settled).toBe(true);
  });

  it('requests prefetch for each caller while the store memoizes the catalog load', async () => {
    reset();
    let prefetchCalls = 0;
    const original = assetPrefetchService.ensureRegistryReady;
    assetPrefetchService.ensureRegistryReady = async (): Promise<void> => {
      prefetchCalls += 1;
      await original();
    };

    try {
      await Promise.all([awaitRegistryReady(), awaitRegistryReady(), awaitRegistryReady()]);
      expect(prefetchCalls).toBe(3);
      // The catalog load is memoized inside the store, so it ran once.
      expect(calls.filter((entry) => entry === 'fetchManifest:start')).toHaveLength(1);
    } finally {
      assetPrefetchService.ensureRegistryReady = original;
    }
  });

  it('degrades instead of throwing when the device cache cannot hydrate', async () => {
    reset();
    cacheReadyRejection = 'OPFS unavailable';

    // The boot pipeline treats registry init as degradable; killing the caller
    // here would be a NEW failure mode.
    await expect(awaitRegistryReady()).resolves.toBeUndefined();
  });

  it('leaves the synchronous resolver contract untouched', async () => {
    reset();
    const resolve = createAssetTagResolver();

    // Still synchronous and still null-without-a-catalog — the handshake is the
    // consumer's obligation, not a change to resolveUrl's shape.
    expect(typeof resolve).toBe('function');
    expect(resolve('content-packs/emberwatch/manifest.json')).toBeNull();
  });
});
