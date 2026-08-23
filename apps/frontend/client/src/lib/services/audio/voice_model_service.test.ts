// apps/frontend/client/src/lib/services/audio/voice_model_service.test.ts
//
// Unit tests for the explicit voice-model download control (C-389 AC-4c):
// size surfaced up front, progress, cancel, delete, checksum verification,
// and idempotent join of concurrent downloads.
//
// Since C-427 the service delegates to ModelAssetStore. These tests verify
// the delegation layer — the store's own logic is tested in the
// @aikami/frontend/local-runtime test suite.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// ---------------------------------------------------------------------------
// Minimal in-memory Cache Storage polyfill (Bun lacks the Cache API)
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

  keys(): string[] {
    return [...this._entries.keys()];
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

// ---------------------------------------------------------------------------
// fetch mock — returns a body of exactly the manifest size for each file and
// delegates the SHA-256 computation to a size→hash map so tests stay fast.
// ---------------------------------------------------------------------------

const SIZE_TO_HASH: Record<number, string> = {
  44: 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f',
  4608: 'ee301fc39cf903ddbb463564630a28767785e3a11edd6d8226e92d4b4ef131bb',
  92360543: '0d55b15d4b735d61a21b0105136bc81b8768c4db94753193c19354fa863cd556',
  522240: 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b',
};

const fileSizeForUrl = (url: string | URL): number => {
  const href = typeof url === 'string' ? url : url.href;
  if (href.includes('config.json')) {
    return 44;
  }
  if (href.includes('tokenizer.json')) {
    return 4_608;
  }
  if (href.includes('model_quantized.onnx')) {
    return 92_360_543;
  }
  return 522_240; // voice bin
};

const pinDigestBySize = (): void => {
  crypto.subtle.digest = mock(async (_algorithm: string, data: BufferSource) => {
    const size = (data as ArrayBuffer).byteLength;
    const hex =
      SIZE_TO_HASH[size] ?? '0000000000000000000000000000000000000000000000000000000000000000';
    const pairs = hex.match(/.{2}/g);
    if (!pairs) {
      return new Uint8Array(32);
    }
    return Uint8Array.from(pairs.map((b) => Number.parseInt(b, 16)));
  }) as typeof crypto.subtle.digest;
};

const installFetchMock = (): ReturnType<typeof mock> => {
  const fetchMock = mock(async (url: string | URL, init?: RequestInit) => {
    // Honor abort signal — reject with AbortError when cancelled
    if (init?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    // Defer by at least one tick so cancel() can run during transfer
    await new Promise((resolve) => setTimeout(resolve, 0));
    return new Response(new Uint8Array(fileSizeForUrl(url)), { status: 200 });
  });
  // @ts-expect-error — replacing global fetch
  globalThis.fetch = fetchMock;
  return fetchMock;
};

// ---------------------------------------------------------------------------
// The service delegates to a module-level singleton ModelAssetStore.
// To reset state between tests we re-import the module (clearing its
// internal caches) and clear the Cache Storage polyfill.
// ---------------------------------------------------------------------------

const resetServiceModule = async (): Promise<void> => {
  // Clear all cache stores
  if ((globalThis as Record<string, unknown>).caches) {
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
  }
  // Reset the service's in-memory state
  const { voiceModelService } = await import('./voice_model_service.svelte.ts');
  (voiceModelService as unknown as Record<string, unknown>)._reset();
};

describe('VoiceModelService (C-389 AC-4c)', () => {
  beforeEach(() => {
    installCachePolyfill();
    delete (window as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  afterEach(() => {
    uninstallCachePolyfill();
    delete (globalThis as Record<string, unknown>).fetch;
    delete (window as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  test('totalBytes surfaces the full download size up front', async () => {
    const { voiceModelService } = await import('./voice_model_service.svelte.ts');
    // 44 + 4608 + 92_360_543 (model) + 522_240 (default voice)
    expect(voiceModelService.totalBytes).toBe(92_887_435);
  });

  test('checkStatus reports not-downloaded on a fresh install', async () => {
    await resetServiceModule();
    const { voiceModelService } = await import('./voice_model_service.svelte.ts');
    const state = await voiceModelService.checkStatus();
    expect(state.status).toBe('not-downloaded');
  });

  test('download() completes, verifies checksums, and reports ready', async () => {
    await resetServiceModule();
    const fetchMock = installFetchMock();
    pinDigestBySize();

    const { voiceModelService } = await import('./voice_model_service.svelte.ts');
    const state = await voiceModelService.download();

    expect(state.status).toBe('ready');
    // 3 model files + 1 voice file.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test('a second download() call joins the in-flight download (idempotent)', async () => {
    await resetServiceModule();
    const fetchMock = installFetchMock();
    pinDigestBySize();

    const { voiceModelService } = await import('./voice_model_service.svelte.ts');
    const [a, b] = await Promise.all([voiceModelService.download(), voiceModelService.download()]);

    expect(a.status).toBe('ready');
    expect(b.status).toBe('ready');
    // Files fetched exactly once despite two concurrent download() calls.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test('cancel() aborts the download and returns to not-downloaded', async () => {
    await resetServiceModule();
    const fetchMock = installFetchMock();
    let firstFetchResolved!: () => void;
    const firstFetchDone = new Promise<void>((resolve) => {
      firstFetchResolved = resolve;
    });
    // First file (config.json, 44 B) succeeds; the second stalls until the
    // abort signal fires. The listener handles an already-aborted signal and
    // clears the delayed timer so the test cannot hang (C-389 CR).
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const href = typeof url === 'string' ? url : url.href;
      if (href.includes('config.json')) {
        firstFetchResolved();
        return new Response(new Uint8Array(44), { status: 200 });
      }
      return await new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        let timer: ReturnType<typeof setTimeout> | undefined;
        if (signal?.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        signal?.addEventListener('abort', () => {
          if (timer !== undefined) {
            clearTimeout(timer);
          }
          reject(new DOMException('Aborted', 'AbortError'));
        });
        timer = setTimeout(
          () => resolve(new Response(new Uint8Array(4_608), { status: 200 })),
          60_000,
        );
      });
    });
    pinDigestBySize();

    const { voiceModelService } = await import('./voice_model_service.svelte.ts');
    const promise = voiceModelService.download();
    // Wait until the first file has actually been fetched, then cancel
    // mid-download (synchronization instead of a fixed sleep).
    await firstFetchDone;
    voiceModelService.cancel();
    const state = await promise;

    expect(state.status).toBe('not-downloaded');
  });

  test('a size-matched body with an unknown checksum fails verification', async () => {
    await resetServiceModule();
    installFetchMock();
    // Force a non-matching hash for every body (overriding any digest mock
    // a previous test installed): a correctly-sized body whose checksum is
    // not recognized must fail verification (C-389 CR — the mismatch branch
    // was previously untested).
    crypto.subtle.digest = mock(async () => new Uint8Array(32)) as typeof crypto.subtle.digest;

    const { voiceModelService } = await import('./voice_model_service.svelte.ts');
    const state = await voiceModelService.download();

    expect(state.status).toBe('error');
    expect(state.message ?? '').toContain('Checksum mismatch');
  });

  test('an oversized body fails size verification during streaming', async () => {
    await resetServiceModule();
    const fetchMock = installFetchMock();
    // First file arrives one byte larger than its manifest size — the size
    // guard must reject it while streaming, before any checksum step.
    fetchMock.mockImplementation(async (url: string | URL) => {
      const href = typeof url === 'string' ? url : url.href;
      if (href.includes('config.json')) {
        return new Response(new Uint8Array(45), { status: 200 }); // 44 + 1
      }
      return new Response(new Uint8Array(fileSizeForUrl(url)), { status: 200 });
    });
    pinDigestBySize();

    const { voiceModelService } = await import('./voice_model_service.svelte.ts');
    const state = await voiceModelService.download();

    expect(state.status).toBe('error');
    expect(state.message ?? '').toContain('exceeded expected size');
  });

  test('deleteModel() removes the cached model and returns to not-downloaded', async () => {
    await resetServiceModule();
    installFetchMock();
    pinDigestBySize();

    const { voiceModelService } = await import('./voice_model_service.svelte.ts');
    await voiceModelService.download();
    expect(voiceModelService.state.status).toBe('ready');

    await voiceModelService.deleteModel();

    expect(voiceModelService.state.status).toBe('not-downloaded');
    const check = await voiceModelService.checkStatus();
    expect(check.status).toBe('not-downloaded');
  });
});
