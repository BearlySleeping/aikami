// apps/frontend/client/src/lib/views/dev/image/image_view_model.test.ts
// biome-ignore-all lint/style/useNamingConvention: Mock object properties mirror PascalCase class names from @aikami/frontend-services
//
// ImageViewModel — C-388 AC-5 (capability-gated controls) + delegation.
//
// Contract: C-388 Image Engine Provider Abstraction

import { beforeEach, describe, expect, mock, test } from 'bun:test';

// $state and $derived are polyfilled globally via test_preload.ts

// ---------------------------------------------------------------------------
// Mock the $services barrel before importing the ViewModel
// ---------------------------------------------------------------------------

let mockCheckpoints: Array<{ id: string; description: string }> = [];
let mockSelectedCheckpoint = '';
let mockEngineId: string | undefined;
let mockCapabilities: Record<string, boolean> | undefined = {};
let mockGenerateImageCalls: Array<Record<string, unknown>> = [];
let mockRefreshEngineCalled = false;
let loadCheckpointsCalled = false;

mock.module('$lib/services/index.ts', () => ({
  imageGenerationService: {
    get checkpoints() {
      return mockCheckpoints;
    },
    get selectedCheckpoint(): string {
      return mockSelectedCheckpoint;
    },
    set selectedCheckpoint(value: string) {
      mockSelectedCheckpoint = value;
    },
    get engineId(): string | undefined {
      return mockEngineId;
    },
    get capabilities(): Record<string, boolean> | undefined {
      return mockCapabilities;
    },
    get isAutoDetect(): boolean {
      return mockEngineId === undefined;
    },
    loadCheckpoints: mock(async (): Promise<void> => {
      loadCheckpointsCalled = true;
      mockCheckpoints = [
        { id: 'sd_xl_base_1.0', description: 'SDXL Base 1.0' },
        { id: 'sd_xl_turbo', description: 'SDXL Turbo' },
      ];
      if (!mockSelectedCheckpoint) {
        mockSelectedCheckpoint = 'sd_xl_base_1.0';
      }
    }),
    refreshEngine: mock(async (): Promise<void> => {
      mockRefreshEngineCalled = true;
    }),
    setEngine: mock(async (_engine: string): Promise<void> => {
      mockEngineId = _engine;
      mockRefreshEngineCalled = true;
    }),
    generateImage: mock(
      async (options: Record<string, unknown>): Promise<{ url: string; isDemo: boolean }> => {
        mockGenerateImageCalls.push(options);
        return { url: 'blob:mock-url', isDemo: false };
      },
    ),
    releaseResultUrl: mock((_url: string): void => {}),
    cancel: mock(() => {}),
    isDemoMode: mock((): boolean => true),
  },
  // Other services the ViewModel imports
  compileImagePrompt: mock(() => ({ positive: '', negative: '' })),
  styleProfileService: {
    get profiles() {
      return [];
    },
    get activeProfileId() {
      return '';
    },
    setActiveProfile: mock(() => {}),
    get activeProfile() {
      return undefined;
    },
  },
  __esModule: true,
}));

import type { ImageViewModelInterface } from './image_view_model.svelte.ts';

const getImageViewModel = async (): Promise<ImageViewModelInterface> => {
  const mod = await import('./image_view_model.svelte.ts');
  return mod.getImageViewModel({ className: 'ImageViewModel' });
};

