// apps/frontend/client/src/lib/services/image/engine/sdcpp_engine.test.ts
// biome-ignore-all lint/style/useNamingConvention: Property names must match sd-server API field names (snake_case)
//
// SdCppEngine — C-388 AC-2/AC-3/AC-5/AC-6/AC-7/AC-8.
//
// Contract: C-388 Image Engine Provider Abstraction

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { SdCppEngine } from './sdcpp_engine.svelte.ts';
import type { ImageGenerationRequest } from './types.ts';

/** Original global fetch — captured at module scope, restored after tests. */
const _realFetch = globalThis.fetch;

describe('SdCppEngine', () => {
  let fetchCalls: Array<{ url: string; options: RequestInit }> = [];
  const engine = new SdCppEngine('http://localhost:8188');

  const mockFetchJson = (urlMatcher: (url: string) => boolean, body: unknown, status = 200) => {
    globalThis.fetch = mock((url: string, options: RequestInit): Promise<Response> => {
      fetchCalls.push({ url, options });
      if (urlMatcher(url)) {
        return Promise.resolve({
          ok: status >= 200 && status < 300,
          status,
          statusText: status === 200 ? 'OK' : 'Error',
          json: () => Promise.resolve(body),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({}),
      } as Response);
    });
  };

  /** Mocks POST /sdcpp/v1/img_gen → job id, then GET job → completed with image data inline. */
  const mockFetchGenerate = (jobId = 'job-001', imageData = 'data:image/png;base64,aGVsbG8=') => {
    globalThis.fetch = mock((url: string, options: RequestInit): Promise<Response> => {
      fetchCalls.push({ url, options });
      if (options?.method === 'POST' && url.includes('/sdcpp/v1/img_gen')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: jobId, state: 'queued' }),
        } as Response);
      }
      if (url.includes(`/sdcpp/v1/jobs/${jobId}`)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              id: jobId,
              state: 'completed',
              progress: 100,
              image: imageData,
            }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      } as Response);
    });
  };

  beforeEach(() => {
    fetchCalls = [];
    globalThis.fetch = mock((url: string): Promise<Response> => {
      fetchCalls.push({ url, options: {} });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      } as Response);
    });
  });

  afterEach(() => {
    globalThis.fetch = _realFetch;
  });

  // ═════════════════════════════════════════════════════════════════════
  // Capabilities (AC-5)
  // ═════════════════════════════════════════════════════════════════════

  test('capabilities: sd-server supports everything', () => {
    expect(engine.capabilities.mask).toBe(true);
    expect(engine.capabilities.referenceImages).toBe(true);
    expect(engine.capabilities.controlNet).toBe(true);
    expect(engine.capabilities.lora).toBe(true);
    expect(engine.capabilities.negativePrompt).toBe(true);
    expect(engine.capabilities.initImage).toBe(true);
    expect(engine.capabilities.cancel).toBe(true);
    expect(engine.capabilities.progress).toBe(true);
  });

  // ═════════════════════════════════════════════════════════════════════
  // AC-8: model listing from /sdapi/v1/sd-models
  // ═════════════════════════════════════════════════════════════════════

  test('listModels parses sd-models response', async () => {
    mockFetchJson(
      (url) => url.includes('/sdapi/v1/sd-models'),
      [
        { title: 'SDXL Base', model_name: 'sd_xl_base_1.0' },
        { title: 'Turbo', model_name: 'sd_xl_turbo' },
      ],
    );

    const models = await engine.listModels();

    expect(models.length).toBe(2);
    expect(models[0].id).toBe('sd_xl_base_1.0');
    expect(models[0].description).toBe('SDXL Base');
    expect(models[1].id).toBe('sd_xl_turbo');
  });

  test('listModels throws on non-ok response', async () => {
    mockFetchJson((url) => url.includes('/sdapi/v1/sd-models'), [], 500);
    await expect(engine.listModels()).rejects.toThrow('sd-models failed');
  });

  // ═════════════════════════════════════════════════════════════════════
  // AC-2 + AC-3: negative prompt + wire protocol
  // ═════════════════════════════════════════════════════════════════════

  test('generate POSTs to /sdcpp/v1/img_gen with negative_prompt', async () => {
    mockFetchGenerate();

    const request: ImageGenerationRequest = {
      positivePrompt: 'a dragon',
      negativePrompt: 'bad anatomy, bad hands, watermark',
      model: 'sd_xl_base_1.0',
    };
    await engine.generate(request);

    const createCall = fetchCalls.find(
      (c) => c.options?.method === 'POST' && c.url.includes('/sdcpp/v1/img_gen'),
    );
    expect(createCall).toBeDefined();
    const body = JSON.parse(String(createCall?.options?.body)) as Record<string, unknown>;
    expect(body.prompt).toBe('a dragon');
    expect(body.negative_prompt).toBe('bad anatomy, bad hands, watermark');
    expect(body.model).toBe('sd_xl_base_1.0');
    expect(body.width).toBe(512);
    expect(body.height).toBe(512);
    expect(body.sample_steps).toBe(20);
    expect(body.txt_cfg).toBe(7.0);
  });

  test('generate passes seed/sampler/initImage/denoise/mask/loras through', async () => {
    mockFetchGenerate();

    await engine.generate({
      positivePrompt: 'x',
      seed: 7,
      sampler: 'dpmpp_2m',
      initImage: 'data:image/png;base64,AAA=',
      denoise: 0.6,
      mask: 'data:image/png;base64,BBB=',
      loras: [{ path: '/models/x.safetensors', multiplier: 0.8 }],
    });

    const createCall = fetchCalls.find(
      (c) => c.options?.method === 'POST' && c.url.includes('/sdcpp/v1/img_gen'),
    );
    const body = JSON.parse(String(createCall?.options?.body)) as Record<string, unknown>;
    expect(body.seed).toBe(7);
    expect(body.sample_method).toBe('dpmpp_2m');
    expect(body.init_image).toBe('data:image/png;base64,AAA=');
    expect(body.denoise).toBe(0.6);
    expect(body.mask).toBe('data:image/png;base64,BBB=');
    expect(body.lora).toEqual([{ path: '/models/x.safetensors', multiplier: 0.8 }]);
  });

  // ═════════════════════════════════════════════════════════════════════
  // AC-5: unsupported fields stripped — sd-server supports all, but denoise
  // without initImage and mask without initImage must not reach the wire.
  // ═════════════════════════════════════════════════════════════════════

  test('generate strips denoise and mask when no initImage', async () => {
    mockFetchGenerate();

    await engine.generate({
      positivePrompt: 'x',
      denoise: 0.5,
      mask: 'data:image/png;base64,BBB=',
    });

    const createCall = fetchCalls.find(
      (c) => c.options?.method === 'POST' && c.url.includes('/sdcpp/v1/img_gen'),
    );
    const body = JSON.parse(String(createCall?.options?.body)) as Record<string, unknown>;
    expect(body.denoise).toBeUndefined();
    expect(body.mask).toBeUndefined();
  });

  // ═════════════════════════════════════════════════════════════════════
  // AC-7: job polling + progress + inline image (no second fetch hop)
  // ═════════════════════════════════════════════════════════════════════

  test('generate polls the job and returns the inline image blob', async () => {
    mockFetchGenerate('job-042');

    const result = await engine.generate({ positivePrompt: 'a dragon' });

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.mimeType).toBe('image/png');
    // The image data is inline — no /view-style second fetch
    expect(fetchCalls.some((c) => c.url.includes('/view'))).toBe(false);
    const pollCall = fetchCalls.find((c) => c.url.includes('/sdcpp/v1/jobs/job-042'));
    expect(pollCall).toBeDefined();
  });

  test('generate pushes progress callback', async () => {
    mockFetchGenerate();

    const progress: Array<{ fraction: number; label: string }> = [];
    await engine.generate({ positivePrompt: 'x' }, { onProgress: (p) => progress.push(p) });

    expect(progress.length).toBeGreaterThanOrEqual(2);
    const last = progress[progress.length - 1];
    expect(last.fraction).toBe(1);
    expect(last.label).toBe('Complete');
    for (const entry of progress) {
      expect(entry.label).not.toMatch(/sdcpp|sd-server|job/i);
    }
  });

  test('generate rejects when job fails', async () => {
    globalThis.fetch = mock((url: string, options: RequestInit): Promise<Response> => {
      fetchCalls.push({ url, options });
      if (options?.method === 'POST' && url.includes('/sdcpp/v1/img_gen')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 'job-fail', state: 'queued' }),
        } as Response);
      }
      if (url.includes('/sdcpp/v1/jobs/job-fail')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 'job-fail', state: 'failed', message: 'OOM' }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      } as Response);
    });

    await expect(engine.generate({ positivePrompt: 'x' })).rejects.toThrow(/failed/);
  });

  test('generate throws missing-image when a completed job has no image data', async () => {
    // Completed job whose payload contains only non-image strings ("queued") —
    // the inline-image extraction must not accept them.
    globalThis.fetch = mock((url: string, options: RequestInit): Promise<Response> => {
      fetchCalls.push({ url, options });
      if (options?.method === 'POST' && url.includes('/sdcpp/v1/img_gen')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 'job-noimg', state: 'queued' }),
        } as Response);
      }
      if (url.includes('/sdcpp/v1/jobs/job-noimg')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ id: 'job-noimg', state: 'completed', result: 'queued' }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      } as Response);
    });

    await expect(engine.generate({ positivePrompt: 'x' })).rejects.toThrow(
      /completed without returning an image/,
    );
  });

  test('generate uses job-reported dimensions when present', async () => {
    globalThis.fetch = mock((url: string, options: RequestInit): Promise<Response> => {
      fetchCalls.push({ url, options });
      if (options?.method === 'POST' && url.includes('/sdcpp/v1/img_gen')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 'job-dims', state: 'queued' }),
        } as Response);
      }
      if (url.includes('/sdcpp/v1/jobs/job-dims')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              id: 'job-dims',
              state: 'completed',
              width: 768,
              height: 1024,
              image: 'data:image/png;base64,aGVsbG8=',
            }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      } as Response);
    });

    // Request asks for 512×512 but the job reports 768×1024 — job wins.
    const result = await engine.generate({
      positivePrompt: 'x',
      width: 512,
      height: 512,
    });
    expect(result.width).toBe(768);
    expect(result.height).toBe(1024);
  });

  // ═════════════════════════════════════════════════════════════════════
  // AC-6: cancellation issues POST /sdcpp/v1/jobs/{id}/cancel
  // ═════════════════════════════════════════════════════════════════════

  test('generate rejects with AbortError and calls job cancel on abort', async () => {
    // Job stays queued so the poll loop keeps running until the abort fires.
    globalThis.fetch = mock((url: string, options: RequestInit): Promise<Response> => {
      fetchCalls.push({ url, options });
      if (options?.method === 'POST' && url.includes('/sdcpp/v1/img_gen')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 'job-cancel-1', state: 'queued' }),
        } as Response);
      }
      if (url.includes('/sdcpp/v1/jobs/job-cancel-1')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 'job-cancel-1', state: 'queued', progress: 10 }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      } as Response);
    });

    const controller = new AbortController();
    // Abort AFTER the job is created — the poll loop must issue the cancel.
    const abortTimer = setTimeout(() => controller.abort(), 5);

    await expect(
      engine.generate({ positivePrompt: 'x' }, { signal: controller.signal }),
    ).rejects.toThrow(/abort/i);

    clearTimeout(abortTimer);
    await new Promise((r) => setTimeout(r, 10));
    const cancelCall = fetchCalls.find((c) => c.url.includes('/sdcpp/v1/jobs/job-cancel-1/cancel'));
    expect(cancelCall).toBeDefined();
    expect(cancelCall?.options?.method).toBe('POST');
  });

  // ═════════════════════════════════════════════════════════════════════
  // Edge case: single-slot queue
  // ═════════════════════════════════════════════════════════════════════

  test('generate rejects a second concurrent call (single-slot)', async () => {
    // Dedicated instance so the shared `engine` stays clean for other tests.
    const busyEngine = new SdCppEngine('http://localhost:8188');
    const controller = new AbortController();

    // Make the first generate hang on a job that never completes until the
    // controller aborts. The hanging poll mock must observe options.signal
    // and reject on abort so the first call actually settles.
    globalThis.fetch = mock((url: string, options: RequestInit): Promise<Response> => {
      fetchCalls.push({ url, options });
      if (options?.method === 'POST' && url.includes('/sdcpp/v1/img_gen')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 'job-slow', state: 'queued' }),
        } as Response);
      }
      if (url.includes('/sdcpp/v1/jobs/job-slow')) {
        return new Promise<Response>((_resolve, reject) => {
          options.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      } as Response);
    });

    const first = busyEngine.generate(
      { positivePrompt: 'first' },
      { signal: controller.signal },
    );

    await expect(busyEngine.generate({ positivePrompt: 'second' })).rejects.toThrow(/single-slot/);

    // Release the first generation so the test doesn't hang.
    controller.abort();
    await first.catch(() => {});
  });

  test('healthCheck returns false when fetch rejects', async () => {
    globalThis.fetch = mock((): Promise<Response> => Promise.reject(new Error('ECONNREFUSED')));
    expect(await engine.healthCheck()).toBe(false);
  });

  test('healthCheck returns true on ok sd-models', async () => {
    mockFetchJson((url) => url.includes('/sdapi/v1/sd-models'), []);
    expect(await engine.healthCheck()).toBe(true);
  });
});
