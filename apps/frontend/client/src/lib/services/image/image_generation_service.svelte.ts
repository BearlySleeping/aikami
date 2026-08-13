// apps/frontend/client/src/lib/services/image/image_generation_service.svelte.ts
//
// Image generation service — thin reactive wrapper over the image engine
// abstraction (C-388). Preserves the pre-C-388 public surface
// (checkpoints / selectedCheckpoint / isReady / loadCheckpoints /
// generateImage / isDemoMode / isGenerating / generationProgress /
// generationStatus) while delegating all transport to the active
// ImageEngineClient (ComfyUI or sd-server).
//
// Contract: C-388 Image Engine Provider Abstraction

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { ImageEngineId } from '@aikami/types';
import { configService } from '$services';
import {
  getConfiguredImageEngineId,
  resetImageEngineCache,
  resolveImageEngine,
  setImageEngineOverride,
} from './engine/image_engine_factory.svelte.ts';
import type {
  ImageEngineCapabilities,
  ImageEngineClient,
  ImageGenerationRequest,
  ImageProgress,
  ResolvedImageEngineId,
} from './engine/types.ts';

/** Descriptor for a checkpoint/model returned by the model listing. */
export type CheckpointInfo = {
  readonly id: string;
  readonly description: string;
};

export type ImageGenerationOptions = BaseFrontendClassOptions & {
  /** If true, the service operates in demo mode (mock data, no real API calls). */
  isDemo: boolean;
};

export type ImageGenerationResult = {
  url: string;
  isDemo: boolean;
};

/** Extended options for generateImage — superset of the old { prompt, checkpoint }. */
export type GenerateImageOptions = {
  prompt: string;
  negativePrompt?: string;
  checkpoint?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  seed?: number;
  sampler?: string;
  initImage?: string;
  denoise?: number;
  mask?: string;
  signal?: AbortSignal;
};

export type ImageGenerationServiceInterface = BaseFrontendClassInterface & {
  /** Available checkpoint models from the active engine. */
  readonly checkpoints: readonly CheckpointInfo[];

  /** The currently selected checkpoint ID. */
  selectedCheckpoint: string;

  /**
   * Whether image generation is ready — an engine is reachable and a
   * checkpoint is available.
   */
  get isReady(): boolean;

  /** The resolved engine id ('comfyui' | 'sdcpp'), or undefined pre-detection. */
  get engineId(): ResolvedImageEngineId | undefined;

  /** Capability flags of the active engine. */
  get capabilities(): ImageEngineCapabilities | undefined;

  /** Whether auto-detection is configured (PUBLIC_IMAGE_ENGINE=auto). */
  get isAutoDetect(): boolean;

  /** Fetches the list of available models from the active engine. */
  loadCheckpoints(): Promise<void>;

  /** Forces re-detection of the engine (dev sandbox engine toggle). */
  refreshEngine(): Promise<void>;

  /** Sets a runtime engine override (dev sandbox engine selector). */
  setEngine(engine: ImageEngineId): Promise<void>;

  /**
   * Generates an image via the active engine.
   * @param options - Generation options (prompt, negative prompt, params).
   * @returns A promise that resolves to the image URL.
   */
  generateImage(options: GenerateImageOptions): Promise<ImageGenerationResult>;

  /** Whether the service is running in demo mode. */
  isDemoMode(): boolean;

  /** Whether an image generation is currently in progress. */
  readonly isGenerating: boolean;

  /** Progress of the current generation (0-100). */
  readonly generationProgress: number;

  /** Human-readable status label for the current generation step. */
  readonly generationStatus: string;

  /** Cancels the in-flight generation (issues the engine's native cancel). */
  cancel(): void;
};

// ── Per-engine checkpoint storage keys (C-388 Migration) ──────────────

const CHECKPOINT_KEY_PREFIX = 'imageCheckpoint:';

const _readNamespacedCheckpoint = (engineId: ResolvedImageEngineId): string => {
  try {
    return localStorage.getItem(`${CHECKPOINT_KEY_PREFIX}${engineId}`) ?? '';
  } catch {
    return '';
  }
};

const _writeNamespacedCheckpoint = (engineId: ResolvedImageEngineId, id: string): void => {
  try {
    localStorage.setItem(`${CHECKPOINT_KEY_PREFIX}${engineId}`, id);
  } catch {
    // storage may be unavailable (SSR/tests) — persistence is best-effort
  }
};

// ── Implementation ──────────────────────────────────────────────────────