describe('ImageViewModel — C-388 engine abstraction', () => {
  beforeEach(() => {
    mockCheckpoints = [];
    mockSelectedCheckpoint = '';
    mockEngineId = 'comfyui';
    mockCapabilities = {
      negativePrompt: true,
      seed: true,
      sampler: true,
      initImage: true,
      mask: false,
      referenceImages: false,
      controlNet: false,
      lora: false,
      cancel: true,
      progress: true,
    };
    mockGenerateImageCalls = [];
    mockRefreshEngineCalled = false;
    loadCheckpointsCalled = false;
  });

  // ── Checkpoint bridging (preserved) ────────────────────────────────

  test('checkpoints getter should return empty array before load', async () => {
    const viewModel = await getImageViewModel();
    expect(viewModel.checkpoints).toEqual([]);
  });

  test('initialize should call loadCheckpoints and populate checkpoints', async () => {
    const viewModel = await getImageViewModel();
    await viewModel.initialize();
    expect(loadCheckpointsCalled).toBe(true);
    expect(viewModel.checkpoints.length).toBe(2);
  });

  test('selectedCheckpoint getter/setter proxies to service', async () => {
    const viewModel = await getImageViewModel();
    mockSelectedCheckpoint = 'sd_xl_turbo';
    expect(viewModel.selectedCheckpoint).toBe('sd_xl_turbo');

    viewModel.selectedCheckpoint = 'dreamshaper_xl';
    expect(mockSelectedCheckpoint).toBe('dreamshaper_xl');
  });

  // ── Engine selector (C-388) ────────────────────────────────────────

  test('engineId exposes the active engine', async () => {
    const viewModel = await getImageViewModel();
    expect(viewModel.engineId).toBe('comfyui');
  });

  test('setEngine delegates to the service', async () => {
    const viewModel = await getImageViewModel();
    await viewModel.setEngine('sdcpp');
    expect(mockEngineId).toBe('sdcpp');
    expect(mockRefreshEngineCalled).toBe(true);
  });

  // ── AC-5: capabilities gate the control list ───────────────────────

  test('AC-5: mask control absent when capabilities.mask is false', async () => {
    mockCapabilities = { ...mockCapabilities, mask: false };
    const viewModel = await getImageViewModel();
    expect(viewModel.availableControls).not.toContain('mask');
  });

  test('AC-5: mask control present when capabilities.mask is true', async () => {
    mockCapabilities = { ...mockCapabilities, mask: true };
    const viewModel = await getImageViewModel();
    expect(viewModel.availableControls).toContain('mask');
  });

  test('AC-5: negativePrompt/seed/sampler present when supported', async () => {
    const viewModel = await getImageViewModel();
    expect(viewModel.availableControls).toContain('negativePrompt');
    expect(viewModel.availableControls).toContain('seed');
    expect(viewModel.availableControls).toContain('sampler');
    expect(viewModel.availableControls).not.toContain('lora');
    expect(viewModel.availableControls).not.toContain('referenceImages');
  });

  test('AC-5: availableControls empty when no engine resolved', async () => {
    mockEngineId = undefined;
    mockCapabilities = undefined;
    const viewModel = await getImageViewModel();
    expect(viewModel.availableControls).toEqual([]);
  });

  // ── Generation delegation (no private ComfyUI transport) ───────────

  test('generate delegates to imageGenerationService with negative prompt', async () => {
    const viewModel = await getImageViewModel();
    viewModel.prompt = 'a dragon';
    viewModel.negativePrompt = 'bad anatomy, bad hands';
    viewModel.width = 768;
    viewModel.height = 1024;
    viewModel.steps = 25;
    viewModel.cfg = 8.0;
    viewModel.sampler = 'dpmpp_2m';
    viewModel.seed = 42;

    await viewModel.generate();

    expect(mockGenerateImageCalls.length).toBe(1);
    const call = mockGenerateImageCalls[0];
    expect(call.prompt).toBe('a dragon');
    expect(call.negativePrompt).toBe('bad anatomy, bad hands');
    expect(call.width).toBe(768);
    expect(call.height).toBe(1024);
    expect(call.steps).toBe(25);
    expect(call.cfgScale).toBe(8.0);
    expect(call.sampler).toBe('dpmpp_2m');
    expect(call.seed).toBe(42);
    expect(viewModel.results).toEqual(['blob:mock-url']);
  });

  test('generate passes initImage + denoise for img2img paths', async () => {
    const viewModel = await getImageViewModel();
    viewModel.prompt = 'x';
    viewModel.inputImageDataUrl = 'data:image/png;base64,AAA=';
    viewModel.editPrompt = 'make it blue';
    viewModel.editDenoise = 0.6;

    await viewModel.editImage();

    expect(mockGenerateImageCalls.length).toBe(1);
    expect(mockGenerateImageCalls[0].initImage).toBe('data:image/png;base64,AAA=');
    expect(mockGenerateImageCalls[0].denoise).toBe(0.6);
  });

  test('generateExpressions runs sequentially with initImage', async () => {
    const viewModel = await getImageViewModel();
    viewModel.inputImageDataUrl = 'data:image/png;base64,BBB=';

    // Stub the 500 ms inter-expression delay so the 8 calls complete fast.
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((handler: () => void) => {
      handler();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    try {
      await viewModel.generateExpressions();
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }

    // 8 expressions × 1 call each
    expect(mockGenerateImageCalls.length).toBe(8);
    for (const call of mockGenerateImageCalls) {
      expect(call.initImage).toBe('data:image/png;base64,BBB=');
      expect(call.denoise).toBe(0.45);
    }
    expect(Object.keys(viewModel.expressionResults).length).toBe(8);
  });

  test('generate does not call service when prompt is empty', async () => {
    const viewModel = await getImageViewModel();
    viewModel.prompt = '  ';
    await viewModel.generate();
    expect(mockGenerateImageCalls.length).toBe(0);
  });

  test('cancel should set isGenerating to false', async () => {
    const viewModel = await getImageViewModel();
    viewModel.isGenerating = true;
    viewModel.cancel();
    expect(viewModel.isGenerating).toBe(false);
  });

  // ── Compile pipeline preserved ─────────────────────────────────────

  test('compilePrompt still runs the style profile pipeline', async () => {
    const viewModel = await getImageViewModel();
    viewModel.prompt = 'heroic knight';
    viewModel.compilePrompt();
    // No crash; summary may be empty when no profile is active
    expect(typeof viewModel.compiledTagsSummary).toBe('string');
  });
});
