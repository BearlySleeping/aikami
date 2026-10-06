// packages/frontend/local-runtime/src/lib/model_cache.test.ts
//
// Regression cover for the desktop Kokoro failure: transformers probes the
// document-relative `/models/...` key before the canonical URL, so a
// WebView2-persisted `index.html` entry shadowed the real model bytes and the
// worker died with `Unexpected token '<'`. The owned cache must make that
// unreachable, and must refuse to store HTML in the first place.

import { describe, expect, test } from 'bun:test';
import {
  createPinnedModelCache,
  isCanonicalModelUrl,
  type ModelCacheBackend,
} from './model_cache.ts';

const OPTIONS = {
  origin: 'https://huggingface.co/',
  repos: ['onnx-community/Kokoro-82M-ONNX'],
  revision: 'f46687f7e41512228ae953af24a11b2640ea0f22',
} as const;

const recordingBackend = (
  seed: Record<string, string> = {},
): ModelCacheBackend & { stored: string[] } => {
  const stored: string[] = [];
  return {
    stored,
    async match(url) {
      const body = seed[url];
      return body === undefined ? undefined : new Response(body);
    },
    async put(url) {
      stored.push(url);
    },
  };
};

const chunkedResponse = (...chunks: string[]): Response => {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
  );
};

describe('isCanonicalModelUrl', () => {
  test('accepts a pinned, absolute model URL', () => {
    expect(
      isCanonicalModelUrl(
        'https://huggingface.co/onnx-community/Kokoro-82M-ONNX/resolve/f46687f7e41512228ae953af24a11b2640ea0f22/config.json',
        OPTIONS,
      ),
    ).toBe(true);
  });

  test('rejects the document-relative key that poisoned the cache', () => {
    // This is the key transformers probes first, unconditionally.
    expect(isCanonicalModelUrl('/models/onnx-community/Kokoro-82M-ONNX/config.json', OPTIONS)).toBe(
      false,
    );
  });

  test('rejects a floating revision', () => {
    expect(
      isCanonicalModelUrl(
        'https://huggingface.co/onnx-community/Kokoro-82M-ONNX/resolve/main/config.json',
        OPTIONS,
      ),
    ).toBe(false);
  });

  test('rejects other origins, other repos, and lookalike hosts', () => {
    expect(
      isCanonicalModelUrl(
        'https://evil.test/onnx-community/Kokoro-82M-ONNX/resolve/f46687f7e41512228ae953af24a11b2640ea0f22/config.json',
        OPTIONS,
      ),
    ).toBe(false);
    expect(
      isCanonicalModelUrl(
        'https://huggingface.co.evil.test/onnx-community/Kokoro-82M-ONNX/resolve/f46687f7e41512228ae953af24a11b2640ea0f22/config.json',
        OPTIONS,
      ),
    ).toBe(false);
    expect(
      isCanonicalModelUrl(
        'https://huggingface.co/attacker/evil/resolve/f46687f7e41512228ae953af24a11b2640ea0f22/config.json',
        OPTIONS,
      ),
    ).toBe(false);
  });

  test('rejects path traversal out of the pinned prefix', () => {
    expect(
      isCanonicalModelUrl(
        'https://huggingface.co/onnx-community/Kokoro-82M-ONNX/resolve/f46687f7e41512228ae953af24a11b2640ea0f22/../../../secret',
        OPTIONS,
      ),
    ).toBe(false);
  });
});

