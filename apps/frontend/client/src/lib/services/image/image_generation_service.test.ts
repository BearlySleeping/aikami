// apps/frontend/client/src/lib/services/media/image_generation.test.ts
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  ImageGenerationService,
  type ImageGenerationServiceInterface,
} from './image_generation.svelte.ts';

// ---------------------------------------------------------------------------
// ImageGenerationService — C-076: Image Sandbox Checkpoints
// ---------------------------------------------------------------------------

// Allow tests to override the global fetch
const originalFetch = globalThis.fetch;

/** ComfyUI object_info with checkpoints (filenames include .safetensors). */
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

describe('ImageGenerationService — C-076 Checkpoints', () => {
  let service: ImageGenerationServiceInterface;
  let fetchCalls: Array<{ url: string; options: RequestInit }> = [];

  const createService = (isDemo: boolean): ImageGenerationServiceInterface =>
    new ImageGenerationService({ className: 'TestImageGen', isDemo });

  const mockFetchSuccess = (responseBody: unknown, status = 200): void => {
    globalThis.fetch = mock((url: string, options: RequestInit): Promise<Response> => {
      fetchCalls.push({ url, options });
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        json: () => Promise.resolve(responseBody),
      } as Response);
    });
  };

  const mockFetchFailure = (status: number): void => {
    globalThis.fetch = mock((url: string, options: RequestInit): Promise<Response> => {
      fetchCalls.push({ url, options });
      return Promise.resolve({
        ok: false,
        status,
        statusText: 'Server Error',
        text: () => Promise.resolve('Server Error'),
        json: () => Promise.reject(new Error('JSON parse failed')),
      } as Response);
    });
  };

  /**
   * Mock fetch that handles the ComfyUI queue-then-poll-blob pattern:
   *  1. POST /prompt          → returns { prompt_id }
   *  2. GET  /history/{id}    → returns outputs with image data
   *  3. GET  /view?...        → returns image blob
   */
  const mockFetchComfyUiGenerate = (
    promptId: string,
    filename: string,
    subfolder: string,
  ): void => {
    const imageBlob = new Blob(['fake-png-data'], { type: 'image/png' });

    globalThis.fetch = mock((url: string, options: RequestInit): Promise<Response> => {
      fetchCalls.push({ url, options });

      // GET /view?... — return image blob (bypasses CORP)
      if (url.includes('/view')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          blob: () => Promise.resolve(imageBlob),
        } as Response);
      }

      // POST /prompt — return prompt_id
      if (options?.method === 'POST' && url.includes('/prompt')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ prompt_id: promptId, number: 1, node_errors: {} }),
        } as Response);
      }

      // GET /history/{id} — return image output (succeed on first poll)
      if (url.includes('/history/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () =>
            Promise.resolve({
              [promptId]: {
                outputs: {
                  '9': {
                    images: [{ filename, subfolder, type: 'output' }],
                  },
                },
                status: { completed: true, messages: [] },
              },
            }),
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

  const mockFetchNetworkError = (): void => {
    globalThis.fetch = mock((url: string, options: RequestInit): Promise<Response> => {
      fetchCalls.push({ url, options });
      return Promise.reject(new Error('Network error'));
    });
  };

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ── AC-1: Service Checkpoint Loading ──────────────────────────────────

  describe('AC-1: loadCheckpoints', () => {
    describe('demo mode', () => {
      beforeEach(() => {
        fetchCalls = [];
        service = createService(true);
      });

      test('should populate mock checkpoint without calling fetch', async () => {
        await service.loadCheckpoints();

        expect(service.checkpoints.length).toBe(1);
        expect(service.checkpoints[0].id).toBe('sd_xl_base_1.0');
        expect(service.checkpoints[0].description).toBe('SDXL Base 1.0 (Demo)');
        expect(service.selectedCheckpoint).toBe('sd_xl_base_1.0');
      });

      test('should not overwrite an existing selectedCheckpoint', async () => {
        service.selectedCheckpoint = 'custom_model';
        await service.loadCheckpoints();

        expect(service.selectedCheckpoint).toBe('custom_model');
      });
    });

    describe('non-demo mode — successful fetch', () => {
      beforeEach(() => {
        fetchCalls = [];
        service = createService(false);
        mockFetchSuccess(MOCK_OBJECT_INFO);
      });

      test('should fetch from ComfyUI object_info endpoint', async () => {
        await service.loadCheckpoints();

        expect(fetchCalls.length).toBe(1);
        expect(fetchCalls[0].url).toBe('http://localhost:8188/object_info');
      });

      test('should map safetensors filenames to CheckpointInfo (stripped extension)', async () => {
        await service.loadCheckpoints();

        expect(service.checkpoints.length).toBe(3);
        expect(service.checkpoints[0].id).toBe('sd_xl_base_1.0');
        expect(service.checkpoints[0].description).toBe('sd_xl_base_1.0.safetensors');
        expect(service.checkpoints[1].id).toBe('sd_xl_turbo');
        expect(service.checkpoints[2].id).toBe('dreamshaper_xl');
      });

      test('should set selectedCheckpoint to first checkpoint when empty', async () => {
        service.selectedCheckpoint = '';

        await service.loadCheckpoints();

        expect(service.selectedCheckpoint).toBe('sd_xl_base_1.0');
      });

      test('should not overwrite existing selectedCheckpoint', async () => {
        service.selectedCheckpoint = 'dreamshaper_xl';

        await service.loadCheckpoints();

        expect(service.selectedCheckpoint).toBe('dreamshaper_xl');
      });
    });

    describe('non-demo mode — missing CheckpointLoaderSimple', () => {
      beforeEach(() => {
        fetchCalls = [];
        service = createService(false);
        mockFetchSuccess({ OtherNode: {} });
      });

      test('should keep checkpoints empty when CheckpointLoaderSimple is missing', async () => {
        await service.loadCheckpoints();

        expect(service.checkpoints.length).toBe(0);
      });
    });

    describe('non-demo mode — fetch failure', () => {
      beforeEach(() => {
        fetchCalls = [];
        service = createService(false);
      });

      test('should not crash on HTTP error status', async () => {
        mockFetchFailure(500);

        await service.loadCheckpoints();

        expect(service.checkpoints.length).toBe(0);
      });

      test('should not crash on network error', async () => {
        mockFetchNetworkError();

        await service.loadCheckpoints();

        expect(service.checkpoints.length).toBe(0);
      });
    });
  });

  // ── AC-4: Generation via ComfyUI ──────────────────────────────────────

  describe('AC-4: generateImage via ComfyUI', () => {
    describe('demo mode', () => {
      beforeEach(() => {
        fetchCalls = [];
        service = createService(true);
      });

      test('should return mock image without calling fetch', async () => {
        const result = await service.generateImage({ prompt: 'a cat' });

        expect(result.isDemo).toBe(true);
        expect(result.url).toContain('placehold.co');
        expect(result.url).toContain('a%20cat');
      });

      test('should return mock image even with checkpoint set', async () => {
        service.selectedCheckpoint = 'sd_xl_turbo';
        const result = await service.generateImage({ prompt: 'a dog' });

        expect(result.isDemo).toBe(true);
        expect(result.url).toContain('a%20dog');
      });
    });

    describe('non-demo mode — ComfyUI queue + poll', () => {
      beforeEach(() => {
        fetchCalls = [];
        service = createService(false);
        mockFetchComfyUiGenerate('prompt-001', 'game-gen_00001_.png', '');
      });

      test('should POST workflow to /prompt, poll /history, and return blob URL', async () => {
        const result = await service.generateImage({ prompt: 'a dragon' });

        expect(result.isDemo).toBe(false);
        // URL should be a blob: object URL (not a ComfyUI view URL)
        expect(result.url).toStartWith('blob:');

        // Should have called /prompt (POST), /history/{id} (GET), and /view (GET)
        const promptCall = fetchCalls.find(
          (c) => c.options.method === 'POST' && c.url.includes('/prompt'),
        );
        expect(promptCall).toBeDefined();

        const historyCall = fetchCalls.find((c) => c.url.includes('/history/'));
        expect(historyCall).toBeDefined();

        const viewCall = fetchCalls.find((c) => c.url.includes('/view'));
        expect(viewCall).toBeDefined();
      });

      test('should include checkpoint filename in workflow', async () => {
        service.selectedCheckpoint = 'sd_xl_turbo';

        await service.generateImage({ prompt: 'a dragon' });

        const promptCall = fetchCalls.find(
          (c) => c.options.method === 'POST' && c.url.includes('/prompt'),
        );
        expect(promptCall).toBeDefined();

        const body = JSON.parse(promptCall?.options.body as string);
        // The workflow should contain CheckpointLoaderSimple with the checkpoint
        const workflow = body.prompt as Record<
          string,
          { class_type: string; inputs: Record<string, unknown> }
        >;
        const checkpointLoader = Object.values(workflow).find(
          (n) => n.class_type === 'CheckpointLoaderSimple',
        );
        expect(checkpointLoader).toBeDefined();
        expect(checkpointLoader?.inputs.ckpt_name).toBe('sd_xl_turbo.safetensors');
      });

      test('should use explicit checkpoint over selectedCheckpoint', async () => {
        service.selectedCheckpoint = 'sd_xl_base_1.0';

        await service.generateImage({ prompt: 'a dragon', checkpoint: 'dreamshaper_xl' });

        const promptCall = fetchCalls.find(
          (c) => c.options.method === 'POST' && c.url.includes('/prompt'),
        );
        expect(promptCall).toBeDefined();

        const body = JSON.parse(promptCall?.options.body as string);
        const workflow = body.prompt as Record<
          string,
          { class_type: string; inputs: Record<string, unknown> }
        >;
        const checkpointLoader = Object.values(workflow).find(
          (n) => n.class_type === 'CheckpointLoaderSimple',
        );
        expect(checkpointLoader?.inputs.ckpt_name).toBe('dreamshaper_xl.safetensors');
      });

      test('should not append .safetensors when checkpoint is empty', async () => {
        service.selectedCheckpoint = '';

        await service.generateImage({ prompt: 'a dragon' });

        const promptCall = fetchCalls.find(
          (c) => c.options.method === 'POST' && c.url.includes('/prompt'),
        );
        const body = JSON.parse(promptCall?.options.body as string);
        const workflow = body.prompt as Record<
          string,
          { class_type: string; inputs: Record<string, unknown> }
        >;
        const checkpointLoader = Object.values(workflow).find(
          (n) => n.class_type === 'CheckpointLoaderSimple',
        );
        // Falls back to default when checkpoint is empty
        expect(checkpointLoader?.inputs.ckpt_name).toBe('sd_xl_base_1.0.safetensors');
      });

      test('should fetch image blob via /view endpoint', async () => {
        fetchCalls = [];
        mockFetchComfyUiGenerate('prompt-002', 'img_00042_.png', 'subdir');

        const result = await service.generateImage({ prompt: 'a castle' });

        // Blob URL should be created
        expect(result.url).toStartWith('blob:');
        expect(result.isDemo).toBe(false);

        // Should have called /view endpoint
        const viewCall = fetchCalls.find((c) => c.url.includes('/view'));
        expect(viewCall).toBeDefined();
        expect(viewCall?.url).toContain('filename=img_00042_.png');
        expect(viewCall?.url).toContain('subfolder=subdir');
      });
    });

    describe('non-demo mode — error handling', () => {
      beforeEach(() => {
        fetchCalls = [];
        service = createService(false);
      });

      test('should throw on /prompt HTTP error', async () => {
        mockFetchFailure(500);

        await expect(service.generateImage({ prompt: 'test' })).rejects.toThrow(
          'ComfyUI API error (500)',
        );
      });
    });
  });

  // ── State reactivity ──────────────────────────────────────────────────

  describe('$state reactivity', () => {
    beforeEach(() => {
      service = createService(true);
    });

    test('selectedCheckpoint should be mutable via assignment', () => {
      expect(service.selectedCheckpoint).toBe('');

      service.selectedCheckpoint = 'my_model';

      expect(service.selectedCheckpoint).toBe('my_model');
    });

    test('checkpoints should be reactive array', () => {
      expect(service.checkpoints.length).toBe(0);
      expect(Array.isArray(service.checkpoints)).toBe(true);
    });

    test('isDemoMode should reflect constructor option', () => {
      const demoSvc = new ImageGenerationService({ className: 'Demo', isDemo: true });
      const liveSvc = new ImageGenerationService({ className: 'Live', isDemo: false });

      expect(demoSvc.isDemoMode()).toBe(true);
      expect(liveSvc.isDemoMode()).toBe(false);
    });
  });
});
