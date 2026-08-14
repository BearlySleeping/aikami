// apps/frontend/client/src/lib/services/image/engine/comfyui_engine.test.ts
// biome-ignore-all lint/style/useNamingConvention: Property names must match ComfyUI API field names (snake_case)
//
// ComfyUiEngine — C-388 AC-2/AC-5/AC-6/AC-7/AC-8.
//
// Contract: C-388 Image Engine Provider Abstraction

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { ComfyUiEngine } from './comfyui_engine.svelte.ts';
import type { ImageGenerationRequest } from './types.ts';

/** Original global fetch — captured at module scope, restored after tests. */
const _realFetch = globalThis.fetch;

const MOCK_OBJECT_INFO = {
  CheckpointLoaderSimple: {
    input: {
      required: {
        ckpt_name: [
          ['sd_xl_base_1.0.safetensors', 'sd_xl_turbo.safetensors', 'dreamshaper_xl.safetensors'],
        ],
      },
    },
  },
};

describe('ComfyUiEngine', () => {
  let fetchCalls: Array<{ url: string; options: RequestInit }> = [];
  const engine = new ComfyUiEngine('http://localhost:8188');

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

  const mockFetchGenerate = (promptId = 'prompt-001', filename = 'aikami-gen_00001_.png') => {
    const imageBlob = new Blob(['fake-png-data'], { type: 'image/png' });
    globalThis.fetch = mock((url: string, options: RequestInit): Promise<Response> => {
      fetchCalls.push({ url, options });
      if (url.includes('/view')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          blob: () => Promise.resolve(imageBlob),
        } as Response);
      }
      if (options?.method === 'POST' && url.includes('/upload/image')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ name: 'input.png' }),
        } as Response);
      }
      if (options?.method === 'POST' && url.includes('/prompt')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ prompt_id: promptId, number: 1, node_errors: {} }),
        } as Response);
      }
      if (url.includes('/history/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              [promptId]: {
                outputs: {
                  '9': { images: [{ filename, subfolder: '', type: 'output' }] },
                },
                status: { completed: true, messages: [] },
              },
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

  test('capabilities: mask/referenceImages/controlNet/lora are false', () => {
    expect(engine.capabilities.mask).toBe(false);
    expect(engine.capabilities.referenceImages).toBe(false);
    expect(engine.capabilities.controlNet).toBe(false);
    expect(engine.capabilities.lora).toBe(false);
    expect(engine.capabilities.negativePrompt).toBe(true);
    expect(engine.capabilities.initImage).toBe(true);
    expect(engine.capabilities.cancel).toBe(true);
    expect(engine.capabilities.progress).toBe(true);
  });

  test('capabilities: seed and sampler are supported', () => {
    expect(engine.capabilities.seed).toBe(true);
    expect(engine.capabilities.sampler).toBe(true);
  });

  // ═════════════════════════════════════════════════════════════════════
  // AC-8: model listing (nested ckpt_name array — watch point)
  // ═════════════════════════════════════════════════════════════════════

  test('listModels parses the nested ckpt_name array', async () => {
    mockFetchJson((url) => url.includes('/object_info'), MOCK_OBJECT_INFO);

    const models = await engine.listModels();

    expect(models.length).toBe(3);
    expect(models[0].id).toBe('sd_xl_base_1.0');
    expect(models[0].description).toBe('sd_xl_base_1.0.safetensors');
    expect(models[1].id).toBe('sd_xl_turbo');
    expect(models[2].id).toBe('dreamshaper_xl');
  });

  test('listModels throws on non-ok object_info', async () => {
    mockFetchJson((url) => url.includes('/object_info'), {}, 500);
    await expect(engine.listModels()).rejects.toThrow('object_info failed');
  });

  // ═════════════════════════════════════════════════════════════════════
  // AC-2: negative prompt reaches the engine graph
  // ═════════════════════════════════════════════════════════════════════

  test('generate embeds negativePrompt in the CLIPTextEncode node (node 7)', async () => {
    mockFetchGenerate();

    const request: ImageGenerationRequest = {
      positivePrompt: 'a dragon',
      negativePrompt: 'bad anatomy, bad hands, watermark',
      model: 'sd_xl_base_1.0',
    };
    await engine.generate(request);

    const promptCall = fetchCalls.find(
      (c) => c.options?.method === 'POST' && c.url.includes('/prompt'),
    );
    expect(promptCall).toBeDefined();
    const body = JSON.parse(String(promptCall?.options?.body)) as {
      prompt: Record<string, { class_type: string; inputs: { text?: string } }>;
    };
    const negativeNode = body.prompt['7'];
    expect(negativeNode.class_type).toBe('CLIPTextEncode');
    expect(negativeNode.inputs.text).toBe('bad anatomy, bad hands, watermark');
  });

  test('generate uses empty negative when absent (node 7 text "")', async () => {
    mockFetchGenerate();

    await engine.generate({ positivePrompt: 'a castle' });

    const promptCall = fetchCalls.find(
      (c) => c.options?.method === 'POST' && c.url.includes('/prompt'),
    );
    const body = JSON.parse(String(promptCall?.options?.body)) as {
      prompt: Record<string, { inputs: { text?: string } }>;
    };
    expect(body.prompt['7'].inputs.text).toBe('');
  });

  test('generate passes width/height/steps/cfg/seed/sampler into the graph', async () => {
    mockFetchGenerate();

    await engine.generate({
      positivePrompt: 'portrait',
      width: 768,
      height: 1024,
      steps: 25,
      cfgScale: 8.5,
      seed: 42,
      sampler: 'dpmpp_2m',
    });

    const promptCall = fetchCalls.find(
      (c) => c.options?.method === 'POST' && c.url.includes('/prompt'),
    );
    const body = JSON.parse(String(promptCall?.options?.body)) as {
      prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    };
    const sampler = body.prompt['3'];
    expect(sampler.inputs.seed).toBe(42);
    expect(sampler.inputs.steps).toBe(25);
    expect(sampler.inputs.cfg).toBe(8.5);
    expect(sampler.inputs.sampler_name).toBe('dpmpp_2m');
    const latent = body.prompt['5'];
    expect(latent.inputs.width).toBe(768);
    expect(latent.inputs.height).toBe(1024);
  });

  test('generate appends .safetensors when checkpoint has no extension', async () => {
    mockFetchGenerate();

    await engine.generate({ positivePrompt: 'x', model: 'sd_xl_turbo' });

    const promptCall = fetchCalls.find(
      (c) => c.options?.method === 'POST' && c.url.includes('/prompt'),
    );
    const body = JSON.parse(String(promptCall?.options?.body)) as {
      prompt: Record<string, { inputs: Record<string, unknown> }>;
    };
    expect(body.prompt['4'].inputs.ckpt_name).toBe('sd_xl_turbo.safetensors');
  });

  test('generate preserves checkpoint ids with a known model extension', async () => {
    mockFetchGenerate();

    // Three representative extensions (each generate takes ~1s due to the
    // poll sleep, so keep the list short to stay inside the test budget).
    for (const model of ['model.ckpt', 'model.gguf', 'UPPER.CKPT']) {
      await engine.generate({ positivePrompt: 'x', model });

      const promptCall = fetchCalls.find(
        (c) => c.options?.method === 'POST' && c.url.includes('/prompt'),
      );
      const body = JSON.parse(String(promptCall?.options?.body)) as {
        prompt: Record<string, { inputs: Record<string, unknown> }>;
      };
      expect(body.prompt['4'].inputs.ckpt_name).toBe(model);
      fetchCalls = [];
    }
  });

  // ═════════════════════════════════════════════════════════════════════
  // AC-5: unsupported fields are stripped before dispatch
  // ═════════════════════════════════════════════════════════════════════

  test('generate strips mask/referenceImages/loras (unsupported)', async () => {
    mockFetchGenerate();

    await engine.generate({
      positivePrompt: 'x',
      initImage: 'data:image/png;base64,AAA=',
      denoise: 0.5,
      mask: 'data:image/png;base64,BBB=',
      referenceImages: ['data:image/png;base64,CCC='],
      loras: [{ path: '/models/x.safetensors', multiplier: 1.0 }],
    });

    // The ComfyUI graph must not contain LoadImage for mask / refs — the
    // img2img path uses LoadImage only for the init image.
    const promptCall = fetchCalls.find(
      (c) => c.options?.method === 'POST' && c.url.includes('/prompt'),
    );
    const body = JSON.parse(String(promptCall?.options?.body)) as {
      prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    };
    const nodes = body.prompt;
    const classTypes = Object.values(nodes).map((n) => n.class_type);

    // Exactly one LoadImage node — the init image upload only.
    expect(classTypes.filter((c) => c === 'LoadImage')).toHaveLength(1);
    // The required img2img chain survives: LoadImage → VAEEncode → KSampler.
    expect(classTypes).toContain('VAEEncode');
    expect(classTypes).toContain('KSampler');

    // No node or payload field represents the stripped inputs.
    for (const node of Object.values(nodes)) {
      expect(node.inputs.mask).toBeUndefined();
      expect(node.inputs.referenceImages).toBeUndefined();
      expect(node.inputs.loras).toBeUndefined();
      expect(node.inputs.ref_images).toBeUndefined();
      expect(node.inputs.lora).toBeUndefined();
    }
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('BBB=');
    expect(serialized).not.toContain('CCC=');
  });

  test('generate strips denoise when no initImage', async () => {
    mockFetchGenerate();

    await engine.generate({ positivePrompt: 'x', denoise: 0.5 });

    const promptCall = fetchCalls.find(
      (c) => c.options?.method === 'POST' && c.url.includes('/prompt'),
    );
    const body = JSON.parse(String(promptCall?.options?.body)) as {
      prompt: Record<string, { inputs: Record<string, unknown> }>;
    };
    // txt2img path keeps denoise 1 (full denoise) and uses EmptyLatentImage
    expect(body.prompt['3'].inputs.denoise).toBe(1);
    expect(body.prompt['5'].class_type).toBe('EmptyLatentImage');
  });

  // ═════════════════════════════════════════════════════════════════════
  // AC-7: progress + result
  // ═════════════════════════════════════════════════════════════════════

  test('generate returns blob result with width/height/mimeType', async () => {
    mockFetchGenerate();

    const result = await engine.generate({
      positivePrompt: 'a dragon',
      width: 512,
      height: 512,
    });

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
    expect(result.mimeType).toBe('image/png');
  });

  test('generate pushes progress callback (queued → generating → complete)', async () => {
    mockFetchGenerate();

    const progress: Array<{ fraction: number; label: string }> = [];
    await engine.generate(
      { positivePrompt: 'x' },
      {
        onProgress: (p) => progress.push(p),
      },
    );

    expect(progress.length).toBeGreaterThanOrEqual(3);
    expect(progress[0].fraction).toBeLessThan(0.1);
    const last = progress[progress.length - 1];
    expect(last.fraction).toBe(1);
    expect(last.label).toBe('Complete');
    // Labels are engine-agnostic — no ComfyUI-specific strings
    for (const entry of progress) {
      expect(entry.label).not.toMatch(/comfyui|websocket|node/i);
    }
  });

  // ═════════════════════════════════════════════════════════════════════
  // AC-6: cancellation issues POST /interrupt
  // ═════════════════════════════════════════════════════════════════════

  test('generate rejects with AbortError and calls /interrupt on abort', async () => {
    mockFetchGenerate();

    const controller = new AbortController();
    // Abort before the poll loop starts
    controller.abort();

    await expect(
      engine.generate({ positivePrompt: 'x' }, { signal: controller.signal }),
    ).rejects.toThrow(/abort/i);

    // Wait a tick so the fire-and-forget interrupt fetch is issued
    await new Promise((r) => setTimeout(r, 10));
    const interruptCall = fetchCalls.find((c) => c.url.includes('/interrupt'));
    expect(interruptCall).toBeDefined();
    expect(interruptCall?.options?.method).toBe('POST');
  });

  test('healthCheck returns false when fetch rejects', async () => {
    globalThis.fetch = mock((): Promise<Response> => Promise.reject(new Error('ECONNREFUSED')));
    expect(await engine.healthCheck()).toBe(false);
  });

  test('healthCheck returns true on ok object_info', async () => {
    mockFetchJson((url) => url.includes('/object_info'), MOCK_OBJECT_INFO);
    expect(await engine.healthCheck()).toBe(true);
  });
});
