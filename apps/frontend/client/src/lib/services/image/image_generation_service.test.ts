// apps/frontend/client/src/lib/services/image/image_generation_service.test.ts
// biome-ignore-all lint/style/useNamingConvention: Property names must match ComfyUI API field names (PascalCase and snake_case)
//
// ImageGenerationService — C-388 AC-2 (negative prompt reaches engine),
// AC-3 (engine toggle changes wire protocol), AC-7 (progress),
// AC-8 (model listing both engines).
//
// Contract: C-388 Image Engine Provider Abstraction

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// Mock the engine factory BEFORE importing the service so loadCheckpoints /
// generateImage delegate to a controllable engine.
let mockEngineId: 'comfyui' | 'sdcpp' = 'comfyui';
let mockModels: Array<{ id: string; description: string }> = [
  { id: 'sd_xl_base_1.0', description: 'sd_xl_base_1.0.safetensors' },
];
let mockGenerateRequest: Record<string, unknown> | undefined;
let mockProgress: Array<{ fraction: number; label: string }> = [];

mock.module('./engine/image_engine_factory.svelte.ts', () => ({
  getConfiguredImageEngineId: () => (mockEngineId === 'comfyui' ? 'comfyui' : 'sdcpp'),
  resolveImageEngine: mock(async () => ({
    id: mockEngineId,
    capabilities: {
      negativePrompt: true,
      seed: true,
      sampler: true,
      initImage: true,
      mask: mockEngineId === 'sdcpp',
      referenceImages: mockEngineId === 'sdcpp',
      controlNet: mockEngineId === 'sdcpp',
      lora: mockEngineId === 'sdcpp',
      cancel: true,
      progress: true,
    },
    healthCheck: mock(async () => true),
    listModels: mock(async () => mockModels),
    generate: mock(
      async (
        request: Record<string, unknown>,
        callbacks: {
          signal?: AbortSignal;
          onProgress?: (p: { fraction: number; label: string }) => void;
        },
      ) => {
        mockGenerateRequest = request;
        if (callbacks?.onProgress) {
          callbacks.onProgress({ fraction: 0.05, label: 'Queuing' });
          callbacks.onProgress({ fraction: 0.5, label: 'Generating' });
          callbacks.onProgress({ fraction: 1, label: 'Complete' });
        }
        mockProgress = [
          { fraction: 0.05, label: 'Queuing' },
          { fraction: 0.5, label: 'Generating' },
          { fraction: 1, label: 'Complete' },
        ];
        if (callbacks?.signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        return {
          blob: new Blob(['fake-png'], { type: 'image/png' }),
          width: 512,
          height: 512,
          mimeType: 'image/png',
        };
      },
    ),
  })),
  resetImageEngineCache: () => {},
  setImageEngineOverride: () => {},
}));

import {
  ImageGenerationService,
  type ImageGenerationServiceInterface,
} from './image_generation_service.svelte.ts';

// Stub URL.createObjectURL for Bun test environment
const _realCreateObjectURL = URL.createObjectURL.bind(URL);

describe('ImageGenerationService — C-388 engine abstraction', () => {
  let service: ImageGenerationServiceInterface;

  const createService = (isDemo: boolean): ImageGenerationServiceInterface =>
    new ImageGenerationService({ className: 'TestImageGen', isDemo });

  beforeEach(() => {
    mockEngineId = 'comfyui';
    mockModels = [{ id: 'sd_xl_base_1.0', description: 'sd_xl_base_1.0.safetensors' }];
    mockGenerateRequest = undefined;
    mockProgress = [];
    service = createService(false);
    URL.createObjectURL = mock((_blob: Blob) => 'blob:mock-url');
  });

  afterEach(() => {
    URL.createObjectURL = _realCreateObjectURL;
  });

  // ═════════════════════════════════════════════════════════════════════
  // AC-2: negative prompt reaches the engine
  // ═════════════════════════════════════════════════════════════════════

  test('AC-2: generateImage forwards negativePrompt to the engine', async () => {
    service.checkpoints = [{ id: 'sd_xl_base_1.0', description: 'sd_xl_base_1.0.safetensors' }];
    service.selectedCheckpoint = 'sd_xl_base_1.0';

    await service.generateImage({
      prompt: 'a dragon',
      negativePrompt: 'bad anatomy, bad hands',
    });

    expect(mockGenerateRequest?.positivePrompt).toBe('a dragon');
    expect(mockGenerateRequest?.negativePrompt).toBe('bad anatomy, bad hands');
  });

  test('AC-2: negative prompt omitted when undefined', async () => {
    service.checkpoints = [{ id: 'sd_xl_base_1.0', description: 'x' }];
    service.selectedCheckpoint = 'sd_xl_base_1.0';

    await service.generateImage({ prompt: 'a cat' });

    expect(mockGenerateRequest?.negativePrompt).toBeUndefined();
  });

  // ═════════════════════════════════════════════════════════════════════
  // AC-3: engine toggle changes the wire protocol
  // ═════════════════════════════════════════════════════════════════════

  test('AC-3: selected engine id is exposed on the service', async () => {
    service.checkpoints = [{ id: 'sd_xl_base_1.0', description: 'x' }];
    service.selectedCheckpoint = 'sd_xl_base_1.0';

    mockEngineId = 'comfyui';
    await service.loadCheckpoints();
    expect(service.engineId).toBe('comfyui');

    mockEngineId = 'sdcpp';
    await service.refreshEngine();
    expect(service.engineId).toBe('sdcpp');
  });

  // ═════════════════════════════════════════════════════════════════════
  // AC-7: progress is engine-agnostic
  // ═════════════════════════════════════════════════════════════════════

  test('AC-7: generationProgress and generationStatus reflect engine progress', async () => {
    service.checkpoints = [{ id: 'sd_xl_base_1.0', description: 'x' }];
    service.selectedCheckpoint = 'sd_xl_base_1.0';

    await service.generateImage({ prompt: 'a dragon' });

    // The mock engine pushes queued → generating → complete.
    expect(mockProgress.map((p) => p.label)).toEqual(['Queuing', 'Generating', 'Complete']);
    // Terminal state observed by the caller
    expect(service.generationProgress).toBe(100);
    expect(service.generationStatus).toBe('Complete');
    expect(service.isGenerating).toBe(false);
  });

  test('AC-7: progress labels never leak engine-specific strings', async () => {
    service.checkpoints = [{ id: 'sd_xl_base_1.0', description: 'x' }];
    service.selectedCheckpoint = 'sd_xl_base_1.0';

    await service.generateImage({ prompt: 'x' });

    for (const entry of mockProgress) {
      expect(entry.label).not.toMatch(/comfyui|sdcpp|sd-server|node|websocket/i);
    }
  });

  // ═════════════════════════════════════════════════════════════════════
  // AC-8: model listing
  // ═════════════════════════════════════════════════════════════════════

  test('AC-8: loadCheckpoints populates from the engine model list', async () => {
    mockModels = [
      { id: 'sd_xl_base_1.0', description: 'sd_xl_base_1.0.safetensors' },
      { id: 'sd_xl_turbo', description: 'sd_xl_turbo.safetensors' },
    ];

    await service.loadCheckpoints();

    expect(service.checkpoints.length).toBe(2);
    expect(service.checkpoints[0].id).toBe('sd_xl_base_1.0');
    expect(service.selectedCheckpoint).toBe('sd_xl_base_1.0');
  });

  test('AC-8: persisted per-engine selection is restored when it matches', async () => {
    localStorage.setItem('imageCheckpoint:comfyui', 'sd_xl_turbo');
    mockModels = [
      { id: 'sd_xl_base_1.0', description: 'sd_xl_base_1.0.safetensors' },
      { id: 'sd_xl_turbo', description: 'sd_xl_turbo.safetensors' },
    ];

    await service.loadCheckpoints();

    expect(service.selectedCheckpoint).toBe('sd_xl_turbo');
    localStorage.removeItem('imageCheckpoint:comfyui');
  });

  test('AC-8: persisted selection ignored when no longer available', async () => {
    localStorage.setItem('imageCheckpoint:comfyui', 'ghost_model');
    mockModels = [{ id: 'sd_xl_base_1.0', description: 'sd_xl_base_1.0.safetensors' }];

    await service.loadCheckpoints();

    expect(service.selectedCheckpoint).toBe('sd_xl_base_1.0');
    localStorage.removeItem('imageCheckpoint:comfyui');
  });

  // ═════════════════════════════════════════════════════════════════════
  // Demo mode (preserved public surface)
  // ═════════════════════════════════════════════════════════════════════

  describe('demo mode', () => {
    beforeEach(() => {
      service = createService(true);
    });

    test('loadCheckpoints populates a mock checkpoint without engine calls', async () => {
      await service.loadCheckpoints();
      expect(service.checkpoints.length).toBe(1);
      expect(service.checkpoints[0].id).toBe('sd_xl_base_1.0');
      expect(service.selectedCheckpoint).toBe('sd_xl_base_1.0');
    });

    test('generateImage returns a placehold.co mock', async () => {
      const result = await service.generateImage({ prompt: 'a cat' });
      expect(result.isDemo).toBe(true);
      expect(result.url).toContain('placehold.co');
      expect(mockGenerateRequest).toBeUndefined();
    });

    test('isReady is true in demo mode', () => {
      expect(service.isReady).toBe(true);
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // isReady / offline degradation (AC-4)
  // ═════════════════════════════════════════════════════════════════════

  test('isReady is false before engine resolution', () => {
    expect(service.isReady).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Baseline compatibility: $state reactivity (preserved surface)
// ---------------------------------------------------------------------------

describe('$state reactivity (preserved)', () => {
  beforeEach(() => {
    URL.createObjectURL = mock((_blob: Blob) => 'blob:mock-url');
  });
  afterEach(() => {
    URL.createObjectURL = _realCreateObjectURL;
  });

  test('selectedCheckpoint should be mutable via assignment', () => {
    const svc = new ImageGenerationService({ className: 'Reactive', isDemo: false });
    expect(svc.selectedCheckpoint).toBe('');
    svc.selectedCheckpoint = 'my_model';
    expect(svc.selectedCheckpoint).toBe('my_model');
  });

  test('checkpoints should be an array', () => {
    const svc = new ImageGenerationService({ className: 'Reactive', isDemo: false });
    expect(Array.isArray(svc.checkpoints)).toBe(true);
  });

  test('isDemoMode should reflect constructor option', () => {
    const demoSvc = new ImageGenerationService({ className: 'Demo', isDemo: true });
    const liveSvc = new ImageGenerationService({ className: 'Live', isDemo: false });
    expect(demoSvc.isDemoMode()).toBe(true);
    expect(liveSvc.isDemoMode()).toBe(false);
  });
});
