// apps/frontend/client/src/lib/services/audio/kokoro_runtime.test.ts
import { describe, expect, test } from 'bun:test';
import { KOKORO_BUNDLE, KOKORO_REVISION } from '@aikami/constants';
import { createKokoroFetch, kokoroLoadPlan } from './kokoro_runtime.ts';
import { formatWorkerReady } from './kokoro_worker_protocol.ts';

describe('Kokoro cache-only runtime', () => {
  test('pins both loaders and preserves WebGPU for the downloaded q8 model', () => {
    const plan = kokoroLoadPlan({ device: 'webgpu', gpuSupported: true });
    expect(plan.model).toEqual({
      dtype: 'q8',
      device: 'webgpu',
      revision: KOKORO_REVISION,
      // biome-ignore lint/style/useNamingConvention: Transformers public API spelling.
      local_files_only: true,
    });
    expect(plan.tokenizer.key).toBe(
      KOKORO_BUNDLE.assets.find((asset) => asset.path === 'tokenizer.json')?.key,
    );
    expect(plan.tokenizer.config.model_max_length).toBe(512);
    expect(plan.tokenizer.config.pad_token).toBe('$');
    expect(plan.tokenizer.config.unk_token).toBe('$');
    expect(plan.fallbackReason).toBeUndefined();
    expect(kokoroLoadPlan({ device: 'auto', gpuSupported: true }).model.device).toBe('webgpu');
    const fallback = kokoroLoadPlan({ device: 'auto', gpuSupported: false });
    expect(fallback.model.device).toBe('wasm');
    expect(
      formatWorkerReady({
        type: 'ready',
        backend: 'wasm',
        instanceId: 'fixture',
        fallbackReason: fallback.fallbackReason,
      }),
    ).toContain('fallback=');
    expect(kokoroLoadPlan({ device: 'auto', gpuSupported: false }).fallbackReason).toContain(
      'unavailable',
    );
    const forcedWasm = kokoroLoadPlan({ device: 'wasm', gpuSupported: true });
    expect(forcedWasm.model.device).toBe('wasm');
    expect(forcedWasm.fallbackReason).toBeUndefined();
  });
  test('never downloads missing models, optional tokenizer config or voices', async () => {
    let networkCalls = 0;
    const network = Object.assign(
      async () => {
        networkCalls++;
        return new Response('network');
      },
      { preconnect: () => {} },
    );
    const fetch = createKokoroFetch({ fetch: network, match: async () => undefined });
    for (const url of [
      ...KOKORO_BUNDLE.assets.map((asset) => asset.key),
      `https://huggingface.co/${KOKORO_BUNDLE.repo}/resolve/${KOKORO_REVISION}/tokenizer_config.json`,
      '/models/onnx-community/Kokoro-82M-ONNX/tokenizer_config.json',
      'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/am_adam.bin',
    ]) {
      await expect(fetch(url)).rejects.toThrow('Download the voice model explicitly');
    }
    expect(networkCalls).toBe(0);
    await fetch('https://dl.bearlysleeping.com/models/ort/runtime.wasm');
    expect(networkCalls).toBe(1);
  });
  test('voice bytes resolve only from their manifest cache/key', async () => {
    const voice = KOKORO_BUNDLE.assets.find((asset) => asset.path === 'voices/af_heart.bin');
    if (!voice) {
      throw new Error('Missing bundled voice');
    }
    const fetch = createKokoroFetch({
      fetch: globalThis.fetch,
      match: async (cache, key) => {
        expect(cache).toBe(voice.cache);
        expect(key).toBe(voice.key);
        return new Response('cached voice');
      },
    });
    expect(await (await fetch(voice.key)).text()).toBe('cached voice');
  });
});
