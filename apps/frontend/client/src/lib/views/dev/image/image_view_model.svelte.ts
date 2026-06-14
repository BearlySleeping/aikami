// apps/frontend/client/src/lib/views/dev/image/image_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { type CheckpointInfo, imageGenerationService } from '$services';

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
  'euler', 'euler_ancestral', 'heun', 'heunpp2', 'dpm_2', 'dpm_2_ancestral',
  'lms', 'dpmpp_2s_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_3m_sde',
  'dpm_fast', 'dpm_adaptive', 'ddim', 'uni_pc', 'uni_pc_bh2',
] as const;

export const SCHEDULERS = [
  'normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'ddim_uniform', 'beta',
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
  { id: 'thoughtful', label: 'Thoughtful', prompt: 'thoughtful expression, pensive, contemplative' },
  { id: 'flirty', label: 'Flirty', prompt: 'flirty expression, wink, playful smirk' },
] as const;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_POLL_ATTEMPTS = 60;
const POLL_INTERVAL_MS = 1000;

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type ImageViewModelInterface = BaseViewModelInterface & {
  // ── Tab navigation ───────────────────────────────────────────────────
  readonly activeTab: ImageTab;
  readonly tabs: readonly ImageTabMeta[];
  setActiveTab(tab: ImageTab): void;

  // ── Shared ────────────────────────────────────────────────────────────
  readonly checkpoints: readonly CheckpointInfo[];
  selectedCheckpoint: string;
  readonly isGenerating: boolean;
  readonly generationProgress: number;
  readonly generationStatus: string;
  /** All result image URLs (gene/gen, expressions, edits). */
  readonly results: readonly string[];
  cancel(): void;

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
    this.results = [];
  }

  // ── Public: cancel ────────────────────────────────────────────────────

  cancel(): void {
    this._abortController?.abort();
    this._abortController = undefined;
    this.isGenerating = false;
    this.generationProgress = 0;
    this.generationStatus = '';
  }

  // ── Public: Image Gen ─────────────────────────────────────────────────

  async generate(): Promise<void> {
    if (!this.prompt.trim()) return;

    this.cancel();
    this.results = [];
    this.isGenerating = true;
    this.generationProgress = 0;
    this.generationStatus = 'Queuing...';

    const abortController = new AbortController();
    this._abortController = abortController;

    try {
      const { prompt, negativePrompt, steps, cfg, sampler, scheduler, seed } = this;
      const actualSeed = seed < 0 ? Math.floor(Math.random() * 2 ** 32) : seed;

      const workflow = this._buildTxt2ImgWorkflow({
        checkpoint: this.selectedCheckpoint,
        prompt: prompt.trim(),
        negative: negativePrompt.trim(),
        steps,
        cfg,
        sampler,
        scheduler,
        seed: actualSeed,
        width: this.width,
        height: this.height,
      });

      const url = await this._executeWorkflow(workflow, abortController.signal);
      this.results = [url];
    } catch (error: unknown) {
      if ((error as Error).name === 'AbortError') return;
      this.error('generate:failed', error);
    } finally {
      this.isGenerating = false;
      this._abortController = undefined;
    }
  }

  // ── Public: Expression Pack ───────────────────────────────────────────

  async generateExpressions(): Promise<void> {
    if (!this.inputImageDataUrl) return;

    this.cancel();
    this.isGenerating = true;
    this.generationProgress = 0;
    this.expressionResults = {};
    this.expressionProgress = {};
    this.results = [];

    const abortController = new AbortController();
    this._abortController = abortController;

    try {
      // Upload the input image to ComfyUI
      const imageName = await this._uploadImage(this.inputImageDataUrl, abortController.signal);
      if (!imageName) return;

      // Run each expression sequentially
      for (const expr of EXPRESSIONS) {
        if (abortController.signal.aborted) break;

        this.expressionProgress = { ...this.expressionProgress, [expr.id]: 'Generating...' };

        const workflow = this._buildImg2ImgWorkflow({
          checkpoint: this.selectedCheckpoint,
          imageName,
          prompt: `${expr.prompt}, same person, same face, same style, high quality`,
          negative: 'different person, different face, deformed, blurry',
          steps: 25,
          cfg: 7.0,
          sampler: 'euler',
          scheduler: 'normal',
          seed: Math.floor(Math.random() * 2 ** 32),
          denoise: 0.45,
        });

        const url = await this._executeWorkflow(workflow, abortController.signal);
        this.expressionResults = { ...this.expressionResults, [expr.id]: url };
        this.results = [...this.results, url];
        this.expressionProgress = { ...this.expressionProgress, [expr.id]: 'Done' };

        // Brief pause between expressions to avoid hammering ComfyUI
        if (EXPRESSIONS.indexOf(expr) < EXPRESSIONS.length - 1) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    } catch (error: unknown) {
      if ((error as Error).name === 'AbortError') return;
      this.error('generateExpressions:failed', error);
    } finally {
      this.isGenerating = false;
      this._abortController = undefined;
    }
  }

  // ── Public: Image Edit ────────────────────────────────────────────────

  async editImage(): Promise<void> {
    if (!this.inputImageDataUrl || !this.editPrompt.trim()) return;

    this.cancel();
    this.isGenerating = true;
    this.generationProgress = 0;
    this.results = [];

    const abortController = new AbortController();
    this._abortController = abortController;

    try {
      const imageName = await this._uploadImage(this.inputImageDataUrl, abortController.signal);
      if (!imageName) return;

      const workflow = this._buildImg2ImgWorkflow({
        checkpoint: this.selectedCheckpoint,
        imageName,
        prompt: this.editPrompt.trim(),
        negative: 'deformed, blurry, low quality',
        steps: this.steps,
        cfg: this.cfg,
        sampler: this.sampler,
        scheduler: this.scheduler,
        seed: this.seed < 0 ? Math.floor(Math.random() * 2 ** 32) : this.seed,
        denoise: this.editDenoise,
      });

      const url = await this._executeWorkflow(workflow, abortController.signal);
      this.results = [url];
    } catch (error: unknown) {
      if ((error as Error).name === 'AbortError') return;
      this.error('editImage:failed', error);
    } finally {
      this.isGenerating = false;
      this._abortController = undefined;
    }
  }

  // ── Private: image upload ─────────────────────────────────────────────

  private async _uploadImage(
    dataUrl: string,
    signal: AbortSignal,
  ): Promise<string | null> {
    this.generationStatus = 'Uploading image...';
    this.generationProgress = 2;

    try {
      // Convert data URL to Blob
      const response = await fetch(dataUrl);
      const blob = await response.blob();

      const formData = new FormData();
      formData.append('image', blob, this.inputImageName || 'input.png');

      const uploadResponse = await fetch('/api/image/upload/image', {
        method: 'POST',
        body: formData,
        signal,
      });

      if (!uploadResponse.ok) {
        this.error('_uploadImage: failed', { status: uploadResponse.status });
        return null;
      }

      const result = (await uploadResponse.json()) as { name?: string };
      return result.name ?? null;
    } catch (error) {
      this.error('_uploadImage: error', error);
      return null;
    }
  }

  // ── Private: workflow execution ───────────────────────────────────────

  private async _executeWorkflow(
    workflow: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<string> {
    this.generationStatus = 'Queuing...';
    this.generationProgress = 5;

    const queueResponse = await fetch('/api/image/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: `aikami-dev-${Date.now()}`, prompt: workflow }),
      signal,
    });

    if (!queueResponse.ok) {
      const errText = await queueResponse.text().catch(() => '');
      throw new Error(`ComfyUI API error (${queueResponse.status}): ${errText.slice(0, 200)}`);
    }

    const { prompt_id: promptId } = (await queueResponse.json()) as { prompt_id: string };

    this.generationStatus = 'Generating...';
    this.generationProgress = 10;

    for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      const historyResponse = await fetch(`/api/image/history/${promptId}`, { signal });

      if (historyResponse.ok) {
        const history = await historyResponse.json() as Record<string, unknown>;
        const entry = history[promptId];

        if (entry) {
          const outputs = (entry as Record<string, unknown>).outputs as Record<string, unknown>;
          const node9 = outputs?.['9'] as
            | { images?: Array<{ filename: string; subfolder?: string }> }
            | undefined;
          const images = node9?.images;

          if (images && images.length > 0) {
            this.generationProgress = 100;
            this.generationStatus = 'Downloading...';

            const img = images[0];
            const imageUrl =
              `/api/image/view?filename=${encodeURIComponent(img.filename)}` +
              `&subfolder=${encodeURIComponent(img.subfolder ?? '')}&type=output`;

            const blobResponse = await fetch(imageUrl, { signal });
            if (!blobResponse.ok) throw new Error(`Failed to fetch image (${blobResponse.status})`);

            const blob = await blobResponse.blob();
            return URL.createObjectURL(blob);
          }
        }
      }

      this.generationProgress = Math.min(95, 10 + Math.round((attempt / MAX_POLL_ATTEMPTS) * 85));
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    throw new Error('Generation timed out — ComfyUI did not return a result.');
  }

  // ── Private: workflow builders ────────────────────────────────────────

  private _buildTxt2ImgWorkflow(options: {
    checkpoint: string;
    prompt: string;
    negative: string;
    steps: number;
    cfg: number;
    sampler: string;
    scheduler: string;
    seed: number;
    width: number;
    height: number;
  }): Record<string, unknown> {
    const { checkpoint, prompt, negative, steps, cfg, sampler, scheduler, seed, width, height } =
      options;
    const ckptName = checkpoint ? `${checkpoint}.safetensors` : 'sd_xl_base_1.0.safetensors';

    return {
      '3': { class_type: 'KSampler', inputs: { seed, steps, cfg, sampler_name: sampler, scheduler, denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckptName } },
      '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['4', 1] } },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
      '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'aikami-dev', images: ['8', 0] } },
    };
  }

  private _buildImg2ImgWorkflow(options: {
    checkpoint: string;
    imageName: string;
    prompt: string;
    negative: string;
    steps: number;
    cfg: number;
    sampler: string;
    scheduler: string;
    seed: number;
    denoise: number;
  }): Record<string, unknown> {
    const { checkpoint, imageName, prompt, negative, steps, cfg, sampler, scheduler, seed, denoise } =
      options;
    const ckptName = checkpoint ? `${checkpoint}.safetensors` : 'sd_xl_base_1.0.safetensors';

    return {
      '3': { class_type: 'KSampler', inputs: { seed, steps, cfg, sampler_name: sampler, scheduler, denoise, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['11', 0] } },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckptName } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['4', 1] } },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
      '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'aikami-dev', images: ['8', 0] } },
      '10': { class_type: 'LoadImage', inputs: { image: imageName } },
      '11': { class_type: 'VAEEncode', inputs: { pixels: ['10', 0], vae: ['4', 2] } },
    };
  }
}

export const getImageViewModel = (options: ImageViewModelOptions): ImageViewModelInterface =>
  new ImageViewModel(options);
