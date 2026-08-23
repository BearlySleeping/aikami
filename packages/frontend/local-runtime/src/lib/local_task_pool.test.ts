// packages/frontend/local-runtime/src/lib/local_task_pool.test.ts
//
// Unit tests for LocalTaskPool — parallel micro-task runner.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { LocalModelBundle } from '@aikami/constants';
import type { EngineBackend } from '@aikami/types';
import { LocalTaskPool } from './local_task_pool.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_BUNDLE: LocalModelBundle = {
  id: 'test-llm',
  label: 'Test LLM',
  license: 'Apache-2.0',
  modality: 'text',
  repo: 'test-org/test-repo',
  revision: 'main',
  manifestVersion: 1,
  manifestKey: 'test-llm-manifest',
  assets: [
    {
      path: 'model.bin',
      bytes: 100,
      sha256: 'ecd71870d1963316a97e3ac3408c9835ad8cf0f3c1bc703527c30265534f75ae',
      cache: 'test-cache',
      key: 'test-llm-model.bin',
    },
  ],
};

const createMockBackendWithGenerate = (): EngineBackend & {
  generate: (prompt: string) => Promise<string>;
} => ({
  kind: 'wasm' as const,
  dispose: mock(async () => {}),
  generate: mock(async (_prompt: string) => 'mock output'),
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

const installCachePolyfillLocal = (): void => {
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

const uninstallCachePolyfillLocal = (): void => {
  delete (globalThis as Record<string, unknown>).caches;
};

const seedCacheLocal = async (): Promise<void> => {
  for (const asset of TEST_BUNDLE.assets) {
    const cache = await caches.open(asset.cache);
    await cache.put(asset.key, new Response(new Uint8Array(asset.bytes)));
  }
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LocalTaskPool', () => {
  beforeEach(() => {
    installCachePolyfillLocal();
  });

  afterEach(() => {
    uninstallCachePolyfillLocal();
  });

  test('initial state has zero active and queued tasks', () => {
    const pool = new LocalTaskPool({
      bundle: TEST_BUNDLE,
      loader: async () => createMockBackendWithGenerate(),
    });

    expect(pool.activeCount).toBe(0);
    expect(pool.queuedCount).toBe(0);
    expect(pool.maxConcurrency).toBe(2);
  });

  test('ensureLoaded loads the underlying engine', async () => {
    await seedCacheLocal();

    const pool = new LocalTaskPool({
      bundle: TEST_BUNDLE,
      loader: async () => createMockBackendWithGenerate(),
    });

    await pool.ensureLoaded();
    expect(pool.engine.isLoaded).toBe(true);
  });

  test('submit() executes a task and returns the result', async () => {
    await seedCacheLocal();

    const pool = new LocalTaskPool({
      bundle: TEST_BUNDLE,
      loader: async () => createMockBackendWithGenerate(),
    });
    await pool.ensureLoaded();

    const result = await pool.submit({
      type: 'expression',
      payload: { prose: 'Alice smiled warmly', characters: ['Alice'] },
    });

    expect(result.type).toBe('expression');
    expect(result.output).toBe('mock output');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test('submit() rejects if engine is not loaded', async () => {
    const pool = new LocalTaskPool({
      bundle: TEST_BUNDLE,
      loader: async () => createMockBackendWithGenerate(),
    });

    await expect(
      pool.submit({
        type: 'expression',
        payload: { prose: 'Alice smiled warmly', characters: ['Alice'] },
      }),
    ).rejects.toThrow('Engine not loaded');
  });

  test('submit() respects abort signal', async () => {
    await seedCacheLocal();

    const pool = new LocalTaskPool({
      bundle: TEST_BUNDLE,
      loader: async () => createMockBackendWithGenerate(),
    });
    await pool.ensureLoaded();

    const controller = new AbortController();
    const promise = pool.submit(
      { type: 'expression', payload: { prose: 'Alice smiled warmly', characters: ['Alice'] } },
      controller.signal,
    );
    controller.abort();

    await expect(promise).rejects.toThrow('Aborted');
  });

  test('concurrent tasks respect maxConcurrency', async () => {
    await seedCacheLocal();

    let concurrentCount = 0;
    let maxObserved = 0;

    const backend: EngineBackend & { generate: (prompt: string) => Promise<string> } = {
      kind: 'wasm' as const,
      dispose: mock(async () => {}),
      generate: mock(async (_prompt: string) => {
        concurrentCount++;
        maxObserved = Math.max(maxObserved, concurrentCount);
        await new Promise((resolve) => setTimeout(resolve, 50));
        concurrentCount--;
        return 'mock';
      }),
    };

    const pool = new LocalTaskPool({
      bundle: TEST_BUNDLE,
      loader: async () => backend,
      maxConcurrency: 2,
    });
    await pool.ensureLoaded();

    const tasks = Array.from({ length: 5 }, (_, i) =>
      pool.submit({
        type: 'expression',
        payload: { prose: `Character ${i} acted`, characters: [`Char${i}`] },
      }),
    );

    await Promise.all(tasks);

    expect(maxObserved).toBeLessThanOrEqual(2);
  });

  test('dispose() rejects queued tasks and unloads engine', async () => {
    await seedCacheLocal();

    const pool = new LocalTaskPool({
      bundle: TEST_BUNDLE,
      loader: async () => createMockBackendWithGenerate(),
    });
    await pool.ensureLoaded();

    // Submit a task that will be queued (concurrency is 2, so 3rd is queued)
    const slowBackend: EngineBackend & { generate: (prompt: string) => Promise<string> } = {
      kind: 'wasm' as const,
      dispose: mock(async () => {}),
      generate: mock(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return 'slow';
      }),
    };
    // Replace the engine's backend with a slow one
    Object.defineProperty(pool.engine, '_backend', { value: slowBackend });

    const promises = Array.from({ length: 3 }, (_, i) =>
      pool.submit({
        type: 'expression',
        payload: { prose: `Character ${i} acted`, characters: [`Char${i}`] },
      }),
    );

    await pool.dispose();

    // At least one task should be rejected
    const results = await Promise.allSettled(promises);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected.length).toBeGreaterThanOrEqual(1);

    expect(pool.engine.isLoaded).toBe(false);
  });

  test('drain() waits for all queued tasks to complete', async () => {
    await seedCacheLocal();

    const backend: EngineBackend & { generate: (prompt: string) => Promise<string> } = {
      kind: 'wasm' as const,
      dispose: mock(async () => {}),
      generate: mock(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return 'done';
      }),
    };

    const pool = new LocalTaskPool({
      bundle: TEST_BUNDLE,
      loader: async () => backend,
      maxConcurrency: 4,
    });
    await pool.ensureLoaded();

    const tasks = Array.from({ length: 4 }, (_, i) =>
      pool.submit({
        type: 'expression',
        payload: { prose: `Character ${i} acted`, characters: [`Char${i}`] },
      }),
    );

    await pool.drain();

    const results = await Promise.all(tasks);
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.output === 'done')).toBe(true);
  });
});
