// packages/shared/local-ai/src/lib/engines/comfyui_engine.test.ts
// biome-ignore-all lint/style/useNamingConvention: ComfyUI API uses snake_case fields
//
// C-510: ComfyUI generation transport — the single surviving graph builder.
//
// Covers: capabilities, model listing (nested ckpt_name), graph node ids and
// the negative-prompt node, capability stripping, the img2img upload path,
// abort → /interrupt, and the byte result shape.
//
// Contract: C-510 Engine-Agnostic Asset Generation Pipeline

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ComfyUiGenerationEngine } from './comfyui_engine.ts';

const _realFetch = globalThis.fetch;
const BASE_URL = 'http://127.0.0.1:8188';

describe('ComfyUiGenerationEngine', () => {
  let fetchCalls: Array<{ url: string; options: RequestInit }> = [];

  const engine = new ComfyUiGenerationEngine({ baseUrl: BASE_URL });

  const jsonResponse = (body: unknown, status = 200): Response =>
    ({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
      blob: () => Promise.resolve(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })),
    }) as Response;

  /** Answers /prompt, /history and /view. */
  const mockComfyUi = (options: { promptId?: string } = {}) => {
    const promptId = options.promptId ?? 'prompt-001';
    globalThis.fetch = mock((url: string, init: RequestInit): Promise<Response> => {
      fetchCalls.push({ url, options: init });
      // Order matters: `/history/<id>` contains `/prompt` when the id starts
      // with "prompt", so the more specific route must be matched first.
      if (url.includes('/history/')) {
        return Promise.resolve(
          jsonResponse({
            [promptId]: {
              outputs: { '9': { images: [{ filename: 'aikami-gen_00001_.png', subfolder: '' }] } },
              status: { completed: true, messages: [] },
            },
          }),
        );
      }
      if (url.includes('/view?')) {
        return Promise.resolve(jsonResponse({}));
      }
      if (url.includes('/prompt')) {
        return Promise.resolve(jsonResponse({ prompt_id: promptId }));
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

  test('declares image modality and the ComfyUI capability set', () => {
    expect(engine.id).toBe('comfyui');
    expect(engine.modality).toBe('image');
    expect(engine.capabilities.mask).toBe(false);
    expect(engine.capabilities.referenceImages).toBe(false);
    expect(engine.capabilities.controlNet).toBe(false);
    expect(engine.capabilities.lora).toBe(false);
    expect(engine.capabilities.seed).toBe(true);
    expect(engine.capabilities.sampler).toBe(true);
  });

  test('listModels parses the nested ckpt_name array', async () => {
    globalThis.fetch = mock(
      (): Promise<Response> =>
        Promise.resolve(
          jsonResponse({
            CheckpointLoaderSimple: {
              input: { required: { ckpt_name: [['sd_xl_base_1.0.safetensors']] } },
            },
          }),
        ),
    );
    const models = await engine.listModels();
    expect(models.map((entry) => entry.id)).toEqual(['sd_xl_base_1.0']);
    expect(models[0]?.description).toBe('sd_xl_base_1.0.safetensors');
  });

  test('embeds the negative prompt in the CLIPTextEncode node 7', async () => {
    mockComfyUi();
    await engine.generate({
      modality: 'image',
      positivePrompt: 'a dragon',
      negativePrompt: 'bad anatomy',
      model: 'sd_xl_base_1.0',
    });

    const submit = fetchCalls.find((call) => call.url.includes('/prompt'));
    const body = JSON.parse(String(submit?.options.body)) as {
      prompt: Record<string, { inputs: Record<string, unknown> }>;
    };
    expect(body.prompt['6']?.inputs.text).toBe('a dragon');
    expect(body.prompt['7']?.inputs.text).toBe('bad anatomy');
    expect(body.prompt['4']?.inputs.ckpt_name).toBe('sd_xl_base_1.0.safetensors');
    expect(body.prompt['5']).toBeDefined();
    expect(body.prompt['11']).toBeUndefined();
  });

  test('appends .safetensors only to bare checkpoint ids', async () => {
    mockComfyUi();
    await engine.generate({ modality: 'image', positivePrompt: 'x', model: 'sd_xl_turbo' });
    let submit = fetchCalls.find((call) => call.url.includes('/prompt'));
    let body = JSON.parse(String(submit?.options.body)) as {
      prompt: Record<string, { inputs: Record<string, unknown> }>;
    };
    expect(body.prompt['4']?.inputs.ckpt_name).toBe('sd_xl_turbo.safetensors');

    fetchCalls = [];
    await engine.generate({ modality: 'image', positivePrompt: 'x', model: 'model.gguf' });
    submit = fetchCalls.find((call) => call.url.includes('/prompt'));
    body = JSON.parse(String(submit?.options.body)) as {
      prompt: Record<string, { inputs: Record<string, unknown> }>;
    };
    expect(body.prompt['4']?.inputs.ckpt_name).toBe('model.gguf');
  });

  test('strips mask, referenceImages and loras (unsupported)', async () => {
    mockComfyUi();
    await engine.generate({
      modality: 'image',
      positivePrompt: 'x',
      mask: 'data:image/png;base64,AAAA',
      referenceImages: ['data:image/png;base64,BBBB'],
      loras: [{ path: '/x.safetensors', multiplier: 0.8 }],
    });

    const submit = fetchCalls.find((call) => call.url.includes('/prompt'));
    const raw = String(submit?.options.body);
    expect(raw).not.toContain('AAAA');
    expect(raw).not.toContain('BBBB');
    expect(raw).not.toContain('x.safetensors');
  });

  test('uploads an init image and switches to the img2img latent path', async () => {
    globalThis.fetch = mock((url: string, init: RequestInit): Promise<Response> => {
      fetchCalls.push({ url, options: init });
      // Specific routes first — `/history/prompt-img2img` contains `/prompt`.
      if (url.includes('/upload/image')) {
        return Promise.resolve(jsonResponse({ name: 'uploaded.png' }));
      }
      if (url.includes('/history/')) {
        return Promise.resolve(
          jsonResponse({
            'prompt-img2img': {
              outputs: { '9': { images: [{ filename: 'out.png', subfolder: '' }] } },
              status: { completed: true, messages: [] },
            },
          }),
        );
      }
      if (url.includes('/prompt')) {
        return Promise.resolve(jsonResponse({ prompt_id: 'prompt-img2img' }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    await engine.generate({
      modality: 'image',
      positivePrompt: 'x',
      initImage: 'data:image/png;base64,iVBORw0KGgo=',
      denoise: 0.6,
    });

    const submit = fetchCalls.find((call) => call.url.includes('/prompt'));
    const body = JSON.parse(String(submit?.options.body)) as {
      prompt: Record<string, { inputs: Record<string, unknown> }>;
    };
    expect(body.prompt['10']?.inputs.image).toBe('uploaded.png');
    expect(body.prompt['11']).toBeDefined();
    expect(body.prompt['5']).toBeUndefined();
    expect(body.prompt['3']?.inputs.denoise).toBe(0.6);
  });

  test('returns bytes with the requested dimensions', async () => {
    mockComfyUi();
    const result = await engine.generate({
      modality: 'image',
      positivePrompt: 'x',
      width: 640,
      height: 384,
    });
    expect(result.engine).toBe('comfyui');
    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(result.bytes.length).toBe(3);
    expect(result.width).toBe(640);
    expect(result.height).toBe(384);
    expect(result.metadata.prompt).toBe('x');
  });

  test('rejects with AbortError and calls /interrupt on abort', async () => {
    const controller = new AbortController();
    globalThis.fetch = mock((url: string, init: RequestInit): Promise<Response> => {
      fetchCalls.push({ url, options: init });
      if (url.includes('/interrupt')) {
        return Promise.resolve(jsonResponse({}));
      }
      // `/history/...` before `/prompt` — the ids start with "prompt".
      if (url.includes('/history/')) {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        });
      }
      if (url.includes('/prompt')) {
        return Promise.resolve(jsonResponse({ prompt_id: 'prompt-abort' }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    const timer = setTimeout(() => controller.abort(), 20);
    await expect(
      engine.generate({ modality: 'image', positivePrompt: 'x' }, { signal: controller.signal }),
    ).rejects.toThrow(/abort/i);
    clearTimeout(timer);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchCalls.some((call) => call.url.includes('/interrupt'))).toBe(true);
  });

  test('an unconfigured engine reports unhealthy instead of probing', async () => {
    const unconfigured = new ComfyUiGenerationEngine();
    globalThis.fetch = mock((): Promise<Response> => {
      throw new Error('must not be called');
    });
    expect(await unconfigured.healthCheck()).toBe(false);
    await expect(unconfigured.generate({ modality: 'image', positivePrompt: 'x' })).rejects.toThrow(
      /not configured/,
    );
  });
});
