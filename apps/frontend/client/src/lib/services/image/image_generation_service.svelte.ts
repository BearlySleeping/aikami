// apps/frontend/client/src/lib/services/image/image_generation_service.svelte.ts
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { configService } from '$lib/services/config/config_service.svelte.ts';

/** Base URL of the local ComfyUI instance. */
const COMFY_BASE_URL = (import.meta.env.PUBLIC_IMAGE_URL ?? 'http://localhost:8188').replace(
  /\/+$/,
  '',
);

/** Descriptor for a ComfyUI checkpoint/model returned by the checkpoints endpoint. */
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

export type ImageGenerationServiceInterface = BaseFrontendClassInterface & {
  /** Available ComfyUI checkpoint models. */
  readonly checkpoints: readonly CheckpointInfo[];

  /** The currently selected checkpoint ID. */
  selectedCheckpoint: string;

  /**
   * Whether image generation is ready — checkpoints have been loaded
   * from a running ComfyUI instance and at least one is available.
   */
  get isReady(): boolean;

  /** Fetches the list of available checkpoints from the ComfyUI object_info API. */
  loadCheckpoints(): Promise<void>;

  /**
   * Generates an image via the ComfyUI REST API.
   * @param options - Configuration object.
   * @param options.prompt The description of the image to generate.
   * @param options.checkpoint Optional checkpoint ID to use (defaults to {@link selectedCheckpoint}).
   * @returns A promise that resolves to the image URL.
   */
  generateImage(options: { prompt: string; checkpoint?: string }): Promise<ImageGenerationResult>;

  /**
   * Checks if the service is running in demo mode.
   */
  isDemoMode(): boolean;
};

// ── ComfyUI API types (internal) ────────────────────────────────────────

type ComfyUiQueueResponse = {
  prompt_id: string;
  number: number;
  node_errors: Record<string, unknown>;
};

type ComfyUiHistoryEntry = {
  outputs: Record<
    string,
    { images: Array<{ filename: string; subfolder: string | null; type: string }> }
  >;
  status: { completed: boolean; messages: Array<[string, unknown]> };
};

type ComfyUiObjectInfo = Record<string, { input: { required: Record<string, Array<unknown>> } }>;

// ── Implementation ──────────────────────────────────────────────────────

