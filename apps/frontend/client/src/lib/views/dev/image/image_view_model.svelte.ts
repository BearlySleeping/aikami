// apps/frontend/client/src/lib/views/dev/image/image_view_model.svelte.ts
//
// Dev sandbox image ViewModel (C-388). Keeps its view-model interface but
// drops the private ComfyUI transports and workflow builders — all
// generation and uploads go through the engine abstraction
// (imageGenerationService → ImageEngineClient) so the sandbox honours the
// engine toggle.
//
// Contract: C-388 Image Engine Provider Abstraction

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { ImageEngineId, ImageType } from '@aikami/types';
import { getConfiguredImageEngineId } from '$lib/services/image/engine/image_engine_factory.svelte.ts';
import type { ImageEngineCapabilities } from '$lib/services/image/engine/types.ts';
import {
  type CheckpointInfo,
  compileImagePrompt,
  imageGenerationService,
  styleProfileService,
} from '$services';

export type { CheckpointInfo };

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

export const IMAGE_TABS = ['generate', 'expression-pack', 'edit'] as const;
export type ImageTab = (typeof IMAGE_TABS)[number];

export type ImageTabMeta = { key: ImageTab; label: string };

const TAB_META: readonly ImageTabMeta[] = [
  { key: 'generate', label: 'Image Gen' },
  { key: 'expression-pack', label: 'Expressions' },
  { key: 'edit', label: 'Image Edit' },
] as const;

// ---------------------------------------------------------------------------
// Sampler / scheduler lists
// ---------------------------------------------------------------------------

export const SAMPLERS = [
  'euler',
  'euler_ancestral',
  'heun',
  'heunpp2',
  'dpm_2',
  'dpm_2_ancestral',
  'lms',
  'dpmpp_2s_ancestral',
  'dpmpp_2m',
  'dpmpp_2m_sde',
  'dpmpp_3m_sde',
  'dpm_fast',
  'dpm_adaptive',
  'ddim',
  'uni_pc',
  'uni_pc_bh2',
] as const;

export const SCHEDULERS = [
  'normal',
  'karras',
  'exponential',
  'sgm_uniform',
  'simple',
  'ddim_uniform',
  'beta',
] as const;

// ---------------------------------------------------------------------------
// Expression definitions for expression pack
// ---------------------------------------------------------------------------

export type ExpressionDef = {
  id: string;
  label: string;
  prompt: string;
};

export const EXPRESSIONS: readonly ExpressionDef[] = [
  { id: 'neutral', label: 'Neutral', prompt: 'neutral expression, calm face, straight face' },
  { id: 'happy', label: 'Happy', prompt: 'happy expression, smiling, joyful' },
  { id: 'sad', label: 'Sad', prompt: 'sad expression, frowning, melancholy, tears' },
  { id: 'angry', label: 'Angry', prompt: 'angry expression, furious, rage, scowling' },
  { id: 'surprised', label: 'Surprised', prompt: 'surprised expression, shocked, wide eyes' },
  { id: 'laughing', label: 'Laughing', prompt: 'laughing expression, joyful, hearty laugh' },
  {
    id: 'thoughtful',
    label: 'Thoughtful',
    prompt: 'thoughtful expression, pensive, contemplative',
  },
  { id: 'flirty', label: 'Flirty', prompt: 'flirty expression, wink, playful smirk' },
] as const;

// ---------------------------------------------------------------------------
// Engine selector + capability-gated control list (AC-5)
// ---------------------------------------------------------------------------

export const ENGINE_OPTIONS = [
  { id: 'auto', label: 'Auto-detect (sd-server first)' },
  { id: 'sdcpp', label: 'sd-server (stable-diffusion.cpp)' },
  { id: 'comfyui', label: 'ComfyUI' },
] as const;

export type ImageControlId =
  | 'negativePrompt'
  | 'seed'
  | 'sampler'
  | 'initImage'
  | 'mask'
  | 'referenceImages'
  | 'lora';

