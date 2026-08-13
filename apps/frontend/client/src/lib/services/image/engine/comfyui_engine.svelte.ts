// apps/frontend/client/src/lib/services/image/engine/comfyui_engine.svelte.ts
// biome-ignore-all lint/style/useNamingConvention: ComfyUI API uses snake_case fields
//
// ComfyUI engine adapter — the single surviving ComfyUI implementation.
// Collapses the four pre-C-388 copies (comfyui_client graph builder,
// image_generation_service _buildWorkflow, image_view_model and
// persona_create_view_model transports) into one ImageEngineClient.
//
// Contract: C-388 Image Engine Provider Abstraction

import { resolveImageBaseUrl } from './base_url.ts';
import type {
  ImageEngineCallbacks,
  ImageEngineCapabilities,
  ImageEngineClient,
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageModelInfo,
} from './types.ts';

/** Encoded-image payload cap — fail fast instead of stalling on huge uploads. */
const MAX_BASE64_PAYLOAD_BYTES = 25 * 1024 * 1024;

/** Poll interval when waiting for a generation. */
const POLL_INTERVAL_MS = 1000;

/** Maximum generation wait. */
const MAX_POLL_ATTEMPTS = 120;

/** Progress fraction when the job is queued. */
const QUEUED_FRACTION = 0.05;

/** Progress fraction when the job starts generating. */
const GENERATING_FRACTION = 0.1;

/** Progress fraction when the image is ready to download. */
const DOWNLOADING_FRACTION = 0.95;

/**
 * ComfyUI engine adapter.
 *
 * Talks the native ComfyUI HTTP API on the base URL (PUBLIC_IMAGE_URL,
 * default http://localhost:8188, or the Vite `/api/image` proxy in emulator):
 * - POST /prompt            → queue a workflow
 * - GET  /history/{id}      → poll for the output image
 * - GET  /view?filename=…   → fetch image bytes (bypasses CORP)
 * - POST /upload/image      → img2img source upload
 * - POST /interrupt         → cancellation
 *
 * Progress is derived from the poll cadence (ComfyUI's websocket is not
 * available through the Vite proxy) and pushed into onProgress so the
 * service layer stays engine-blind.
 */
export class ComfyUiEngine implements ImageEngineClient {
  readonly id = 'comfyui' as const;

