// biome-ignore-all lint/style/useNamingConvention: ComfyUI API uses snake_case field names
// packages/backend/image/tests/orchestrator.test.ts
import { describe, expect, test } from 'bun:test';
import { ImageGenerationOrchestrator, type WsReceiverFactory } from '../src/lib/orchestrator.ts';
import type { ComfyUIPromptNode, GenerationResult } from '../src/lib/types.ts';

// ---------------------------------------------------------------------------
// Image Generation Orchestrator
//
// Tests the full generation flow:
//   1. Builder injects SaveImageWebsocket
//   2. REST client queues prompt
//   3. WS receiver captures binary image
//   4. VRAM eviction fires immediately after completion (AC2)
//   5. Zombie timeout fallback triggers /api/free
// ---------------------------------------------------------------------------

/** Test WebSocket that mimics ComfyUIWsReceiver behavior at the orchestrator boundary. */
class FakeWsReceiver {
  private _messageHandler: ((event: { data: unknown }) => void) | null = null;
  private _pendingMessages: Array<{ data: unknown }> = [];
  connected = false;

  async connect(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }

  async listenForGeneration(options: {
    promptId: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<GenerationResult> {
    return new Promise<GenerationResult>((resolve, reject) => {
      const handleMessage = (data: unknown) => {
        const rawData = data;
        if (rawData instanceof Uint8Array || rawData instanceof ArrayBuffer) {
          const buffer = rawData instanceof Uint8Array ? rawData : new Uint8Array(rawData);
          const imageData = buffer.slice(8);
          const mimeType =
            imageData[0] === 0x89
              ? 'image/png'
              : imageData[0] === 0xff
                ? 'image/jpeg'
                : 'application/octet-stream';
          resolve({ imageData, mimeType, promptId: options.promptId });
        }
      };

      // Flush any pending messages
      for (const msg of this._pendingMessages) {
        handleMessage(msg.data);
      }
      this._pendingMessages = [];

      if (options.signal) {
        options.signal.addEventListener(
          'abort',
          () => {
            reject(new Error('Generation aborted'));
          },
          { once: true },
        );
      }

      if (options.timeoutMs) {
        setTimeout(() => {
          reject(new Error(`Generation timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs);
      }

      // Set handler for future messages
      this._messageHandler = (event: { data: unknown }) => {
        handleMessage(event.data);
      };
    });
  }

  close(): void {
    // no-op
  }

  injectBinary(data: Uint8Array): void {
    if (this._messageHandler) {
      this._messageHandler({ data });
    } else {
      this._pendingMessages.push({ data });
    }
  }
}

// ---- Helpers ----------------------------------------------------------

const BASE_URL = 'http://localhost:8188';

/** Reset fetch after each test. */
const originalFetch = globalThis.fetch;

const createTestOrchestrator = () => {
  const fetchCalls: Array<{ url: string; method: string; body?: string }> = [];
  const fakeWs = new FakeWsReceiver();

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const body = init?.body as string | undefined;

    fetchCalls.push({ url, method, body });

    if (url.includes('/prompt')) {
      return new Response(JSON.stringify({ prompt_id: 'test-prompt-id', number: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/api/free')) {
      return new Response('{}', { status: 200 });
    }

    return new Response('{}', { status: 200 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as unknown as typeof globalThis.fetch;

  // Using fake WS receiver for test injection; construction via unknown cast
  const orchestrator = new (
    ImageGenerationOrchestrator as unknown as new (options: {
      config: { baseUrl: string };
      wsReceiverFactory: WsReceiverFactory;
    }) => ImageGenerationOrchestrator
  )({
    config: { baseUrl: BASE_URL },
    wsReceiverFactory: (() => fakeWs) as unknown as WsReceiverFactory,
  });

  return {
    orchestrator,
    fetchCalls,
    fakeWs,
    cleanup: () => {
      globalThis.fetch = originalFetch;
    },
  };
};

const makeWorkflow = (): Record<string, ComfyUIPromptNode> => ({
  '1': {
    inputs: { width: 512, height: 512, batch_size: 1 },
    class_type: 'EmptyLatentImage',
  },
  '2': {
    inputs: { text: 'a cute cat', clip: ['4', 0] },
    class_type: 'CLIPTextEncode',
  },
  '3': {
    inputs: { text: 'ugly', clip: ['4', 0] },
    class_type: 'CLIPTextEncode',
  },
  '4': {
    inputs: { ckpt_name: 'model.safetensors' },
    class_type: 'CheckpointLoaderSimple',
  },
  '5': {
    inputs: {
      seed: 42,
      steps: 20,
      cfg: 7,
      sampler_name: 'euler',
      scheduler: 'normal',
      denoise: 1,
      model: ['4', 0],
      positive: ['2', 0],
      negative: ['3', 0],
      latent_image: ['1', 0],
    },
    class_type: 'KSampler',
  },
  '6': {
    inputs: { samples: ['5', 0], vae: ['4', 2] },
    class_type: 'VAEDecode',
  },
});

describe('ImageGenerationOrchestrator', () => {
  describe('generate', () => {
    test('full generation flow: builder → prompt → ws → eviction (AC2)', async () => {
      const { orchestrator, fetchCalls, fakeWs, cleanup } = createTestOrchestrator();

      try {
        const generationPromise = orchestrator.generate({
          workflow: makeWorkflow(),
          positivePrompt: 'a cute cat',
          negativePrompt: 'ugly',
        });

        // Inject binary image (8-byte header + PNG bytes)
        const header = new Uint8Array(8);
        const imgBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
        const fullMsg = new Uint8Array(header.length + imgBytes.length);
        fullMsg.set(header, 0);
        fullMsg.set(imgBytes, header.length);

        fakeWs.injectBinary(fullMsg);

        const result = await generationPromise;

        expect(result.imageData.length).toBe(imgBytes.length);
        expect(result.mimeType).toBe('image/png');
        expect(result.promptId).toBe('test-prompt-id');

        // AC2: VRAM eviction must fire after completion
        const freeCall = fetchCalls.find((c) => c.url.includes('/api/free'));
        expect(freeCall).toBeTruthy();
        expect(freeCall?.method).toBe('POST');

        const freeBody = JSON.parse(freeCall?.body ?? '{}') as Record<string, boolean>;
        expect(freeBody.unload_models).toBe(true);
        expect(freeBody.free_memory).toBe(true);

        // Verify /prompt was called
        const promptCall = fetchCalls.find((c) => c.url.includes('/prompt'));
        expect(promptCall).toBeTruthy();
        expect(promptCall?.method).toBe('POST');
      } finally {
        cleanup();
      }
    });

    test('zombie timeout: aborts and forces VRAM eviction', async () => {
      const { orchestrator, fetchCalls, cleanup } = createTestOrchestrator();

      try {
        const generationPromise = orchestrator.generate({
          workflow: makeWorkflow(),
          positivePrompt: 'a cute cat',
          generationTimeoutMs: 50,
        });

        // Don't inject any binary — timeout fires

        await expect(generationPromise).rejects.toThrow('timed out');

        // Even on timeout, VRAM eviction must fire
        const freeCall = fetchCalls.find((c) => c.url.includes('/api/free'));
        expect(freeCall).toBeTruthy();
        expect(freeCall?.method).toBe('POST');
      } finally {
        cleanup();
      }
    });

    test('abort signal cancels generation and triggers eviction', async () => {
      const { orchestrator, fetchCalls, cleanup } = createTestOrchestrator();
      const controller = new AbortController();

      try {
        controller.abort(); // Abort before generation

        await expect(
          orchestrator.generate({
            workflow: makeWorkflow(),
            positivePrompt: 'a cute cat',
            signal: controller.signal,
          }),
        ).rejects.toThrow('aborted');

        // VRAM eviction must fire on abort
        const freeCall = fetchCalls.find((c) => c.url.includes('/api/free'));
        expect(freeCall).toBeTruthy();
      } finally {
        cleanup();
      }
    });
  });
});