const CONTROL_BY_CAPABILITY: readonly {
  control: ImageControlId;
  capability: keyof ImageEngineCapabilities;
}[] = [
  { control: 'negativePrompt', capability: 'negativePrompt' },
  { control: 'seed', capability: 'seed' },
  { control: 'sampler', capability: 'sampler' },
  { control: 'initImage', capability: 'initImage' },
  { control: 'mask', capability: 'mask' },
  { control: 'referenceImages', capability: 'referenceImages' },
  { control: 'lora', capability: 'lora' },
] as const;

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type ImageViewModelInterface = BaseViewModelInterface & {
  // ── Tab navigation ───────────────────────────────────────────────────
  readonly activeTab: ImageTab;
  readonly tabs: readonly ImageTabMeta[];
  setActiveTab(tab: ImageTab): void;

  // ── Engine selector (C-388) ─────────────────────────────────────────
  readonly engineId: string | undefined;
  readonly engineOptions: readonly { id: string; label: string }[];
  readonly isAutoDetect: boolean;
  /** Control ids the active engine supports — drives UI affordances (AC-5). */
  readonly availableControls: readonly ImageControlId[];
  refreshEngine(): Promise<void>;
  setEngine(engine: ImageEngineId): Promise<void>;

  // ── Shared ────────────────────────────────────────────────────────────
  readonly checkpoints: readonly CheckpointInfo[];
  selectedCheckpoint: string;
  readonly isGenerating: boolean;
  readonly generationProgress: number;
  readonly generationStatus: string;
  /** All result image URLs (gene/gen, expressions, edits). */
  readonly results: readonly string[];
  cancel(): void;

  // ── Style Profile Pipeline (C-242) ────────────────────────────────────
  styleProfileId: string;
  readonly styleProfiles: readonly { id: string; name: string; isBuiltIn: boolean }[];
  imageType: ImageType;
  readonly imageTypes: readonly ImageType[];
  autoCompile: boolean;
  readonly compiledTagsSummary: string;
  compilePrompt(): void;

  // ── Image Gen tab ─────────────────────────────────────────────────────
  readonly prompt: string;
  readonly negativePrompt: string;
  readonly width: number;
  readonly height: number;
  readonly steps: number;
  readonly cfg: number;
  readonly seed: number;
  readonly sampler: string;
  readonly scheduler: string;
  generate(): Promise<void>;

  // ── Image upload (shared by Expression Pack + Edit) ───────────────────
  readonly inputImageDataUrl: string | undefined;
  readonly inputImageName: string;
  handleImageUpload(file: File): void;
  clearInputImage(): void;

  // ── Expression Pack tab ───────────────────────────────────────────────
  readonly expressions: readonly ExpressionDef[];
  readonly expressionResults: Record<string, string | undefined>;
  readonly expressionProgress: Record<string, string>;
  generateExpressions(): Promise<void>;

  // ── Image Edit tab ────────────────────────────────────────────────────
  readonly editPrompt: string;
  readonly editDenoise: number;
  /** Optional inpainting mask (capability-gated, AC-5). */
  readonly inputMaskDataUrl: string | undefined;
  readonly inputMaskName: string;
  handleMaskUpload(file: File): void;
  clearMask(): void;
  editImage(): Promise<void>;
};