  readonly capabilities: ImageEngineCapabilities = {
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

  private readonly _baseUrl: string;

  constructor(baseUrl?: string) {
    this._baseUrl = (baseUrl ?? resolveImageBaseUrl('comfyui')).replace(/\/+$/, '');
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this._baseUrl}/object_info`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<readonly ImageModelInfo[]> {
    const response = await fetch(`${this._baseUrl}/object_info`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error(`ComfyUI object_info failed (${response.status})`);
    }

    const data = (await response.json()) as Record<
      string,
      { input?: { required?: { ckpt_name?: unknown } } }
    >;
    const checkpointNode = data.CheckpointLoaderSimple;

    // ckpt_name is a NESTED array ([["a.safetensors", ...]]) — do not regress.
    const raw = checkpointNode?.input?.required?.ckpt_name;
    const filenames: string[] = Array.isArray(raw)
      ? Array.isArray(raw[0])
        ? (raw[0] as string[])
        : (raw as string[])
      : [];

    return filenames.map((filename) => ({
      id: filename.replace(/\.safetensors$/, ''),
      description: filename,
    }));
  }

  async generate(
    request: ImageGenerationRequest,
    callbacks?: ImageEngineCallbacks,
  ): Promise<ImageGenerationResult> {
    const { signal, onProgress } = callbacks ?? {};

    // ── Validate + sanitise request ────────────────────────────────────
    const sanitised = this._sanitiseRequest(request);

    // ── Resolve init image: inline base64 → ComfyUI upload → filename ──
    let initImageName: string | undefined;
    if (sanitised.initImage) {
      assertPayloadSize(sanitised.initImage);
      onProgress?.({ fraction: 0.02, label: 'Uploading image' });
      initImageName = await this._uploadImage(sanitised.initImage, signal);
    }

    const workflow = this._buildWorkflow({ ...sanitised, initImageName });

    onProgress?.({ fraction: QUEUED_FRACTION, label: 'Queuing' });

    // ── Queue ──────────────────────────────────────────────────────────
    const queueResponse = await this._post<{ prompt_id: string }>(
      '/prompt',
      { client_id: `aikami-${Date.now()}`, prompt: workflow },
      signal,
    );
    const promptId = queueResponse.prompt_id;

    onProgress?.({ fraction: GENERATING_FRACTION, label: 'Generating' });

    let polledResult: { filename: string; subfolder: string | null } | undefined;

    try {
      // ── Poll for the output image ──────────────────────────────────────
      const imageRef = await this._pollForResult(promptId, signal, onProgress);
      polledResult = imageRef;

      onProgress?.({ fraction: DOWNLOADING_FRACTION, label: 'Downloading' });

      // ── Fetch the image blob (bypasses CORP restrictions) ──────────────
      const imageUrl =
        `${this._baseUrl}/view?filename=${encodeURIComponent(imageRef.filename)}` +
        `&subfolder=${encodeURIComponent(imageRef.subfolder ?? '')}&type=output`;

      const blob = await this._fetchBlob(imageUrl, signal);

      onProgress?.({ fraction: 1, label: 'Complete' });

      return {
        blob,
        width: sanitised.width ?? 512,
        height: sanitised.height ?? 512,
        mimeType: blob.type || 'image/png',
      };
    } finally {
      // AC-6: abort issues ComfyUI's native cancel (POST /interrupt). Also
      // interrupt when polling ended by timeout so the GPU is not left busy.
      if (signal?.aborted || !polledResult) {
        void this._interrupt().catch(() => {});
      }
    }
  }

  // ── Private: request sanitisation ────────────────────────────────────

  /**
   * Strips fields the engine does not declare support for (AC-5) and drops
   * meaningless combinations (denoise without initImage).
   */
  private _sanitiseRequest(request: ImageGenerationRequest): ImageGenerationRequest {
    const sanitised: ImageGenerationRequest = {
      positivePrompt: request.positivePrompt,
      model: request.model,
      width: request.width,
      height: request.height,
      steps: request.steps,
      cfgScale: request.cfgScale,
      sampler: request.sampler,
    };

    if (request.negativePrompt && this.capabilities.negativePrompt) {
      sanitised.negativePrompt = request.negativePrompt;
    }
    if (request.seed !== undefined && this.capabilities.seed) {
      sanitised.seed = request.seed;
    }
    if (request.initImage && this.capabilities.initImage) {
      sanitised.initImage = request.initImage;
      // denoise is only meaningful with initImage — strip otherwise
      if (request.denoise !== undefined) {
        sanitised.denoise = request.denoise;
      }
    }
    // mask / referenceImages / controlNet / lora — capabilities are false,
    // so the fields never reach the wire.

    return sanitised;
  }

  // ── Private: workflow builder (the single surviving graph) ───────────

  private _buildWorkflow(options: {
    positivePrompt: string;
    negativePrompt?: string;
    model?: string;
    width?: number;
    height?: number;
    steps?: number;
    cfgScale?: number;
    seed?: number;
    sampler?: string;
    denoise?: number;
    initImageName?: string;
  }): Record<string, unknown> {
    const checkpointId = options.model || 'sd_xl_base_1.0';
    // Preserve the id when it already carries a recognized model extension;
    // append .safetensors only for bare ids (the ComfyUI default convention).
    const ckptName = /\.(?:safetensors|ckpt|sft|gguf)$/i.test(checkpointId)
      ? checkpointId
      : `${checkpointId}.safetensors`;

    const seed = options.seed ?? Math.floor(Math.random() * 2 ** 32);
    const steps = options.steps ?? 20;
    const cfg = options.cfgScale ?? 7.0;
    const sampler = options.sampler ?? 'euler';
    const width = options.width ?? 512;
    const height = options.height ?? 512;

    // img2img path: LoadImage → VAEEncode feeds the latent; txt2img path
    // uses EmptyLatentImage with denoise 1.
    const hasInitImage = Boolean(options.initImageName);
    const latentNodeId = hasInitImage ? '11' : '5';
    const denoise = hasInitImage ? (options.denoise ?? 0.5) : 1;

    const workflow: Record<string, unknown> = {
      '3': {
        class_type: 'KSampler',
        inputs: {
          seed,
          steps,
          cfg,
          sampler_name: sampler,
          scheduler: 'normal',
          denoise,
          model: ['4', 0],
          positive: ['6', 0],
          negative: ['7', 0],
          latent_image: [latentNodeId, 0],
        },
      },
      '4': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: ckptName },
      },
      '6': {
        class_type: 'CLIPTextEncode',
        inputs: { text: options.positivePrompt, clip: ['4', 1] },
      },
      '7': {
        class_type: 'CLIPTextEncode',
        inputs: { text: options.negativePrompt ?? '', clip: ['4', 1] },
      },
      '8': {
        class_type: 'VAEDecode',
        inputs: { samples: ['3', 0], vae: ['4', 2] },
      },
      '9': {
        class_type: 'SaveImage',
        inputs: { filename_prefix: 'aikami-gen', images: ['8', 0] },
      },
    };

    if (hasInitImage) {
      workflow['10'] = { class_type: 'LoadImage', inputs: { image: options.initImageName } };
      workflow['11'] = {
        class_type: 'VAEEncode',
        inputs: { pixels: ['10', 0], vae: ['4', 2] },
      };
    } else {
      workflow['5'] = {
        class_type: 'EmptyLatentImage',
        inputs: { width, height, batch_size: 1 },
      };
    }

    return workflow;
  }

  // ── Private: transport ───────────────────────────────────────────────

  private async _uploadImage(dataUrl: string, signal?: AbortSignal): Promise<string> {
    const blob = dataUrlToBlob(dataUrl);

    const formData = new FormData();
    formData.append('image', blob, 'input.png');

    const response = await fetch(`${this._baseUrl}/upload/image`, {
      method: 'POST',
      body: formData,
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`ComfyUI upload failed (${response.status}): ${text.slice(0, 200)}`);
    }

    const result = (await response.json()) as { name?: string };
    if (!result.name) {
      throw new Error('ComfyUI upload returned no image name');
    }
    return result.name;
  }

  private async _pollForResult(
    promptId: string,
    signal: AbortSignal | undefined,
    onProgress?: (progress: { fraction: number; label: string }) => void,
  ): Promise<{ filename: string; subfolder: string | null }> {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      assertNotAborted(signal);

      await sleep(POLL_INTERVAL_MS, signal);

      // Linear progress ramp from GENERATING (0.1) to DOWNLOADING (0.95)
      const fraction = Math.min(
        DOWNLOADING_FRACTION,
        GENERATING_FRACTION + (attempt / MAX_POLL_ATTEMPTS) * 0.85,
      );
      onProgress?.({ fraction, label: 'Generating' });

      try {
        const history = await this._get<Record<string, ComfyUiHistoryEntry>>(
          `/history/${promptId}`,
          signal,
        );
        const entry = history[promptId];

        // Fail fast when ComfyUI reports the job failed instead of spinning
        // until the poll budget expires.
        if (entry?.status && !entry.status.completed) {
          const messages = entry.status.messages ?? [];
          const errorText = messages
            .filter((m) => m[0] === 'execution_error' || m[0] === 'execution_interrupted')
            .map((m) => String(m[1] ?? ''))
            .filter(Boolean)
            .join('; ');
          throw new Error(
            `ComfyUI generation failed: ${errorText || 'workflow reported failure'}`,
          );
        }

        const outputs = entry?.outputs;

        if (outputs) {
          for (const nodeOutput of Object.values(outputs)) {
            if (nodeOutput.images && nodeOutput.images.length > 0) {
              const image = nodeOutput.images[0];
              return { filename: image.filename, subfolder: image.subfolder ?? null };
            }
          }
        }
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        if (error instanceof Error && error.message.startsWith('ComfyUI generation failed')) {
          throw error;
        }
        // transient poll failure — keep trying
      }
    }

    throw new Error('Image generation timed out — ComfyUI did not complete in time');
  }

  /** Issues ComfyUI's native cancel (AC-6). Fire-and-forget on abort. */
  private async _interrupt(): Promise<void> {
    await fetch(`${this._baseUrl}/interrupt`, { method: 'POST' });
  }

  private async _post<TResponse>(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<TResponse> {
    const response = await fetch(`${this._baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`ComfyUI API error (${response.status}): ${text.slice(0, 200)}`);
    }