export class ImageGenerationService
  extends BaseFrontendClass<ImageGenerationOptions>
  implements ImageGenerationServiceInterface
{
  private isDemo: boolean;
  // $state — the view reads `engineId`/`capabilities` getters in templates;
  // a plain field would never invalidate after async engine detection.
  private _engine = $state<ImageEngineClient | undefined>(undefined);

  constructor(options: ImageGenerationOptions) {
    super(options);
    this.isDemo = options.isDemo ?? false;
  }

  checkpoints: CheckpointInfo[] = $state([]);
  private _selectedCheckpoint = $state('');
  private _isGenerating = $state(false);
  private _generationProgress = $state(0);
  private _generationStatus = $state('');

  /** Whether an image generation is currently in progress. */
  get isGenerating(): boolean {
    return this._isGenerating;
  }

  /** Progress of the current generation (0-100). */
  get generationProgress(): number {
    return this._generationProgress;
  }

  /** Human-readable status label for the current generation step. */
  get generationStatus(): string {
    return this._generationStatus;
  }

  /** The currently selected checkpoint ID. */
  get selectedCheckpoint(): string {
    return this._selectedCheckpoint;
  }

  set selectedCheckpoint(value: string) {
    this._selectedCheckpoint = value;
    this._persistSelectedCheckpoint(value);
  }

  get engineId(): ResolvedImageEngineId | undefined {
    return this._engine?.id;
  }

  get capabilities(): ImageEngineCapabilities | undefined {
    return this._engine?.capabilities;
  }

  get isAutoDetect(): boolean {
    return getConfiguredImageEngineId() === 'auto';
  }

  /** Whether image generation is ready to use. */
  get isReady(): boolean {
    if (this.isDemo) {
      return true;
    }
    // An engine must be resolved (auto-detected or configured) AND a
    // checkpoint must be loaded + selected.
    if (!this._engine) {
      return false;
    }
    if (this.checkpoints.length === 0 || this._selectedCheckpoint.length === 0) {
      return false;
    }
    return true;
  }

  isDemoMode(): boolean {
    return this.isDemo;
  }

  /**
   * Loads the model list from the active engine and restores the persisted
   * per-engine checkpoint (with legacy-key migration for ComfyUI).
   */
  async loadCheckpoints(): Promise<void> {
    if (this.isDemo) {
      this.debug('loadCheckpoints: demo mode - loading mock checkpoint');
      this.checkpoints = [{ id: 'sd_xl_base_1.0', description: 'SDXL Base 1.0 (Demo)' }];
      if (!this.selectedCheckpoint) {
        this.selectedCheckpoint = 'sd_xl_base_1.0';
      }
      return;
    }

    const engine = await this._getEngine();
    if (!engine) {
      this.warn('loadCheckpoints: no engine available');
      this.checkpoints = [];
      return;
    }

    try {
      const models = await engine.listModels();
      this.checkpoints = models.map((model) => ({
        id: model.id,
        description: model.description,
      }));

      const persisted = this._readPersistedCheckpoint(engine.id);
      if (persisted && this.checkpoints.some((c) => c.id === persisted)) {
        this.selectedCheckpoint = persisted;
      } else if (!this.selectedCheckpoint && this.checkpoints.length > 0) {
        this.selectedCheckpoint = this.checkpoints[0].id;
      }

      this.debug('loadCheckpoints', {
        engine: engine.id,
        count: this.checkpoints.length,
      });
    } catch (error) {
      this.error('loadCheckpoints:failed', error);
      this.checkpoints = [];
    }
  }

  /** Forces re-detection of the engine (dev sandbox engine toggle). */
  async refreshEngine(): Promise<void> {
    resetImageEngineCache();
    this._engine = undefined;
    this.checkpoints = [];
    await this._getEngine();
    await this.loadCheckpoints();
  }

  /**
   * Sets a runtime engine override (dev sandbox engine selector).
   * @param engine — Engine id, or 'auto' to return to config + detection.
   */
  async setEngine(engine: ImageEngineId): Promise<void> {
    setImageEngineOverride(engine);
    await this.refreshEngine();
  }

  async generateImage(options: GenerateImageOptions): Promise<ImageGenerationResult> {
    const {
      prompt,
      negativePrompt,
      checkpoint,
      width,
      height,
      steps,
      cfgScale,
      seed,
      sampler,
      initImage,
      denoise,
      mask,
      signal,
    } = options;

    if (this.isDemo) {
      this.debug('generateImage: demo mode - returning mock image');
      return {
        url: `https://placehold.co/600x400?text=${encodeURIComponent(prompt.slice(0, 20))}`,
        isDemo: true,
      };
    }

    // Reset progress state
    this._isGenerating = true;
    this._generationProgress = 0;
    this._generationStatus = 'Queuing';

    // Lazy-load checkpoints if not already fetched
    if (this.checkpoints.length === 0) {
      await this.loadCheckpoints();
    }

    const engine = await this._getEngine();
    if (!engine) {
      this._isGenerating = false;
      this._generationStatus = 'Failed';
      throw new Error('No image engine available — is ComfyUI or sd-server running?');
    }

    const effectiveCheckpoint = checkpoint ?? this.selectedCheckpoint;
    const request: ImageGenerationRequest = {
      positivePrompt: prompt,
      model: effectiveCheckpoint || undefined,
    };
    if (negativePrompt) {
      request.negativePrompt = negativePrompt;
    }
    if (width !== undefined) {
      request.width = width;
    }
    if (height !== undefined) {
      request.height = height;
    }
    if (steps !== undefined) {
      request.steps = steps;
    }
    if (cfgScale !== undefined) {
      request.cfgScale = cfgScale;
    }
    if (seed !== undefined) {
      request.seed = seed;
    }
    if (sampler) {
      request.sampler = sampler;
    }
    if (initImage) {
      request.initImage = initImage;
    }
    if (denoise !== undefined) {
      request.denoise = denoise;
    }
    if (mask) {
      request.mask = mask;
    }

    const abortController = new AbortController();
    const onExternalAbort = (): void => abortController.abort();
    if (signal) {
      if (signal.aborted) {
        abortController.abort();
      } else {
        signal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }
    this._abortController = abortController;

    const startedAt = performance.now();

    try {
      const result = await engine.generate(request, {
        signal: abortController.signal,
        onProgress: (progress: ImageProgress) => this._applyProgress(progress),
      });

      this.debug('image-generation:done', {
        engine: engine.id,
        model: effectiveCheckpoint,
        durationMs: Math.round(performance.now() - startedAt),
      });

      const objectUrl = URL.createObjectURL(result.blob);
      this._generationProgress = 100;
      this._generationStatus = 'Complete';

      return { url: objectUrl, isDemo: false };
    } catch (error) {
      this._generationStatus = 'Failed';
      if (isAbortError(error)) {
        this.debug('generateImage:aborted', { engine: engine.id });
      } else {
        this.error('generateImage failed', error);
      }
      throw error;
    } finally {
      this._isGenerating = false;
      this._abortController = undefined;
      if (signal) {
        signal.removeEventListener('abort', onExternalAbort);
      }
      // Reset progress after a brief delay so the consumer can read the terminal state
      setTimeout(() => {
        this._generationProgress = 0;
        this._generationStatus = '';
      }, 2000);
    }
  }

  cancel(): void {
    this._abortController?.abort();
    this._abortController = undefined;
    this._isGenerating = false;
    this._generationProgress = 0;
    this._generationStatus = '';
  }

  // ── Private: engine resolution ───────────────────────────────────────

  private async _getEngine(): Promise<ImageEngineClient | undefined> {
    if (this._engine) {
      return this._engine;
    }
    this._engine = await resolveImageEngine();
    return this._engine;
  }

  // ── Private: progress mapping ────────────────────────────────────────

  private _applyProgress(progress: ImageProgress): void {
    this._generationProgress = Math.round(Math.max(0, Math.min(1, progress.fraction)) * 100);
    this._generationStatus = progress.label;
  }

  // ── Private: per-engine checkpoint persistence (C-388 Migration) ────

  private _persistSelectedCheckpoint(id: string): void {
    const engineId = this._engine?.id;
    if (!engineId) {
      return;
    }
    _writeNamespacedCheckpoint(engineId, id);
  }

  private _readPersistedCheckpoint(engineId: ResolvedImageEngineId): string {
    const namespaced = _readNamespacedCheckpoint(engineId);
    if (namespaced) {
      return namespaced;
    }

    // Migration: the legacy unnamespaced key (configService.state.image.checkpoint)
    // is the ComfyUI value on first read — migrate it forward.
    if (engineId === 'comfyui') {
      const legacy = this._readLegacyCheckpoint();
      if (legacy) {
        _writeNamespacedCheckpoint('comfyui', legacy);
        return legacy;
      }
    }
    return '';
  }

  /** Reads the legacy checkpoint from ConfigService if available. */
  private _readLegacyCheckpoint(): string {
    try {
      return configService.state.image.checkpoint || '';
    } catch {
      return '';
    }
  }

  private _abortController: AbortController | undefined;
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const imageGenerationService: ImageGenerationServiceInterface =
  ImageGenerationService.create({
    className: 'ImageGenerationService',
    isDemo: false,
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === 'AbortError'
    : (error as Error)?.name === 'AbortError';
