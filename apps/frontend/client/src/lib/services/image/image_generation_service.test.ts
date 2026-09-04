// apps/frontend/client/src/lib/services/image/image_generation_service.test.ts
// biome-ignore-all lint/style/useNamingConvention: Property names must match ComfyUI API field names (PascalCase and snake_case)
//
// ImageGenerationService — C-388 AC-2 (negative prompt reaches engine),
// AC-3 (engine toggle changes wire protocol), AC-7 (progress),
// AC-8 (model listing both engines).
//
// Contract: C-388 Image Engine Provider Abstraction

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// config_service.svelte.ts is fully mocked below (both by its own relative
// specifier and via '$services'), but crypto_vault is stubbed defensively
// too — the real config_service.svelte.ts still imports
// { clearVault, decrypt, encrypt } from it, and the shared test_preload.ts
// stub (`{}`) breaks that import if any resolution path in the module graph
// reaches the real config_service.svelte.ts instead of the mock above.
mock.module('$lib/views/utils/crypto_vault', () => ({
  encrypt: async (): Promise<void> => {},
  decrypt: async (): Promise<string | undefined> => undefined,
  clearVault: (): void => {},
}));

// Mock the engine factory BEFORE importing the service so loadCheckpoints /
// generateImage delegate to a controllable engine.
let mockEngineId: 'comfyui' | 'sdcpp' = 'comfyui';
let mockModels: Array<{ id: string; description: string }> = [
  { id: 'sd_xl_base_1.0', description: 'sd_xl_base_1.0.safetensors' },
];
let mockGenerateRequest: Record<string, unknown> | undefined;
/** Service-observed progress/status captured after each onProgress callback. */
let serviceProgressCapture: Array<{ progress: number; status: string }> = [];
let serviceRef: ImageGenerationServiceInterface | undefined;

// The service reads the legacy checkpoint via configService.state.image.checkpoint,
// and (C-463) the portrait role's ImageParams via configService.resolveRole().
// Provide a mutable stand-in so both branches are testable.
let mockPortraitParams:
  | { checkpoint?: string; width?: number; height?: number; steps?: number; cfg?: number }
  | undefined;
const mockConfigService = {
  state: {
    image: {
      checkpoint: '',
    },
  },
  resolveRole: (role: string) =>
    role === 'portrait' && mockPortraitParams ? { params: mockPortraitParams } : undefined,
};

mock.module('$services', () => ({
  configService: mockConfigService,
}));

mock.module('../config/config_service.svelte.ts', () => ({
  configService: mockConfigService,
}));

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
          serviceProgressCapture.push({
            progress: serviceRef?.generationProgress ?? 0,
            status: serviceRef?.generationStatus ?? '',
          });
          callbacks.onProgress({ fraction: 0.5, label: 'Generating' });
          serviceProgressCapture.push({
            progress: serviceRef?.generationProgress ?? 0,
            status: serviceRef?.generationStatus ?? '',
          });
          callbacks.onProgress({ fraction: 1, label: 'Complete' });
          serviceProgressCapture.push({
            progress: serviceRef?.generationProgress ?? 0,
            status: serviceRef?.generationStatus ?? '',
          });
        }
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
    mockPortraitParams = undefined;
    serviceProgressCapture = [];
    service = createService(false);
    serviceRef = service;
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
  // C-463 PR: portrait role's ImageParams are defaults, call-site args win
  // ═════════════════════════════════════════════════════════════════════

  test('C-463: portrait role ImageParams fill width/height/steps/cfgScale/checkpoint when omitted', async () => {
    mockPortraitParams = {
      checkpoint: 'role_checkpoint',
      width: 768,
      height: 1024,
      steps: 30,
      cfg: 7,
    };

    await service.generateImage({ prompt: 'a cat' });

    expect(mockGenerateRequest?.model).toBe('role_checkpoint');
    expect(mockGenerateRequest?.width).toBe(768);
    expect(mockGenerateRequest?.height).toBe(1024);
    expect(mockGenerateRequest?.steps).toBe(30);
    expect(mockGenerateRequest?.cfgScale).toBe(7);
  });

  test('C-463: an explicit width argument beats the portrait connection ImageParams.width', async () => {
    mockPortraitParams = { width: 768, height: 1024 };

    await service.generateImage({ prompt: 'a cat', width: 512 });

    expect(mockGenerateRequest?.width).toBe(512);
    // height still comes from the connection default.
    expect(mockGenerateRequest?.height).toBe(1024);
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

    // Service-observed values after each onProgress callback — the mapped
    // ImageProgress (fraction→0-100, engine-agnostic label).
    expect(serviceProgressCapture.map((p) => p.status)).toEqual([
      'Queuing',
      'Generating',
      'Complete',
    ]);
    expect(serviceProgressCapture[0].progress).toBe(5);
    expect(serviceProgressCapture[1].progress).toBe(50);
    expect(serviceProgressCapture[2].progress).toBe(100);
    // Terminal state observed by the caller
    expect(service.generationProgress).toBe(100);
    expect(service.generationStatus).toBe('Complete');
    expect(service.isGenerating).toBe(false);
  });

  test('AC-7: progress labels never leak engine-specific strings', async () => {
    service.checkpoints = [{ id: 'sd_xl_base_1.0', description: 'x' }];
    service.selectedCheckpoint = 'sd_xl_base_1.0';

    await service.generateImage({ prompt: 'x' });

    for (const entry of serviceProgressCapture) {
      expect(entry.status).not.toMatch(/comfyui|sdcpp|sd-server|node|websocket/i);
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

  test('Migration: legacy config checkpoint migrates into the namespaced key', async () => {
    // Legacy path: configService.state.image.checkpoint set, namespaced key unset.
    localStorage.removeItem('imageCheckpoint:comfyui');
    mockModels = [{ id: 'legacy_model', description: 'legacy_model.safetensors' }];
    mockConfigService.state.image.checkpoint = 'legacy_model';

    await service.loadCheckpoints();

    expect(service.selectedCheckpoint).toBe('legacy_model');
    expect(localStorage.getItem('imageCheckpoint:comfyui')).toBe('legacy_model');
    mockConfigService.state.image.checkpoint = '';
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