export class ImageGenerationService
  extends BaseFrontendClass<ImageGenerationOptions>
  implements ImageGenerationServiceInterface
{
  private isDemo: boolean;
  private _baseUrl: string;

  constructor(options: ImageGenerationOptions) {
    super(options);
    this.isDemo = options.isDemo ?? false;
    this._baseUrl = COMFY_BASE_URL;
  }

  checkpoints: CheckpointInfo[] = $state([]);
  selectedCheckpoint = $state('');

  /** Whether image generation is ready to use. */
  get isReady(): boolean {
    // checkpoints loaded and selected → ready
    if (this.checkpoints.length > 0 && this.selectedCheckpoint.length > 0) {
      return true;
    }
    // Fallback: if a checkpoint was persisted in config, it was verified
    const persisted = this._readPersistedCheckpoint();
    return persisted.length > 0;
  }

  /** Reads the persisted checkpoint from ConfigService if available. */
  private _readPersistedCheckpoint(): string {
    return configService.state.image.checkpoint || '';
  }

  isDemoMode(): boolean {
    return this.isDemo;
  }

  async loadCheckpoints(): Promise<void> {
    if (this.isDemo) {
      this.debug('loadCheckpoints: demo mode - loading mock checkpoint');
      this.checkpoints = [{ id: 'sd_xl_base_1.0', description: 'SDXL Base 1.0 (Demo)' }];
      if (!this.selectedCheckpoint) {
        this.selectedCheckpoint = 'sd_xl_base_1.0';
      }
      return;
    }

    try {
      const response = await fetch(`${this._baseUrl}/object_info`);
      if (!response.ok) {
        this.error('loadCheckpoints:fetch-failed', { status: response.status });
        return;
      }

      const data = (await response.json()) as ComfyUiObjectInfo;
      const checkpointNode = data.CheckpointLoaderSimple;
      if (!checkpointNode?.input?.required?.ckpt_name) {
        this.warn('loadCheckpoints: no CheckpointLoaderSimple in object_info');
        return;
      }

      // ckpt_name is [["model1.safetensors", "model2.safetensors"]] — nested array
      const raw = checkpointNode.input.required.ckpt_name as unknown;
      const filenames: string[] = Array.isArray(raw) ? (Array.isArray(raw[0]) ? raw[0] : raw) : [];
      this.checkpoints = filenames.map((filename) => {
        const id = filename.replace(/\.safetensors$/, '');
        return { id, description: filename };
      });

      if (!this.selectedCheckpoint && this.checkpoints.length > 0) {
        // Restore persisted checkpoint if it matches an available one
        const persisted = configService.state.image.checkpoint;
        if (persisted && this.checkpoints.some((c) => c.id === persisted)) {
          this.selectedCheckpoint = persisted;
        } else {
          this.selectedCheckpoint = this.checkpoints[0].id;
        }
      }

      this.debug('loadCheckpoints', { count: this.checkpoints.length });
    } catch (error) {
      this.error('loadCheckpoints:failed', error);
    }
  }

  async generateImage(options: {
    prompt: string;
    checkpoint?: string;
  }): Promise<ImageGenerationResult> {
    const { prompt, checkpoint } = options;

    if (this.isDemo) {
      this.debug('generateImage: demo mode - returning mock image');
      return {
        url: `https://placehold.co/600x400?text=${encodeURIComponent(prompt.slice(0, 20))}`,
        isDemo: true,
      };
    }

    // Lazy-load checkpoints if not already fetched
    if (this.checkpoints.length === 0) {
      await this.loadCheckpoints();
    }

    // Compute effective checkpoint AFTER loadCheckpoints may have set selectedCheckpoint
    const effectiveCheckpoint = checkpoint ?? this.selectedCheckpoint;

    try {
      // Step 1 — queue the prompt
      const queueResponse = await this._post<ComfyUiQueueResponse>('/prompt', {
        client_id: `aikami-dev-${Date.now()}`,
        prompt: this._buildWorkflow({ prompt, checkpoint: effectiveCheckpoint }),
      });

      const promptId = queueResponse.prompt_id;
      this.debug('generateImage: queued', { promptId });

      // Step 2 — poll for result
      const imageRef = await this._pollForResult(promptId);

      // Step 3 — fetch the image blob to bypass CORP restrictions
      const imageUrl =
        `${this._baseUrl}/view?filename=${encodeURIComponent(imageRef.filename)}` +
        `&subfolder=${encodeURIComponent(imageRef.subfolder ?? '')}&type=output`;

      const blob = await this._fetchBlob(imageUrl);
      const objectUrl = URL.createObjectURL(blob);

      return { url: objectUrl, isDemo: false };
    } catch (error) {
      this.error('generateImage failed', error);
      throw error;
    }
  }

  // ── Private: Workflow builder ─────────────────────────────────────────

  /**
   * Builds a minimal ComfyUI workflow JSON with the given prompt and
   * optional checkpoint. Uses node IDs matching common defaults so the
   * workflow only needs the prompt text to change between generations.
   */
  private _buildWorkflow(options: {
    prompt: string;
    checkpoint?: string;
  }): Record<string, unknown> {
    const { prompt, checkpoint } = options;
    const checkpointId = (checkpoint && checkpoint.length > 0 ? checkpoint : undefined) ?? this.selectedCheckpoint;
    const ckptName = checkpointId ? `${checkpointId}.safetensors` : undefined;

    if (!ckptName) {
      throw new Error(
        'No checkpoint selected. Call loadCheckpoints() first or select a checkpoint.',
      );
    }

    return {
      '3': {
        class_type: 'KSampler',
        inputs: {
          seed: Math.floor(Math.random() * 2 ** 32),
          steps: 20,
          cfg: 7.0,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 1,
          model: ['4', 0],
          positive: ['6', 0],
          negative: ['7', 0],
          latent_image: ['5', 0],
        },
      },
      '4': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: ckptName },
      },
      '5': {
        class_type: 'EmptyLatentImage',
        inputs: { width: 512, height: 512, batch_size: 1 },
      },
      '6': {
        class_type: 'CLIPTextEncode',
        inputs: { text: prompt, clip: ['4', 1] },
      },
      '7': {
        class_type: 'CLIPTextEncode',
        inputs: { text: '', clip: ['4', 1] },
      },
      '8': {
        class_type: 'VAEDecode',
        inputs: { samples: ['3', 0], vae: ['4', 2] },
      },
      '9': {
        class_type: 'SaveImage',
        inputs: { filename_prefix: 'aikami-dev', images: ['8', 0] },
      },
    };
  }

  // ── Private: Polling ──────────────────────────────────────────────────

  /**
   * Polls ComfyUI's `/history/{promptId}` endpoint until the generation
   * completes and the image is available.
   */
  private async _pollForResult(
    promptId: string,
  ): Promise<{ filename: string; subfolder: string | null }> {
    const pollIntervalMs = 1000;
    const maxAttempts = 120; // 2 minutes max
    const controller = new AbortController();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await this._sleep(pollIntervalMs, controller.signal);

      try {
        const history = await this._get<ComfyUiHistoryEntry>(`/history/${promptId}`, controller);
        const outputs = history[promptId]?.outputs;

        if (outputs) {
          for (const nodeOutput of Object.values(outputs)) {
            if (nodeOutput.images && nodeOutput.images.length > 0) {
              controller.abort();
              const image = nodeOutput.images[0];
              return { filename: image.filename, subfolder: image.subfolder ?? null };
            }
          }
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          break;
        }
        this.warn('_pollForResult: history fetch failed', { attempt, error });
      }
    }

    this.warn('_pollForResult: timed out', { promptId });
    throw new Error('Image generation timed out — ComfyUI did not complete in time');
  }

  // ── Private: HTTP helpers ─────────────────────────────────────────────

  /**
   * Fetches a binary resource (image) as a Blob to bypass CORP restrictions.
   * Cross-origin images loaded via <img src> are blocked by CORP, but fetching
   * them as a Blob and creating an object URL avoids the check.
   */
  private async _fetchBlob(url: string): Promise<Blob> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image (${response.status})`);
    }
    return response.blob();
  }

  private async _post<TResponse>(path: string, body: unknown): Promise<TResponse> {
    const response = await fetch(`${this._baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`ComfyUI API error (${response.status}): ${text}`);
    }

    return response.json() as Promise<TResponse>;
  }

  private async _get<TResponse>(
    path: string,
    controller: AbortController,
  ): Promise<Record<string, TResponse>> {
    const response = await fetch(`${this._baseUrl}${path}`, {
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`ComfyUI error (${response.status})`);
    }

    return response.json() as Promise<Record<string, TResponse>>;
  }

  private _sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const id = setTimeout(resolve, ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(id);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true },
      );
    });
  }
}

export const imageGenerationService: ImageGenerationServiceInterface =
  ImageGenerationService.create({
    className: 'ImageGenerationService',
    isDemo: false,
  });
