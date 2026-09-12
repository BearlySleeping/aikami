// packages/shared/local-ai/src/lib/engines/sdcpp_engine.test.ts
// biome-ignore-all lint/style/useNamingConvention: sd-server API uses snake_case fields
//
// C-510: sd.cpp generation transport — the single `/sdcpp/v1` implementation.
//
// Covers: model listing, request mapping, fail-fast model verification, job
// polling, capability stripping, abort → native cancel, and per-instance
// serialization (sd-server is single-slot).
//
// Contract: C-510 Engine-Agnostic Asset Generation Pipeline

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { DEFAULT_SDCPP_POLL_DEADLINE_MS, SdCppGenerationEngine } from './sdcpp_engine.ts';

const _realFetch = globalThis.fetch;
const BASE_URL = 'http://127.0.0.1:8188';

/** Inline 1×1 PNG (base64) — a real image payload, not a state string. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('SdCppGenerationEngine', () => {
  let fetchCalls: Array<{ url: string; options: RequestInit }> = [];

  const engine = new SdCppGenerationEngine({ baseUrl: BASE_URL });

  const jsonResponse = (body: unknown, status = 200): Response =>
    ({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    }) as Response;

  /** Answers the model listing, the img_gen submit and the job poll. */
  const mockSdServer = (options: { jobId?: string; image?: string; models?: string[] } = {}) => {
    const jobId = options.jobId ?? 'job-001';
    const image = options.image ?? `data:image/png;base64,${PNG_BASE64}`;
    const models = options.models ?? ['sd_xl_base_1.0'];
    globalThis.fetch = mock((url: string, init: RequestInit): Promise<Response> => {
      fetchCalls.push({ url, options: init });
      if (url.includes('/sdapi/v1/sd-models')) {
        return Promise.resolve(jsonResponse(models.map((model) => ({ model_name: model }))));
      }
      if (init?.method === 'POST' && url.includes('/sdcpp/v1/img_gen')) {
        return Promise.resolve(jsonResponse({ id: jobId, state: 'queued' }));
      }
      if (url.includes(`/sdcpp/v1/jobs/${jobId}`)) {
        return Promise.resolve(jsonResponse({ id: jobId, state: 'completed', image }));
      }
      return Promise.resolve(jsonResponse({}));
    });
  };

  beforeEach(() => {
    fetchCalls = [];
    globalThis.fetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})));
  });

  afterEach(() => {
    globalThis.fetch = _realFetch;
  });

  // ── Capabilities + modality ──────────────────────────────────────────

  test('declares image modality and full sd-server capabilities', () => {
    expect(engine.id).toBe('sdcpp');
    expect(engine.modality).toBe('image');
    expect(engine.capabilities.mask).toBe(true);
    expect(engine.capabilities.referenceImages).toBe(true);
    expect(engine.capabilities.controlNet).toBe(false);
    expect(engine.capabilities.lora).toBe(true);
    expect(engine.capabilities.cancel).toBe(true);
  });

  test('rejects a non-image modality before any request', async () => {
    mockSdServer();
    await expect(engine.generate({ modality: 'audio', positivePrompt: 'x' })).rejects.toThrow(
      /cannot be dispatched/,
    );
    expect(fetchCalls).toHaveLength(0);
  });

  // ── Model listing + fail-fast verification ───────────────────────────

  test('listModels parses the sd-models response', async () => {
    mockSdServer({ models: ['anima.gguf', 'flux.gguf'] });
    const models = await engine.listModels();
    expect(models.map((entry) => entry.id)).toEqual(['anima.gguf', 'flux.gguf']);
  });

  test('an unknown model fails fast without submitting a job', async () => {
    mockSdServer({ models: ['anima.gguf'] });
    await expect(
      engine.generate({ modality: 'image', positivePrompt: 'x', model: 'not-loaded.gguf' }),
    ).rejects.toThrow(/refusing to submit/);
    expect(fetchCalls.some((call) => call.url.includes('/sdcpp/v1/img_gen'))).toBe(false);
  });

  test('a known model is submitted', async () => {
    mockSdServer({ models: ['anima.gguf'] });
    await engine.generate({ modality: 'image', positivePrompt: 'x', model: 'anima.gguf' });
    const submit = fetchCalls.find((call) => call.url.includes('/sdcpp/v1/img_gen'));
    expect(JSON.parse(String(submit?.options.body)).model).toBe('anima.gguf');
  });

  // ── Request mapping ─────────────────────────────────────────────────

  test('maps the generation request onto the sd-server body', async () => {
    mockSdServer();
    await engine.generate({
      modality: 'image',
      positivePrompt: 'a dragon',
      negativePrompt: 'bad anatomy',
      width: 768,
      height: 512,
      steps: 24,
      cfgScale: 6.5,
      seed: 42,
      sampler: 'dpmpp_2m',
    });

    const submit = fetchCalls.find((call) => call.url.includes('/sdcpp/v1/img_gen'));
    const body = JSON.parse(String(submit?.options.body)) as Record<string, unknown>;
    expect(body.prompt).toBe('a dragon');
    expect(body.negative_prompt).toBe('bad anatomy');
    expect(body.width).toBe(768);
    expect(body.height).toBe(512);
    expect(body.sample_steps).toBe(24);
    expect(body.txt_cfg).toBe(6.5);
    expect(body.seed).toBe(42);
    expect(body.sample_method).toBe('dpmpp_2m');
    expect(body.batch_count).toBe(1);
  });

  test('strips mask when there is no init image', async () => {
    mockSdServer();
    await engine.generate({
      modality: 'image',
      positivePrompt: 'x',
      denoise: 0.5,
      mask: 'data:image/png;base64,AAAA',
    });
    const submit = fetchCalls.find((call) => call.url.includes('/sdcpp/v1/img_gen'));
    const body = JSON.parse(String(submit?.options.body)) as Record<string, unknown>;
    expect(body.mask).toBeUndefined();
    expect(body.denoise).toBeUndefined();
  });

  // ── Result ──────────────────────────────────────────────────────────

  test('returns bytes, MIME type and dimensions from the polled job', async () => {
    mockSdServer();
    const result = await engine.generate({
      modality: 'image',
      positivePrompt: 'a dragon',
      width: 640,
      height: 384,
    });

    expect(result.engine).toBe('sdcpp');
    expect(result.mimeType).toBe('image/png');
    expect(result.width).toBe(640);
    expect(result.height).toBe(384);
    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(result.bytes.length).toBeGreaterThan(0);
    expect(result.metadata.prompt).toBe('a dragon');
  });

  test('pushes progress with engine-agnostic labels', async () => {
    mockSdServer();
    const labels: string[] = [];
    await engine.generate(
      { modality: 'image', positivePrompt: 'x' },
      { onProgress: (progress) => labels.push(progress.label) },
    );
    expect(labels.length).toBeGreaterThanOrEqual(2);
    expect(labels.at(-1)).toBe('Complete');
    for (const label of labels) {
      expect(label).not.toMatch(/sdcpp|sd-server|job/i);
    }
  });

  test('rejects when the job reports failure', async () => {
    globalThis.fetch = mock((url: string, init: RequestInit): Promise<Response> => {
      fetchCalls.push({ url, options: init });
      if (init?.method === 'POST' && url.includes('/sdcpp/v1/img_gen')) {
        return Promise.resolve(jsonResponse({ id: 'job-fail', state: 'queued' }));
      }
      if (url.includes('/sdcpp/v1/jobs/job-fail')) {
        return Promise.resolve(jsonResponse({ id: 'job-fail', state: 'failed', message: 'OOM' }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    await expect(engine.generate({ modality: 'image', positivePrompt: 'x' })).rejects.toThrow(
      /failed/,
    );
  });

  // ── Abort → native cancel ───────────────────────────────────────────

  test('abort rejects with AbortError and issues the native cancel', async () => {
    const controller = new AbortController();
    globalThis.fetch = mock((url: string, init: RequestInit): Promise<Response> => {
      fetchCalls.push({ url, options: init });
      if (init?.method === 'POST' && url.includes('/sdcpp/v1/img_gen')) {
        return Promise.resolve(jsonResponse({ id: 'job-cancel', state: 'queued' }));
      }
      if (url.includes('/sdcpp/v1/jobs/job-cancel/cancel')) {
        return Promise.resolve(jsonResponse({}));
      }
      if (url.includes('/sdcpp/v1/jobs/job-cancel')) {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        });
      }
      return Promise.resolve(jsonResponse({}));
    });

    const timer = setTimeout(() => controller.abort(), 20);
    await expect(
      engine.generate({ modality: 'image', positivePrompt: 'x' }, { signal: controller.signal }),
    ).rejects.toThrow(/abort/i);
    clearTimeout(timer);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const cancel = fetchCalls.find((call) => call.url.includes('/sdcpp/v1/jobs/job-cancel/cancel'));
    expect(cancel).toBeDefined();
    expect(cancel?.options.method).toBe('POST');
  });

  // ── Serialization ───────────────────────────────────────────────────

  test('serializes concurrent generations instead of racing the single slot', async () => {
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;

    globalThis.fetch = mock((url: string, init: RequestInit): Promise<Response> => {
      fetchCalls.push({ url, options: init });
      if (init?.method === 'POST' && url.includes('/sdcpp/v1/img_gen')) {
        const body = JSON.parse(String(init.body)) as { prompt: string };
        order.push(`submit:${body.prompt}`);
        active += 1;
        maxActive = Math.max(maxActive, active);
        return Promise.resolve(jsonResponse({ id: `job-${body.prompt}`, state: 'queued' }));
      }
      if (url.includes('/sdcpp/v1/jobs/')) {
        const jobId = url.split('/sdcpp/v1/jobs/')[1] ?? '';
        const prompt = jobId.replace('job-', '');
        active -= 1;
        order.push(`complete:${prompt}`);
        return Promise.resolve(
          jsonResponse({
            id: jobId,
            state: 'completed',
            image: `data:image/png;base64,${PNG_BASE64}`,
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    const serialEngine = new SdCppGenerationEngine({ baseUrl: BASE_URL });
    await Promise.all([
      serialEngine.generate({ modality: 'image', positivePrompt: 'first' }),
      serialEngine.generate({ modality: 'image', positivePrompt: 'second' }),
    ]);

    expect(order).toEqual(['submit:first', 'complete:first', 'submit:second', 'complete:second']);
    expect(maxActive).toBeLessThanOrEqual(1);
  });

  // ── Configuration ───────────────────────────────────────────────────

  test('an unconfigured engine reports unhealthy instead of probing', async () => {
    const unconfigured = new SdCppGenerationEngine();
    globalThis.fetch = mock((): Promise<Response> => {
      throw new Error('must not be called');
    });
    expect(await unconfigured.healthCheck()).toBe(false);
    await expect(unconfigured.generate({ modality: 'image', positivePrompt: 'x' })).rejects.toThrow(
      /not configured/,
    );
  });

  test('rejects a non-http base URL scheme', () => {
    expect(() => new SdCppGenerationEngine({ baseUrl: 'file:///etc/passwd' })).toThrow(
      /only http\(s\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// C-510: the poll deadline is a real budget, not a 120s trap
// ---------------------------------------------------------------------------

describe('SdCppGenerationEngine poll deadline', () => {
  test('the default deadline covers a real CPU sd-server run', () => {
    // A 512×512/20-step sd.cpp job measures ~140s on a developer machine, so
    // anything near that has no headroom. The pre-C-510 generate:avatar CLI
    // shipped a 900s default for exactly this reason.
    expect(DEFAULT_SDCPP_POLL_DEADLINE_MS).toBeGreaterThanOrEqual(900_000);
  });

  test('a custom queueWaitMs bounds the poll loop and names the deadline', async () => {
    const engine = new SdCppGenerationEngine({ baseUrl: BASE_URL, queueWaitMs: 60 });
    const requests: string[] = [];
    globalThis.fetch = mock((url: string, init: RequestInit): Promise<Response> => {
      requests.push(url);
      if (init?.method === 'POST' && url.includes('/sdcpp/v1/img_gen')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 'job-hang', state: 'queued' }),
        } as Response);
      }
      if (url.endsWith('/sdcpp/v1/jobs/job-hang/cancel')) {
        return Promise.reject(new Error('cancel transport failed'));
      }
      // Never reaches a terminal state — only the deadline can end this.
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'job-hang', state: 'generating', progress: 67 }),
      } as Response);
    });

    await expect(engine.generate({ modality: 'image', positivePrompt: 'x' })).rejects.toThrow(
      /deadline 0s/,
    );
    expect(requests.some((url) => url.endsWith('/sdcpp/v1/jobs/job-hang/cancel'))).toBe(true);
  }, 20_000);

  test('the default engine does not use the old 120s ceiling', () => {
    // Regression guard: the pre-C-510 shared client hardcoded 120_000, which
    // timed out ordinary 512×512/20-step jobs at 67% progress.
    expect(DEFAULT_SDCPP_POLL_DEADLINE_MS).not.toBe(120_000);
  });
});
