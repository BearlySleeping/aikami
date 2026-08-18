// packages/frontend/ai-gateway/tests/detection.test.ts
//
// AC-5 (C-320): detection parity with capability_service — Ollama proxy
// ping with native fallback under one shared deadline, cloud config check,
// ComfyUI ping, Kokoro engine status — all within the 3s budget and
// convertible to the existing DetectionStatus union.

import { describe, expect, test } from 'bun:test';
import {
  createAdapterRegistry,
  createAiProviderGateway,
  createModeResolver,
  detectImageAvailability,
  detectTextAvailability,
  detectVoiceAvailability,
  toDetectionStatus,
} from '../src/index.ts';
import { mixedModeConfig } from './helpers.ts';

/** Builds a fetch mock keyed by URL substring → responder. */
const routedFetch = (
  routes: Array<{ match: string; respond: () => Promise<Response> }>,
): typeof fetch =>
  ((input: string | URL | Request): Promise<Response> => {
    let url: string;
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.href;
    } else {
      url = input.url;
    }
    for (const route of routes) {
      if (url.includes(route.match)) {
        return route.respond();
      }
    }
    return Promise.reject(new TypeError('fetch failed'));
  }) as typeof fetch;

describe('detectTextAvailability — parity with capability_service.detectText', () => {
  test('cloud config present → available via byok → DetectionStatus configured', async () => {
    const result = await detectTextAvailability({
      hasCloudConfig: () => true,
      fetchFn: routedFetch([]),
    });

    expect(result.available).toBe(true);
    expect(result.mode).toBe('byok');
    expect(toDetectionStatus(result)).toBe('configured');
  });

  test('Ollama proxy responds → detected', async () => {
    const result = await detectTextAvailability({
      fetchFn: routedFetch([
        {
          match: '/api/text/',
          respond: () =>
            Promise.resolve(
              new Response('ok', {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }),
            ),
        },
      ]),
    });

    expect(result.available).toBe(true);
    expect(result.provider).toBe('ollama');
    expect(toDetectionStatus(result)).toBe('detected');
  });

  test('proxy fails, runtime-configured native tags responds → detected (fallback path)', async () => {
    // C-389: the native fallback URL is injected by the caller from the
    // runtime config — the default carries no baked-in endpoint.
    const result = await detectTextAvailability({
      nativeUrl: 'http://10.0.0.5:11434/api/tags',
      fetchFn: routedFetch([
        {
          match: '10.0.0.5:11434/api/tags',
          respond: () =>
            Promise.resolve(
              new Response(JSON.stringify({ models: [{ name: 'llama3' }] }), { status: 200 }),
            ),
        },
      ]),
    });

    expect(result.available).toBe(true);
    expect(result.detail).toContain('natively');
    expect(toDetectionStatus(result)).toBe('detected');
  });

  test('Ollama /api/tags fails, OpenAI-compatible /v1/models responds → detected as llamacpp, not ollama', async () => {
    // The local-stack's bundled default (llama.cpp's llama-server) doesn't
    // implement Ollama's native API even though it commonly shares
    // Ollama's default port — this is the reported bug: /capability
    // reported "not detected" against a live, healthy llama-server.
    const result = await detectTextAvailability({
      nativeUrl: 'http://127.0.0.1:11434/api/tags',
      openaiCompatUrl: 'http://127.0.0.1:11434/v1/models',
      fetchFn: routedFetch([
        {
          match: '/api/tags',
          respond: () => Promise.resolve(new Response('Not Found', { status: 404 })),
        },
        {
          match: '/v1/models',
          respond: () =>
            Promise.resolve(
              new Response(
                JSON.stringify({ object: 'list', data: [{ id: 'qwen2.5-1.5b-instruct' }] }),
                { status: 200 },
              ),
            ),
        },
      ]),
    });

    expect(result.available).toBe(true);
    expect(result.provider).toBe('llamacpp');
    expect(result.provider).not.toBe('ollama');
    expect(toDetectionStatus(result)).toBe('detected');
  });

  test('Ollama /api/tags responds → reported as ollama, OpenAI-compat probe never attempted', async () => {
    let openaiCompatCalled = false;
    const result = await detectTextAvailability({
      nativeUrl: 'http://127.0.0.1:11434/api/tags',
      openaiCompatUrl: 'http://127.0.0.1:11434/v1/models',
      fetchFn: routedFetch([
        {
          match: '/api/tags',
          respond: () =>
            Promise.resolve(
              new Response(JSON.stringify({ models: [{ name: 'llama3' }] }), { status: 200 }),
            ),
        },
        {
          match: '/v1/models',
          respond: () => {
            openaiCompatCalled = true;
            return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
          },
        },
      ]),
    });

    expect(result.provider).toBe('ollama');
    expect(openaiCompatCalled).toBe(false);
  });

  test('OpenAI-compat endpoint answers but not in the expected shape → not detected', async () => {
    const result = await detectTextAvailability({
      openaiCompatUrl: 'http://127.0.0.1:11434/v1/models',
      fetchFn: routedFetch([
        {
          match: '/v1/models',
          respond: () => Promise.resolve(new Response('<html>hello</html>', { status: 200 })),
        },
      ]),
    });

    expect(result.available).toBe(false);
  });

  test('no native URL configured → no native ping is attempted (AC-7)', async () => {
    const result = await detectTextAvailability({
      hasCloudConfig: () => false,
      nativeUrl: undefined,
      fetchFn: routedFetch([]),
    });

    expect(result.available).toBe(false);
  });

  test('nothing reachable and no config → not_found within the 3s budget', async () => {
    const start = Date.now();
    const result = await detectTextAvailability({
      hasCloudConfig: () => false,
      fetchFn: routedFetch([]),
    });
    const elapsed = Date.now() - start;

    expect(result.available).toBe(false);
    expect(toDetectionStatus(result)).toBe('not_found');
    expect(elapsed).toBeLessThan(3_000);
  });

  test('hanging pings respect the shared aggregate deadline', async () => {
    const hangingFetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const start = Date.now();
    const result = await detectTextAvailability({ fetchFn: hangingFetch, timeoutMs: 300 });
    const elapsed = Date.now() - start;

    expect(result.available).toBe(false);
    expect(elapsed).toBeLessThan(1_500);
  });

  test('vault read failure degrades to local pings, not a crash', async () => {
    const result = await detectTextAvailability({
      hasCloudConfig: () => {
        throw new Error('vault fingerprint mismatch');
      },
      fetchFn: routedFetch([
        {
          match: '/api/text/',
          respond: () =>
            Promise.resolve(
              new Response('ok', {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }),
            ),
        },
      ]),
    });

    expect(result.available).toBe(true);
    expect(toDetectionStatus(result)).toBe('detected');
  });
});

