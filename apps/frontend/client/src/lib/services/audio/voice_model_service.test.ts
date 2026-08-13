// apps/frontend/client/src/lib/services/audio/voice_model_service.test.ts
//
// Unit tests for the explicit voice-model download control (C-389 AC-4c):
// size surfaced up front, progress, cancel, delete, checksum verification,
// and idempotent join of concurrent downloads.
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
  const fetchMock = mock(async (url: string | URL) => {
    // Build the response buffer lazily, sized to the requested file.
    return new Response(new Uint8Array(fileSizeForUrl(url)), { status: 200 });
  });
  // @ts-expect-error — replacing global fetch
  globalThis.fetch = fetchMock;
  return fetchMock;
};

const resetServiceState = async (): Promise<void> => {
  const mod = await import('./voice_model_service.svelte.ts');
  const svc = mod.voiceModelService as unknown as Record<string, unknown>;
  svc.state = { status: 'not-downloaded', bytes: 0 };
  svc._abortController = undefined;
  svc._inflight = undefined;
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
    await resetServiceState();
    const { voiceModelService } = await import('./voice_model_service.svelte.ts');
    const state = await voiceModelService.checkStatus();
    expect(state.status).toBe('not-downloaded');
  });

  test('download() completes, verifies checksums, and reports ready', async () => {
    await resetServiceState();
    const fetchMock = installFetchMock();
    pinDigestBySize();

    const { voiceModelService } = await import('./voice_model_service.svelte.ts');
    const state = await voiceModelService.download();

    expect(state.status).toBe('ready');
    // 3 model files + 1 voice file.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test('a second download() call joins the in-flight download (idempotent)', async () => {
    await resetServiceState();
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
    await resetServiceState();
    const fetchMock = installFetchMock();
    // First file (config.json, 44 B) succeeds; the second stalls until the
    // abort signal fires.
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const href = typeof url === 'string' ? url : url.href;
      if (href.includes('config.json')) {
        return new Response(new Uint8Array(44), { status: 200 });
      }
      return await new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
        setTimeout(() => resolve(new Response(new Uint8Array(4_608), { status: 200 })), 60_000);
      });
    });
    pinDigestBySize();

    const { voiceModelService } = await import('./voice_model_service.svelte.ts');
    const promise = voiceModelService.download();
    // Let the first file land, then cancel mid-download.
    await new Promise((r) => setTimeout(r, 20));
    voiceModelService.cancel();
    const state = await promise;

    expect(state.status).toBe('not-downloaded');
  });

  test('deleteModel() removes the cached model and returns to not-downloaded', async () => {
    await resetServiceState();
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
