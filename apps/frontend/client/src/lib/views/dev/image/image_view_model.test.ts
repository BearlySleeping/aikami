// apps/frontend/client/src/lib/views/dev/image/image_view_model.test.ts
//
// ImageViewModel — C-388 AC-5 (capability-gated controls) + delegation.
//
// This suite constructs the ViewModel through explicit capability fixtures —
// no `$services` barrel mock and no shared test inventory
// inventory. Each test wires only the capabilities it exercises.
//
// Contract: C-388 Image Engine Provider Abstraction

import { describe, expect, test } from 'bun:test';
import type { ImageStyleProfile } from '@aikami/types';
import {
  createImageViewModel,
  type ImageGenerationCapabilities,
  type ImagePromptCompilerCapabilities,
  type ImageViewModelInterface,
  type StyleProfileCapabilities,
} from './image_view_model.svelte.ts';

type EngineFlags = NonNullable<ImageGenerationCapabilities['capabilities']>;
type ResolvedEngineId = NonNullable<ImageGenerationCapabilities['engineId']>;
type GenerateCall = Parameters<ImageGenerationCapabilities['generateImage']>[0];

type ImageHarness = {
  state: {
    checkpoints: Array<{ id: string; description: string }>;
    selectedCheckpoint: string;
    engineId: ResolvedEngineId | undefined;
    capabilities: EngineFlags | undefined;
    loadCheckpointsCalled: boolean;
    refreshEngineCalled: boolean;
  };
  generateImageCalls: GenerateCall[];
  viewModel: ImageViewModelInterface;
};