describe('detectImageAvailability — parity with capability_service.detectImage', () => {
  test('configured provider → configured', async () => {
    const result = await detectImageAvailability({
      hasConfiguredProvider: () => true,
      fetchFn: routedFetch([]),
    });

    expect(result.available).toBe(true);
    expect(toDetectionStatus(result)).toBe('configured');
  });

  test('ComfyUI object_info responds → detected', async () => {
    const result = await detectImageAvailability({
      fetchFn: routedFetch([
        {
          match: 'object_info',
          respond: () =>
            Promise.resolve(
              new Response('{}', {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }),
            ),
        },
      ]),
    });

    expect(result.available).toBe(true);
    expect(result.provider).toBe('comfyui');
    expect(toDetectionStatus(result)).toBe('detected');
  });

  // The local stack ships sd-server, not ComfyUI. It serves the A1111
  // surface and has no /object_info at all, so the ping above can never
  // see it — before `resolveLocalEngine`, a healthy local image engine was
  // reported unavailable and the capability screen showed image as missing.
  test('local engine resolver reports sd-server → detected, with its own id', async () => {
    const result = await detectImageAvailability({
      resolveLocalEngine: () => Promise.resolve({ id: 'sdcpp' }),
      fetchFn: routedFetch([]),
    });

    expect(result.available).toBe(true);
    expect(result.provider).toBe('sdcpp');
    expect(result.mode).toBe('offline');
    expect(toDetectionStatus(result)).toBe('detected');
  });

  test('resolver finding nothing still falls through to the ComfyUI ping', async () => {
    const result = await detectImageAvailability({
      resolveLocalEngine: () => Promise.resolve(undefined),
      fetchFn: routedFetch([
        {
          match: 'object_info',
          respond: () =>
            Promise.resolve(
              new Response('{}', {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }),
            ),
        },
      ]),
    });

    expect(result.available).toBe(true);
    expect(result.provider).toBe('comfyui');
  });

  test('a throwing resolver is "not running", never a detection error', async () => {
    const result = await detectImageAvailability({
      resolveLocalEngine: () => Promise.reject(new Error('probe exploded')),
      fetchFn: routedFetch([]),
    });

    expect(result.available).toBe(false);
    expect(toDetectionStatus(result)).toBe('not_found');
  });

  test('ComfyUI unreachable → not_found', async () => {
    const result = await detectImageAvailability({ fetchFn: routedFetch([]) });

    expect(result.available).toBe(false);
    expect(toDetectionStatus(result)).toBe('not_found');
  });
});

