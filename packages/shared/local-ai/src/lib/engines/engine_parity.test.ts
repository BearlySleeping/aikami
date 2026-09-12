// packages/shared/local-ai/src/lib/engines/engine_parity.test.ts
// biome-ignore-all lint/style/useNamingConvention: engine APIs use snake_case fields
//
// AC-6 (C-510): the engine toggle changes only the wire protocol.
//
// The same `GenerationRequest` dispatched to sd.cpp and to ComfyUI must produce
// a `GenerationResult` satisfying the same contract; only the transport
// differs. Unsupported capabilities are stripped before dispatch.
//
// Contract: C-510 Engine-Agnostic Asset Generation Pipeline

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createGenerationEngine, DEFAULT_GENERATION_ENGINE_ID } from './factory.ts';

const _realFetch = globalThis.fetch;
const BASE_URL = 'http://127.0.0.1:8188';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('AC-6: engine parity', () => {
  let fetchCalls: Array<{ url: string; options: RequestInit }> = [];

  const jsonResponse = (body: unknown): Response =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(''),
      blob: () => Promise.resolve(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })),
    }) as Response;

  beforeEach(() => {
    fetchCalls = [];
    globalThis.fetch = mock((url: string, init: RequestInit): Promise<Response> => {
      fetchCalls.push({ url, options: init });
      // sd.cpp
      if (url.includes('/sdapi/v1/sd-models')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (init?.method === 'POST' && url.includes('/sdcpp/v1/img_gen')) {
        return Promise.resolve(jsonResponse({ id: 'job-parity', state: 'queued' }));
      }
      if (url.includes('/sdcpp/v1/jobs/')) {
        return Promise.resolve(
          jsonResponse({
            id: 'job-parity',
            state: 'completed',
            image: `data:image/png;base64,${PNG_BASE64}`,
          }),
        );
      }
      // ComfyUI
      if (url.includes('/history/')) {
        return Promise.resolve(
          jsonResponse({
            'prompt-parity': {
              outputs: { '9': { images: [{ filename: 'out.png', subfolder: '' }] } },
              status: { completed: true, messages: [] },
            },
          }),
        );
      }
      if (url.includes('/prompt')) {
        return Promise.resolve(jsonResponse({ prompt_id: 'prompt-parity' }));
      }
      return Promise.resolve(jsonResponse({}));
    });
  });

  afterEach(() => {
    globalThis.fetch = _realFetch;
  });

  test('the factory constructs both engines and defaults to sd.cpp', () => {
    expect(createGenerationEngine('sdcpp', { baseUrl: BASE_URL }).id).toBe('sdcpp');
    expect(createGenerationEngine('comfyui', { baseUrl: BASE_URL }).id).toBe('comfyui');
    expect(DEFAULT_GENERATION_ENGINE_ID).toBe('sdcpp');
  });

  test('both engines satisfy the same GenerationResult contract', async () => {
    const request = {
      modality: 'image' as const,
      positivePrompt: 'a rusty iron gate',
      negativePrompt: 'blurry',
      width: 256,
      height: 256,
      steps: 4,
      cfgScale: 3,
      seed: 11,
    };

    const sdcpp = await createGenerationEngine('sdcpp', { baseUrl: BASE_URL }).generate(request);
    const comfyui = await createGenerationEngine('comfyui', { baseUrl: BASE_URL }).generate(
      request,
    );

    for (const result of [sdcpp, comfyui]) {
      expect(result.bytes).toBeInstanceOf(Uint8Array);
      expect(result.bytes.length).toBeGreaterThan(0);
      expect(typeof result.mimeType).toBe('string');
      expect(result.mimeType.length).toBeGreaterThan(0);
      expect(result.width).toBe(256);
      expect(result.height).toBe(256);
      expect(result.metadata).toBeDefined();
    }

    // Only the transport (and the reported engine) differs.
    expect(sdcpp.engine).toBe('sdcpp');
    expect(comfyui.engine).toBe('comfyui');
  });

  test('each engine reaches its own wire protocol and no other', async () => {
    const request = { modality: 'image' as const, positivePrompt: 'x', width: 64, height: 64 };

    fetchCalls = [];
    await createGenerationEngine('sdcpp', { baseUrl: BASE_URL }).generate(request);
    const sdcppUrls = fetchCalls.map((call) => call.url);
    expect(sdcppUrls.some((url) => url.includes('/sdcpp/v1/img_gen'))).toBe(true);
    expect(sdcppUrls.some((url) => url.includes('/prompt'))).toBe(false);

    fetchCalls = [];
    await createGenerationEngine('comfyui', { baseUrl: BASE_URL }).generate(request);
    const comfyUrls = fetchCalls.map((call) => call.url);
    expect(comfyUrls.some((url) => url.includes('/prompt'))).toBe(true);
    expect(comfyUrls.some((url) => url.includes('/sdcpp/v1/'))).toBe(false);
  });

  test('unsupported capabilities are stripped before dispatch, per engine', async () => {
    const request = {
      modality: 'image' as const,
      positivePrompt: 'x',
      mask: 'data:image/png;base64,AAAA',
      referenceImages: ['data:image/png;base64,BBBB'],
      loras: [{ path: '/lora.safetensors', multiplier: 0.7 }],
    };

    // sd.cpp supports all three → they reach the wire.
    fetchCalls = [];
    await createGenerationEngine('sdcpp', { baseUrl: BASE_URL }).generate(request);
    const sdcppBody = String(
      fetchCalls.find((call) => call.url.includes('/sdcpp/v1/img_gen'))?.options.body,
    );
    expect(sdcppBody).toContain('BBBB');
    expect(sdcppBody).toContain('lora.safetensors');

    // ComfyUI supports none → they are stripped, never silently forwarded.
    fetchCalls = [];
    await createGenerationEngine('comfyui', { baseUrl: BASE_URL }).generate(request);
    const comfyBody = String(fetchCalls.find((call) => call.url.includes('/prompt'))?.options.body);
    expect(comfyBody).not.toContain('AAAA');
    expect(comfyBody).not.toContain('BBBB');
    expect(comfyBody).not.toContain('lora.safetensors');
  });

  test('a non-image modality is refused by both engines before any request', async () => {
    fetchCalls = [];
    await expect(
      createGenerationEngine('sdcpp', { baseUrl: BASE_URL }).generate({
        modality: 'audio',
        positivePrompt: 'x',
      }),
    ).rejects.toThrow(/cannot be dispatched/);
    await expect(
      createGenerationEngine('comfyui', { baseUrl: BASE_URL }).generate({
        modality: 'audio',
        positivePrompt: 'x',
      }),
    ).rejects.toThrow(/cannot be dispatched/);
    expect(fetchCalls).toHaveLength(0);
  });
});