const BASE_CAPABILITIES: EngineFlags = {
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

const createStyleProfiles = (
  overrides: Partial<StyleProfileCapabilities> = {},
): StyleProfileCapabilities => {
  const profile: ImageStyleProfile = {
    id: 'style-1',
    name: 'Test Style',
    isBuiltIn: false,
    promptGrammar: 'commaTags',
    positiveTags: 'sharp focus',
    negativeTags: 'blurry',
    perImageTags: { background: 'wide shot' },
  };
  return {
    profiles: [profile],
    activeProfileId: profile.id,
    activeProfile: profile,
    setActiveProfile: () => {},
    ...overrides,
  };
};

const createHarness = (
  overrides: {
    engineId?: ResolvedEngineId | undefined;
    capabilities?: EngineFlags | undefined;
    styleProfiles?: StyleProfileCapabilities;
  } = {},
): ImageHarness => {
  const state: ImageHarness['state'] = {
    checkpoints: [],
    selectedCheckpoint: '',
    engineId: 'engineId' in overrides ? overrides.engineId : 'comfyui',
    capabilities: 'capabilities' in overrides ? overrides.capabilities : BASE_CAPABILITIES,
    loadCheckpointsCalled: false,
    refreshEngineCalled: false,
  };
  const generateImageCalls: GenerateCall[] = [];

  const imageGeneration: ImageGenerationCapabilities = {
    get checkpoints() {
      return state.checkpoints;
    },
    get selectedCheckpoint() {
      return state.selectedCheckpoint;
    },
    set selectedCheckpoint(value: string) {
      state.selectedCheckpoint = value;
    },
    get engineId() {
      return state.engineId;
    },
    get capabilities() {
      return state.capabilities;
    },
    get isAutoDetect() {
      return state.engineId === undefined;
    },
    loadCheckpoints: async () => {
      state.loadCheckpointsCalled = true;
      state.checkpoints = [
        { id: 'sd_xl_base_1.0', description: 'SDXL Base 1.0' },
        { id: 'sd_xl_turbo', description: 'SDXL Turbo' },
      ];
      if (!state.selectedCheckpoint) {
        state.selectedCheckpoint = 'sd_xl_base_1.0';
      }
    },
    refreshEngine: async () => {
      state.refreshEngineCalled = true;
    },
    setEngine: async (engine) => {
      state.engineId = engine === 'auto' ? undefined : engine;
      state.refreshEngineCalled = true;
    },
    generateImage: async (options) => {
      generateImageCalls.push(options);
      return { url: 'blob:mock-url', isDemo: false };
    },
    releaseResultUrl: () => {},
    cancel: () => {},
  };

  const compiler: ImagePromptCompilerCapabilities = {
    compileImagePrompt: ({ basePrompt, profile }) => ({
      positive: `${profile.positiveTags}${basePrompt ? `, ${basePrompt}` : ''}`,
      negative: profile.negativeTags,
    }),
  };

  const viewModel = createImageViewModel({
    className: 'ImageViewModel',
    imageGeneration,
    styleProfiles: overrides.styleProfiles ?? createStyleProfiles(),
    compiler,
    getConfiguredEngineId: () => 'comfyui',
  });

  return { state, generateImageCalls, viewModel };
};

describe('ImageViewModel — C-388 engine abstraction', () => {
  // ── Checkpoint bridging (preserved) ────────────────────────────────

  test('checkpoints getter returns empty array before load', () => {
    const { viewModel } = createHarness();
    expect(viewModel.checkpoints).toEqual([]);
  });

  test('initialize calls loadCheckpoints and populates checkpoints', async () => {
    const { state, viewModel } = createHarness();
    await viewModel.initialize();
    expect(state.loadCheckpointsCalled).toBe(true);
    expect(viewModel.checkpoints.length).toBe(2);
  });

  test('selectedCheckpoint getter/setter proxies to the capability', () => {
    const { state, viewModel } = createHarness();
    state.selectedCheckpoint = 'sd_xl_turbo';
    expect(viewModel.selectedCheckpoint).toBe('sd_xl_turbo');

    viewModel.selectedCheckpoint = 'dreamshaper_xl';
    expect(state.selectedCheckpoint).toBe('dreamshaper_xl');
  });

  // ── Engine selector (C-388) ────────────────────────────────────────

  test('engineId exposes the active engine', () => {
    const { viewModel } = createHarness();
    expect(viewModel.engineId).toBe('comfyui');
  });

  test('setEngine delegates to the capability', async () => {
    const { state, viewModel } = createHarness();
    await viewModel.setEngine('sdcpp');
    expect(state.engineId).toBe('sdcpp');
    expect(state.refreshEngineCalled).toBe(true);
  });

  // ── AC-5: capabilities gate the control list ───────────────────────

  test('AC-5: mask control absent when capabilities.mask is false', () => {
    const { viewModel } = createHarness({
      capabilities: { ...BASE_CAPABILITIES, mask: false },
    });
    expect(viewModel.availableControls).not.toContain('mask');
  });

  test('AC-5: mask control present when capabilities.mask is true', () => {
    const { viewModel } = createHarness({
      capabilities: { ...BASE_CAPABILITIES, mask: true },
    });
    expect(viewModel.availableControls).toContain('mask');
  });

  test('AC-5: negativePrompt/seed/sampler present when supported', () => {
    const { viewModel } = createHarness();
    expect(viewModel.availableControls).toContain('negativePrompt');
    expect(viewModel.availableControls).toContain('seed');
    expect(viewModel.availableControls).toContain('sampler');
    expect(viewModel.availableControls).not.toContain('lora');
    expect(viewModel.availableControls).not.toContain('referenceImages');
  });

  test('AC-5: availableControls empty when no engine resolved', () => {
    const { viewModel } = createHarness({ engineId: undefined, capabilities: undefined });
    expect(viewModel.availableControls).toEqual([]);
  });

  // ── Generation delegation (no private ComfyUI transport) ───────────

  test('generate delegates to the capability with negative prompt', async () => {
    const { generateImageCalls, viewModel } = createHarness();
    viewModel.autoCompile = false;
    viewModel.prompt = 'a dragon';
    viewModel.negativePrompt = 'bad anatomy, bad hands';
    viewModel.width = 768;
    viewModel.height = 1024;
    viewModel.steps = 25;
    viewModel.cfg = 8.0;
    viewModel.sampler = 'dpmpp_2m';
    viewModel.seed = 42;

    await viewModel.generate();

    expect(generateImageCalls.length).toBe(1);
    const call = generateImageCalls[0];
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

  test('editImage passes initImage + denoise for img2img paths', async () => {
    const { generateImageCalls, viewModel } = createHarness();
    viewModel.prompt = 'x';
    viewModel.inputImageDataUrl = 'data:image/png;base64,AAA=';
    viewModel.editPrompt = 'make it blue';
    viewModel.editDenoise = 0.6;

    await viewModel.editImage();

    expect(generateImageCalls.length).toBe(1);
    expect(generateImageCalls[0].initImage).toBe('data:image/png;base64,AAA=');
    expect(generateImageCalls[0].denoise).toBe(0.6);
  });

  test('generateExpressions runs sequentially with initImage', async () => {
    const { generateImageCalls, viewModel } = createHarness();
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
    expect(generateImageCalls.length).toBe(8);
    for (const call of generateImageCalls) {
      expect(call.initImage).toBe('data:image/png;base64,BBB=');
      expect(call.denoise).toBe(0.45);
    }
    expect(Object.keys(viewModel.expressionResults).length).toBe(8);
  });

  test('generate does not call the capability when prompt is empty', async () => {
    const { generateImageCalls, viewModel } = createHarness();
    viewModel.prompt = '  ';
    await viewModel.generate();
    expect(generateImageCalls.length).toBe(0);
  });

  test('cancel sets isGenerating to false', () => {
    const { viewModel } = createHarness();
    viewModel.isGenerating = true;
    viewModel.cancel();
    expect(viewModel.isGenerating).toBe(false);
  });

  // ── Compile pipeline preserved ─────────────────────────────────────

  test('compilePrompt runs the injected style profile pipeline', () => {
    const { viewModel } = createHarness();
    viewModel.prompt = 'heroic knight';
    viewModel.compilePrompt();

    expect(viewModel.prompt).toContain('sharp focus');
    expect(viewModel.negativePrompt).toBe('blurry');
    expect(viewModel.compiledTagsSummary).toContain('Test Style');
  });
});