describe('detectVoiceAvailability — real engine status, optimistic-convertible', () => {
  test('uninitialized WebGPU engine remains available (optimistic snapshot)', async () => {
    const result = await detectVoiceAvailability({
      getEngineStatus: () => ({ status: 'uninitialized', serverAvailable: false }),
    });

    expect(result.available).toBe(true);
    expect(toDetectionStatus(result)).toBe('detected');
  });

  test('Kokoro REST server detected is reflected in detail', async () => {
    const result = await detectVoiceAvailability({
      getEngineStatus: () => ({ status: 'ready', serverAvailable: true }),
    });

    expect(result.available).toBe(true);
    expect(result.detail).toContain('REST server');
  });

  test('engine error reports unavailable', async () => {
    const result = await detectVoiceAvailability({
      getEngineStatus: () => ({ status: 'error', serverAvailable: false }),
    });

    expect(result.available).toBe(false);
    expect(toDetectionStatus(result)).toBe('not_found');
  });
});

describe('gateway.detect — bounded, independent, never throws', () => {
  test('capability checks run independently and a hanging detector times out', async () => {
    const registry = createAdapterRegistry();
    const gateway = createAiProviderGateway({
      registry,
      resolveMode: createModeResolver({ getConfig: mixedModeConfig }),
      detectionTimeoutMs: 200,
      detectors: {
        text: () => new Promise(() => {}),
        image: () =>
          Promise.resolve({
            capability: 'image',
            available: true,
            mode: 'offline',
            provider: 'comfyui',
            checkedAt: new Date().toISOString(),
          }),
      },
    });

    const start = Date.now();
    const [textResult, imageResult, voiceResult] = await Promise.all([
      gateway.detect('text'),
      gateway.detect('image'),
      gateway.detect('voice'),
    ]);
    const elapsed = Date.now() - start;

    expect(textResult.available).toBe(false);
    expect(textResult.detail).toBe('Detection timed out');
    expect(imageResult.available).toBe(true);
    expect(voiceResult.available).toBe(false);
    expect(voiceResult.detail).toBe('No detector registered');
    expect(elapsed).toBeLessThan(1_000);
  });

  test('a throwing detector yields an unavailable result, not a crash', async () => {
    const registry = createAdapterRegistry();
    const gateway = createAiProviderGateway({
      registry,
      resolveMode: createModeResolver({ getConfig: mixedModeConfig }),
      detectors: {
        text: () => Promise.reject(new Error('boom')),
      },
    });

    const result = await gateway.detect('text');
    expect(result.available).toBe(false);
    expect(result.detail).toContain('boom');
  });
});