export type ImageViewModelOptions = BaseViewModelOptions & {};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class ImageViewModel
  extends BaseViewModel<ImageViewModelOptions>
  implements ImageViewModelInterface
{
  // Tab state
  activeTab: ImageTab = $state('generate');

  // ── Style Profile Pipeline (C-242) ───────────────────────────────────
  autoCompile = $state(true);
  imageType = $state<ImageType>('illustration');
  private _compiledTagsSummary = $state('');

  readonly imageTypes: readonly ImageType[] = [
    'background',
    'portrait',
    'illustration',
    'sprite',
    'selfie',
  ] as const;

  // Image Gen state
  prompt = $state('');
  negativePrompt = $state('');
  width = $state(512);
  height = $state(512);
  steps = $state(20);
  cfg = $state(7.0);
  seed = $state(-1);
  sampler = $state('euler');
  scheduler = $state('normal');

  // Shared generation state
  isGenerating = $state(false);
  generationProgress = $state(0);
  generationStatus = $state('');
  results: string[] = $state([]);

  // Image upload (shared)
  inputImageDataUrl = $state<string | undefined>();
  inputImageName = $state('');

  // Expression pack
  expressionResults: Record<string, string | undefined> = $state({});
  expressionProgress: Record<string, string> = $state({});

  // Image edit
  editPrompt = $state('');
  editDenoise = $state(0.55);

  // Inpainting mask (capability-gated)
  inputMaskDataUrl = $state<string | undefined>();
  inputMaskName = $state('');

  private _abortController: AbortController | undefined;

  // ── Getters ──────────────────────────────────────────────────────────

  get tabs(): readonly ImageTabMeta[] {
    return TAB_META;
  }

  get checkpoints(): readonly CheckpointInfo[] {
    return imageGenerationService.checkpoints;
  }

  get selectedCheckpoint(): string {
    return imageGenerationService.selectedCheckpoint;
  }

  set selectedCheckpoint(value: string) {
    imageGenerationService.selectedCheckpoint = value;
  }

  get expressions(): readonly ExpressionDef[] {
    return EXPRESSIONS;
  }

  // ── Engine selector (C-388) ──────────────────────────────────────────

  /** Configured/preferred engine shown by the selector (default 'auto'). */
  private _selectedEngine = $state<ImageEngineId>(getConfiguredImageEngineId());

  get engineId(): string | undefined {
    return imageGenerationService.engineId;
  }

  /**
   * Engine preference the selector binds to — 'auto' until the user picks a
   * concrete engine, independent of the resolved-engine badge (engineId).
   */
  get selectedEngine(): ImageEngineId {
    return this._selectedEngine;
  }

  set selectedEngine(value: ImageEngineId) {
    this._selectedEngine = value;
    void this.setEngine(value);
  }

  get engineOptions(): readonly { id: string; label: string }[] {
    return ENGINE_OPTIONS;
  }

  get isAutoDetect(): boolean {
    return imageGenerationService.isAutoDetect;
  }

  get availableControls(): readonly ImageControlId[] {
    const capabilities = imageGenerationService.capabilities;
    if (!capabilities) {
      return [];
    }
    return CONTROL_BY_CAPABILITY.filter((entry) => capabilities[entry.capability]).map(
      (entry) => entry.control,
    );
  }

  async refreshEngine(): Promise<void> {
    this.cancel();
    this._releaseResults();
    this.inputMaskDataUrl = undefined;
    this.inputMaskName = '';
    await imageGenerationService.refreshEngine();
  }

  async setEngine(engine: ImageEngineId): Promise<void> {
    this.cancel();
    this._releaseResults();
    this.inputMaskDataUrl = undefined;
    this.inputMaskName = '';
    this._selectedEngine = engine;
    await imageGenerationService.setEngine(engine);
  }

  // ── Pipeline getters/setters (C-242) ──────────────────────────────────

  get styleProfiles(): readonly { id: string; name: string; isBuiltIn: boolean }[] {
    return styleProfileService.profiles;
  }

  get styleProfileId(): string {
    return styleProfileService.activeProfileId;
  }

  set styleProfileId(value: string) {
    styleProfileService.setActiveProfile(value);
  }

  get compiledTagsSummary(): string {
    return this._compiledTagsSummary;
  }

  /** Compiles the current prompt through the active style profile pipeline. */
  compilePrompt(): void {
    const profile = styleProfileService.activeProfile;
    if (!profile) {
      return;
    }

    const compiled = compileImagePrompt({
      basePrompt: this.prompt,
      profile,
      imageType: this.imageType,
    });

    this.prompt = compiled.positive;
    this.negativePrompt = compiled.negative;

    this._compiledTagsSummary =
      `${profile.name} / ${this.imageType} — ` +
      `Pos: ${compiled.positive.length} chars, Neg: ${compiled.negative.length} chars`;
  }

  // ── Public: navigation ────────────────────────────────────────────────

  setActiveTab(tab: ImageTab): void {
    this.activeTab = tab;
  }

  // ── Public: lifecycle ─────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    await super.initialize();
    void imageGenerationService.loadCheckpoints();
  }

  // ── Public: image upload ──────────────────────────────────────────────

  handleImageUpload(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      this.inputImageDataUrl = reader.result as string;
      this.inputImageName = file.name;
    };
    reader.readAsDataURL(file);
  }

  clearInputImage(): void {
    this.inputImageDataUrl = undefined;
    this.inputImageName = '';
    this._releaseResults();
    this.results = [];
  }

  // ── Public: mask upload (capability-gated, AC-5) ─────────────────────

  handleMaskUpload(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      this.inputMaskDataUrl = reader.result as string;
      this.inputMaskName = file.name;
    };
    reader.readAsDataURL(file);
  }

  clearMask(): void {
    this.inputMaskDataUrl = undefined;
    this.inputMaskName = '';
  }

  // ── Public: cancel ────────────────────────────────────────────────────

  cancel(): void {
    this._abortController?.abort();
    this._abortController = undefined;
    imageGenerationService.cancel();
    this.isGenerating = false;
    this.generationProgress = 0;
    this.generationStatus = '';
  }

  /** Releases previously returned result URLs before they are replaced. */
  private _releaseResults(): void {
    for (const url of this.results) {
      imageGenerationService.releaseResultUrl(url);
    }
  }

  // ── Public: Image Gen ─────────────────────────────────────────────────

  async generate(): Promise<void> {
    if (!this.prompt.trim()) {
      return;
    }

    // Auto-compile through style profile pipeline if enabled (C-242)
    if (this.autoCompile) {
      this.compilePrompt();
    }

    this.cancel();
    this._releaseResults();
    this.results = [];
    this.isGenerating = true;
    this.generationProgress = 0;
    this.generationStatus = 'Queuing';

    const abortController = new AbortController();
    this._abortController = abortController;

    try {
      const { prompt, negativePrompt, steps, cfg, sampler, seed } = this;
      const actualSeed = seed < 0 ? undefined : seed;

      const result = await imageGenerationService.generateImage({
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim() || undefined,
        checkpoint: this.selectedCheckpoint,
        width: this.width,
        height: this.height,
        steps,
        cfgScale: cfg,
        sampler,
        seed: actualSeed,
        signal: abortController.signal,
      });
      this._releaseResults();
      this.results = [result.url];
    } catch (error: unknown) {
      if ((error as Error).name === 'AbortError') {
        return;
      }
      this.error('generate:failed', error);
    } finally {
      this.isGenerating = false;
      this._abortController = undefined;
    }
  }

  // ── Public: Expression Pack ───────────────────────────────────────────

  async generateExpressions(): Promise<void> {
    if (!this.inputImageDataUrl) {
      return;
    }

    this.cancel();
    this.isGenerating = true;
    this.generationProgress = 0;
    this.expressionResults = {};
    this.expressionProgress = {};
    this._releaseResults();
    this.results = [];

    const abortController = new AbortController();
    this._abortController = abortController;

    try {
      // Run each expression sequentially against the shared input image.
      for (const expr of EXPRESSIONS) {
        if (abortController.signal.aborted) {
          break;
        }

        this.expressionProgress = { ...this.expressionProgress, [expr.id]: 'Generating...' };

        const result = await imageGenerationService.generateImage({
          prompt: `${expr.prompt}, same person, same face, same style, high quality`,
          negativePrompt: 'different person, different face, deformed, blurry',
          checkpoint: this.selectedCheckpoint,
          initImage: this.inputImageDataUrl,
          denoise: 0.45,
          steps: 25,
          cfgScale: 7.0,
          sampler: 'euler',
          signal: abortController.signal,
        });

        this.expressionResults = { ...this.expressionResults, [expr.id]: result.url };
        this.results = [...this.results, result.url];
        this.expressionProgress = { ...this.expressionProgress, [expr.id]: 'Done' };

        // Brief pause between expressions to avoid hammering the engine
        if (EXPRESSIONS.indexOf(expr) < EXPRESSIONS.length - 1) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    } catch (error: unknown) {
      if ((error as Error).name === 'AbortError') {
        return;
      }
      this.error('generateExpressions:failed', error);
    } finally {
      this.isGenerating = false;
      this._abortController = undefined;
    }
  }

  // ── Public: Image Edit ────────────────────────────────────────────────

  async editImage(): Promise<void> {
    if (!this.inputImageDataUrl || !this.editPrompt.trim()) {
      return;
    }

    this.cancel();
    this._releaseResults();
    this.results = [];
    this.isGenerating = true;
    this.generationProgress = 0;

    const abortController = new AbortController();
    this._abortController = abortController;

    try {
      const result = await imageGenerationService.generateImage({
        prompt: this.editPrompt.trim(),
        negativePrompt: 'deformed, blurry, low quality',
        checkpoint: this.selectedCheckpoint,
        initImage: this.inputImageDataUrl,
        denoise: this.editDenoise,
        mask: this.inputMaskDataUrl,
        steps: this.steps,
        cfgScale: this.cfg,
        sampler: this.sampler,
        seed: this.seed < 0 ? undefined : this.seed,
        signal: abortController.signal,
      });
      this._releaseResults();
      this.results = [result.url];
    } catch (error: unknown) {
      if ((error as Error).name === 'AbortError') {
        return;
      }
      this.error('editImage:failed', error);
    } finally {
      this.isGenerating = false;
      this._abortController = undefined;
    }
  }
}

export const getImageViewModel = (options: ImageViewModelOptions): ImageViewModelInterface =>
  ImageViewModel.create(options);