    return response.json() as Promise<TResponse>;
  }

  private async _get<TResponse>(path: string, signal?: AbortSignal): Promise<TResponse> {
    const response = await fetch(`${this._baseUrl}${path}`, {
      method: 'GET',
      signal,
    });

    if (!response.ok) {
      throw new Error(`ComfyUI error (${response.status})`);
    }

    return response.json() as Promise<TResponse>;
  }

  private async _fetchBlob(url: string, signal?: AbortSignal): Promise<Blob> {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch image (${response.status})`);
    }
    return response.blob();
  }
}

// ---------------------------------------------------------------------------
// ComfyUI API types (internal)
// ---------------------------------------------------------------------------

type ComfyUiHistoryEntry = {
  outputs: Record<
    string,
    { images: Array<{ filename: string; subfolder: string | null; type: string }> }
  >;
  status: { completed: boolean; messages: Array<[string, unknown]> };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const assertPayloadSize = (dataUrl: string): void => {
  if (dataUrl.length > MAX_BASE64_PAYLOAD_BYTES) {
    throw new Error(
      `Image payload too large (${(dataUrl.length / 1024 / 1024).toFixed(1)} MB) — cap is ${MAX_BASE64_PAYLOAD_BYTES / 1024 / 1024} MB`,
    );
  }
};

const dataUrlToBlob = (dataUrl: string): Blob => {
  const [meta, base64] = dataUrl.split(',');
  const mime = /data:(.*?)(?:;|$)/.exec(meta)?.[1] ?? 'image/png';

  // Safari/older browsers lack atob-free binary conversion; fetch() of a
  // data URL is the most portable path in the browser.
  return new Blob([base64ToBytes(base64)], { type: mime });
};

const base64ToBytes = (base64: string): Uint8Array => {
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  // Bun test environment — no atob.
  return new Uint8Array(Buffer.from(base64, 'base64'));
};

const assertNotAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
};

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === 'AbortError'
    : (error as Error)?.name === 'AbortError';

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
