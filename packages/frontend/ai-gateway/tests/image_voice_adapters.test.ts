// packages/frontend/ai-gateway/tests/image_voice_adapters.test.ts
//
// AC-3 (C-320): image and voice adapters delegate to existing client
// implementations unchanged — same request payloads, same outputs —
// and honor AbortSignal + normalize failures.

import { describe, expect, test } from 'bun:test';
import {
  createDelegatingImageAdapter,
  createDelegatingVoiceAdapter,
  isAiGatewayError,
} from '../src/index.ts';

const imageResolution = { capability: 'image', mode: 'offline', provider: 'comfyui' } as const;
const voiceResolution = { capability: 'voice', mode: 'offline', provider: 'kokoro' } as const;

describe('Delegating image adapter', () => {
  test('passes the same request payload to the delegate and returns its output', async () => {
    const captured: Array<{ prompt: string; checkpoint?: string }> = [];
    const adapter = createDelegatingImageAdapter({
      generate: (options) => {
        captured.push(options);
        return Promise.resolve({ url: 'blob:generated' });
      },
    });

    const result = await adapter.generateImage({
      resolution: imageResolution,
      signal: new AbortController().signal,
      prompt: 'a castle at dusk',
      checkpoint: 'sd_xl_base_1.0',
    });

    expect(captured).toEqual([{ prompt: 'a castle at dusk', checkpoint: 'sd_xl_base_1.0' }]);
    expect(result.url).toBe('blob:generated');
  });

  test('rejects with cancelled when aborted mid-generation', async () => {
    const controller = new AbortController();
    const adapter = createDelegatingImageAdapter({
      generate: () => new Promise(() => {}),
    });

    const pending = adapter.generateImage({
      resolution: imageResolution,
      signal: controller.signal,
      prompt: 'never finishes',
    });
    controller.abort();

    try {
      await pending;
      throw new Error('expected rejection');
    } catch (error) {
      expect(isAiGatewayError(error)).toBe(true);
      if (isAiGatewayError(error)) {
        expect(error.code).toBe('cancelled');
      }
    }
  });

  test('normalizes delegate failures to AiGatewayException', async () => {
    const adapter = createDelegatingImageAdapter({
      generate: () => Promise.reject(new Error('Image generation timed out — ComfyUI')),
    });

    try {
      await adapter.generateImage({
        resolution: imageResolution,
        signal: new AbortController().signal,
        prompt: 'x',
      });
      throw new Error('expected rejection');
    } catch (error) {
      expect(isAiGatewayError(error)).toBe(true);
      if (isAiGatewayError(error)) {
        expect(error.code).toBe('timeout');
        expect(error.capability).toBe('image');
      }
    }
  });
});

describe('Delegating voice adapter', () => {
  test('passes the same request payload to the delegate', async () => {
    const captured: Array<{ text: string; voiceId?: string }> = [];
    const adapter = createDelegatingVoiceAdapter({
      synthesize: (options) => {
        captured.push(options);
        return Promise.resolve(undefined);
      },
    });

    const result = await adapter.generateVoice({
      resolution: voiceResolution,
      signal: new AbortController().signal,
      text: 'Hello there',
      voiceId: 'af_bella',
    });

    expect(captured).toEqual([{ text: 'Hello there', voiceId: 'af_bella' }]);
    // Kokoro path plays through the audio pipeline — no raw buffer.
    expect(result.audio).toBeUndefined();
  });

  test('returns raw audio when the delegate produces one', async () => {
    const buffer = new ArrayBuffer(8);
    const adapter = createDelegatingVoiceAdapter({
      synthesize: () => Promise.resolve({ audio: buffer }),
    });

    const result = await adapter.generateVoice({
      resolution: voiceResolution,
      signal: new AbortController().signal,
      text: 'Hello',
    });

    expect(result.audio).toBe(buffer);
  });

  test('rejects with cancelled when aborted mid-synthesis', async () => {
    const controller = new AbortController();
    const adapter = createDelegatingVoiceAdapter({
      synthesize: () => new Promise(() => {}),
    });

    const pending = adapter.generateVoice({
      resolution: voiceResolution,
      signal: controller.signal,
      text: 'never finishes',
    });
    controller.abort();

    try {
      await pending;
      throw new Error('expected rejection');
    } catch (error) {
      expect(isAiGatewayError(error)).toBe(true);
      if (isAiGatewayError(error)) {
        expect(error.code).toBe('cancelled');
      }
    }
  });

  test('normalizes delegate failures to AiGatewayException', async () => {
    const adapter = createDelegatingVoiceAdapter({
      synthesize: () => Promise.reject(new Error('WebGPU init failed: network error')),
    });

    try {
      await adapter.generateVoice({
        resolution: voiceResolution,
        signal: new AbortController().signal,
        text: 'x',
      });
      throw new Error('expected rejection');
    } catch (error) {
      expect(isAiGatewayError(error)).toBe(true);
      if (isAiGatewayError(error)) {
        expect(error.capability).toBe('voice');
        expect(error.mode).toBe('offline');
      }
    }
  });
});