describe('createPinnedModelCache', () => {
  test('serves the pre-warmed bytes for the canonical URL', async () => {
    const url =
      'https://huggingface.co/onnx-community/Kokoro-82M-ONNX/resolve/f46687f7e41512228ae953af24a11b2640ea0f22/config.json';
    const cache = createPinnedModelCache(recordingBackend({ [url]: '{"ok":true}' }), OPTIONS);

    const hit = await cache.match(url);
    expect(hit).toBeDefined();
    expect(await hit?.text()).toBe('{"ok":true}');
  });

  test('never answers the relative key, even when the backend has it', async () => {
    // Simulates the poisoned WebView2 entry: the backend still holds HTML for
    // the relative key, and the cache must not surface it.
    const relative = '/models/onnx-community/Kokoro-82M-ONNX/config.json';
    const backend = recordingBackend({ [relative]: '<!DOCTYPE html><html>app</html>' });
    const rejected: string[] = [];
    const cache = createPinnedModelCache(backend, {
      ...OPTIONS,
      onReject: (k) => rejected.push(k),
    });

    expect(await cache.match(relative)).toBeUndefined();
    expect(rejected).toEqual([relative]);
  });

  test('accepts URL and Request keys as well as strings', async () => {
    const url =
      'https://huggingface.co/onnx-community/Kokoro-82M-ONNX/resolve/f46687f7e41512228ae953af24a11b2640ea0f22/config.json';
    const cache = createPinnedModelCache(recordingBackend({ [url]: '{}' }), OPTIONS);

    expect(await cache.match(new URL(url))).toBeDefined();
    expect(await cache.match(new Request(url))).toBeDefined();
  });

  test('refuses to store an HTML response', async () => {
    const backend = recordingBackend();
    const cache = createPinnedModelCache(backend, OPTIONS);
    const url =
      'https://huggingface.co/onnx-community/Kokoro-82M-ONNX/resolve/f46687f7e41512228ae953af24a11b2640ea0f22/config.json';

    await expect(
      cache.put(url, new Response('<!DOCTYPE html><html>spa fallback</html>')),
    ).rejects.toThrow(/HTML response/);
    expect(backend.stored).toEqual([]);
  });

  test('refuses HTML when the content type has mixed case', async () => {
    const backend = recordingBackend();
    const cache = createPinnedModelCache(backend, OPTIONS);
    const url =
      'https://huggingface.co/onnx-community/Kokoro-82M-ONNX/resolve/f46687f7e41512228ae953af24a11b2640ea0f22/config.json';

    await expect(
      cache.put(url, new Response('fallback', { headers: { 'content-type': 'Text/HTML' } })),
    ).rejects.toThrow(/HTML response/);
    expect(backend.stored).toEqual([]);
  });

  test('refuses mixed-case HTML prefixes split across chunks', async () => {
    const backend = recordingBackend();
    const cache = createPinnedModelCache(backend, OPTIONS);
    const url =
      'https://huggingface.co/onnx-community/Kokoro-82M-ONNX/resolve/f46687f7e41512228ae953af24a11b2640ea0f22/config.json';

    await expect(cache.put(url, chunkedResponse('  <!Do', 'CtYpE html>'))).rejects.toThrow(
      /HTML response/,
    );
    await expect(cache.put(url, chunkedResponse('\n<HT', 'ML>fallback'))).rejects.toThrow(
      /HTML response/,
    );
    expect(backend.stored).toEqual([]);
  });

  test('stores a real JSON response', async () => {
    const backend = recordingBackend();
    const cache = createPinnedModelCache(backend, OPTIONS);
    const url =
      'https://huggingface.co/onnx-community/Kokoro-82M-ONNX/resolve/f46687f7e41512228ae953af24a11b2640ea0f22/config.json';

    await cache.put(
      url,
      new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }),
    );
    expect(backend.stored).toEqual([url]);
  });

  test('stores a multi-chunk response without blocking its original body', async () => {
    const stored: string[] = [];
    const backend: ModelCacheBackend = {
      async match() {
        return undefined;
      },
      async put(_url, response) {
        stored.push(await response.text());
      },
    };
    const cache = createPinnedModelCache(backend, OPTIONS);
    const url =
      'https://huggingface.co/onnx-community/Kokoro-82M-ONNX/resolve/f46687f7e41512228ae953af24a11b2640ea0f22/config.json';

    await cache.put(url, chunkedResponse('  <ht', 'tp>model', ' bytes'));
    expect(stored).toEqual(['  <http>model bytes']);
  });

  test('never stores a non-canonical key', async () => {
    const backend = recordingBackend();
    const cache = createPinnedModelCache(backend, OPTIONS);

    await cache.put('/models/onnx-community/Kokoro-82M-ONNX/config.json', new Response('{}'));
    expect(backend.stored).toEqual([]);
  });
});
