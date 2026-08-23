// packages/frontend/local-runtime/src/lib/local_engine.test.ts
//
// Unit tests for LocalEngine — modality-agnostic engine lifecycle.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { LocalModelBundle } from '@aikami/constants';
import type { EngineBackend } from '@aikami/types';
import { LocalEngine } from './local_engine.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_BUNDLE: LocalModelBundle = {
  id: 'test-model',
  label: 'Test Model',
  license: 'Apache-2.0',
  modality: 'voice',
  repo: 'test-org/test-repo',
  revision: 'main',
  manifestVersion: 1,
  manifestKey: 'test-model-manifest',
  assets: [
    {
      path: 'model.bin',
      bytes: 100,
      sha256: 'ecd71870d1963316a97e3ac3408c9835ad8cf0f3c1bc703527c30265534f75ae',
      cache: 'test-cache',
      key: 'test-model-model.bin',
    },
    {
      path: 'config.json',
      bytes: 50,
      sha256: '6f5902a4fc6d2f7a9c6e3c5f8b3d8c9e2a1b4d7f6e8c9a0b2c3d4e5f6a7b8c9',
      cache: 'test-cache',
      key: 'test-model-config.json',
    },
  ],
};

const createMockBackend = (): EngineBackend => ({
  kind: 'wasm' as const,
  dispose: mock(async () => {}),
});

// ---------------------------------------------------------------------------
// Cache polyfill
// ---------------------------------------------------------------------------

class MemoryCache {
  private readonly _entries = new Map<string, Response>();

  async match(request: string | Request): Promise<Response | undefined> {
    const key = typeof request === 'string' ? request : request.url;
    return this._entries.get(key);
  }

  async put(request: string | Request, response: Response): Promise<void> {
    const key = typeof request === 'string' ? request : request.url;
    this._entries.set(key, response);
  }

  async delete(request: string | Request): Promise<boolean> {
    const key = typeof request === 'string' ? request : request.url;
    return this._entries.delete(key);
  }
}

const installCachePolyfill = (): void => {
  const stores = new Map<string, MemoryCache>();
  (globalThis as Record<string, unknown>).caches = {
    open: async (name: string): Promise<MemoryCache> => {
      let store = stores.get(name);
      if (!store) {
        store = new MemoryCache();
        stores.set(name, store);
      }
      return store;
    },
  };
};

const uninstallCachePolyfill = (): void => {
  delete (globalThis as Record<string, unknown>).caches;
};

/** Seed the cache with test asset data. */
const seedCache = async (): Promise<void> => {
  for (const asset of TEST_BUNDLE.assets) {
    const cache = await caches.open(asset.cache);
    await cache.put(asset.key, new Response(new Uint8Array(asset.bytes)));
  }
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LocalEngine', () => {
  beforeEach(() => {
    installCachePolyfill();
  });

  afterEach(() => {
    uninstallCachePolyfill();
  });

  test('initial state is not-downloaded', () => {
    const engine = new LocalEngine({
      bundle: TEST_BUNDLE,
      loader: async () => createMockBackend(),
    });

    expect(engine.state.status).toBe('not-downloaded');
    expect(engine.isLoaded).toBe(false);
    expect(engine.backend).toBeNull();
  });

  test('load() reads assets from cache and invokes the loader', async () => {
    await seedCache();

    const loader = mock(async (files: ReadonlyArray<{ path: string; data: ArrayBuffer }>) => {
      expect(files).toHaveLength(2);
      expect(files[0].path).toBe('model.bin');
      expect(files[0].data.byteLength).toBe(100);
      expect(files[1].path).toBe('config.json');
      expect(files[1].data.byteLength).toBe(50);
      return createMockBackend();
    });

    const engine = new LocalEngine({ bundle: TEST_BUNDLE, loader });
    const state = await engine.load();

    expect(state.status).toBe('ready');
    expect(engine.isLoaded).toBe(true);
    expect(engine.backend).not.toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test('load() is idempotent — second call returns immediately', async () => {
    await seedCache();

    const loader = mock(async () => createMockBackend());

    const engine = new LocalEngine({ bundle: TEST_BUNDLE, loader });
    await engine.load();
    const state2 = await engine.load();

    expect(state2.status).toBe('ready');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test('load() throws if assets are not in cache', async () => {
    const engine = new LocalEngine({
      bundle: TEST_BUNDLE,
      loader: async () => createMockBackend(),
    });

    const state = await engine.load();

    expect(state.status).toBe('error');
    expect(state.status === 'error' ? state.message : '').toContain('not in cache');
  });

  test('unload() disposes the backend and resets state', async () => {
    await seedCache();

    const backend = createMockBackend();
    const engine = new LocalEngine({
      bundle: TEST_BUNDLE,
      loader: async () => backend,
    });

    await engine.load();
    expect(engine.isLoaded).toBe(true);

    await engine.unload();

    expect(engine.isLoaded).toBe(false);
    expect(engine.backend).toBeNull();
    expect(engine.state.status).toBe('not-downloaded');
    expect(backend.dispose).toHaveBeenCalledTimes(1);
  });

  test('reload() unloads then loads again', async () => {
    await seedCache();

    const loader = mock(async () => createMockBackend());

    const engine = new LocalEngine({ bundle: TEST_BUNDLE, loader });
    await engine.load();
    expect(loader).toHaveBeenCalledTimes(1);

    const state = await engine.reload();
    expect(state.status).toBe('ready');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  test('load() respects abort signal', async () => {
    await seedCache();

    const engine = new LocalEngine({
      bundle: TEST_BUNDLE,
      loader: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        return createMockBackend();
      },
    });

    const controller = new AbortController();
    const promise = engine.load(controller.signal);
    controller.abort();

    const state = await promise;
    expect(state.status).toBe('not-downloaded');
  });
});
