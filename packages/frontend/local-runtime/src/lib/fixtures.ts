// packages/frontend/local-runtime/src/lib/fixtures.ts
//
// Test fixtures for @aikami/frontend/local-runtime.
// Provides pre-built bundles, mock backends, cache polyfills, and helpers
// for use in both unit tests and integration tests.

import type { LocalModelBundle } from '@aikami/constants';
import type { EngineBackend } from '@aikami/types';

// ---------------------------------------------------------------------------
// Pre-built test bundles
// ---------------------------------------------------------------------------

export const TEST_KOKORO_BUNDLE: LocalModelBundle = {
  id: 'kokoro-82m',
  label: 'Kokoro 82M TTS',
  license: 'Apache-2.0',
  modality: 'voice',
  repo: 'k2-fsa/sherpa-onnx',
  revision: 'f46687f7e41512228ae953af24a11b2640ea0f22',
  manifestVersion: 1,
  manifestKey: 'kokoro-82m-manifest',
  assets: [
    {
      path: 'config.json',
      bytes: 44,
      sha256: 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f',
      cache: 'transformers-cache',
      key: 'kokoro-82m-config.json',
    },
    {
      path: 'tokenizer.json',
      bytes: 4_608,
      sha256: 'ee301fc39cf903ddbb463564630a28767785e3a11edd6d8226e92d4b4ef131bb',
      cache: 'transformers-cache',
      key: 'kokoro-82m-tokenizer.json',
    },
    {
      path: 'model_quantized.onnx',
      bytes: 92_360_543,
      sha256: '0d55b15d4b735d61a21b0105136bc81b8768c4db94753193c19354fa863cd556',
      cache: 'transformers-cache',
      key: 'kokoro-82m-model_quantized.onnx',
    },
    {
      path: 'voice.bin',
      bytes: 522_240,
      sha256: 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b',
      cache: 'transformers-cache',
      key: 'kokoro-82m-voice.bin',
    },
  ],
};

export const TEST_QWEN3_BUNDLE: LocalModelBundle = {
  id: 'qwen3-1b',
  label: 'Qwen3 1B LLM',
  license: 'Apache-2.0',
  modality: 'text',
  repo: 'Qwen/Qwen3-1B',
  revision: 'da1453100cf3ff33ef56d17983fc7a8648706db6',
  manifestVersion: 1,
  manifestKey: 'qwen3-1b-manifest',
  assets: [
    {
      path: 'model.safetensors',
      bytes: 1_000_000_000,
      sha256: '0000000000000000000000000000000000000000000000000000000000000000',
      cache: 'transformers-cache',
      key: 'qwen3-1b-model.safetensors',
    },
    {
      path: 'tokenizer.json',
      bytes: 500_000,
      sha256: '1111111111111111111111111111111111111111111111111111111111111111',
      cache: 'transformers-cache',
      key: 'qwen3-1b-tokenizer.json',
    },
    {
      path: 'config.json',
      bytes: 1_024,
      sha256: '2222222222222222222222222222222222222222222222222222222222222222',
      cache: 'transformers-cache',
      key: 'qwen3-1b-config.json',
    },
  ],
};

// ---------------------------------------------------------------------------
// Mock backend factory
// ---------------------------------------------------------------------------

export type MockBackendOptions = {
  generateDelay?: number;
  generateOutput?: string;
  disposeError?: Error;
};

export const createMockBackend = (
  options: MockBackendOptions = {},
): EngineBackend & { generate: (prompt: string) => Promise<string> } => {
  const { generateDelay = 0, generateOutput = 'mock output', disposeError } = options;

  return {
    kind: 'wasm' as const,
    dispose: async () => {
      if (disposeError) {
        throw disposeError;
      }
    },
    generate: async (_prompt: string) => {
      if (generateDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, generateDelay));
      }
      return generateOutput;
    },
  };
};

// ---------------------------------------------------------------------------
// Cache polyfill helpers
// ---------------------------------------------------------------------------

export class MemoryCache {
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

export const installCachePolyfill = (): void => {
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

export const uninstallCachePolyfill = (): void => {
  delete (globalThis as Record<string, unknown>).caches;
};

export const seedCache = async (bundle: LocalModelBundle): Promise<void> => {
  for (const asset of bundle.assets) {
    const cache = await caches.open(asset.cache);
    // Write a small placeholder — cache presence is all that matters
    await cache.put(asset.key, new Response(new Uint8Array(1)));
  }
};

// ---------------------------------------------------------------------------
// SHA-256 size→hash map for deterministic test digests
// ---------------------------------------------------------------------------

export const SIZE_TO_HASH: Record<number, string> = {
  44: 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f',
  4608: 'ee301fc39cf903ddbb463564630a28767785e3a11edd6d8226e92d4b4ef131bb',
  92360543: '0d55b15d4b735d61a21b0105136bc81b8768c4db94753193c19354fa863cd556',
  522240: 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b',
};

let _originalDigest: typeof crypto.subtle.digest | undefined;

export const pinDigestBySize = (): void => {
  _originalDigest ??= crypto.subtle.digest.bind(crypto.subtle);
  (crypto.subtle as unknown as Record<string, unknown>).digest = async (data: BufferSource) => {
    const size = (data as ArrayBuffer).byteLength;
    const hex =
      SIZE_TO_HASH[size] ?? '0000000000000000000000000000000000000000000000000000000000000000';
    const pairs = hex.match(/.{2}/g);
    if (!pairs) {
      return new Uint8Array(32);
    }
    return Uint8Array.from(pairs.map((b) => Number.parseInt(b, 16)));
  };
};

export const unpinDigestBySize = (): void => {
  if (_originalDigest) {
    (crypto.subtle as unknown as Record<string, unknown>).digest = _originalDigest;
    _originalDigest = undefined;
  }
};
