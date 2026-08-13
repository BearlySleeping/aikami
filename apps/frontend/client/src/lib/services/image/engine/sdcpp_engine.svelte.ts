// apps/frontend/client/src/lib/services/image/engine/sdcpp_engine.svelte.ts
// biome-ignore-all lint/style/useNamingConvention: sd-server API uses snake_case fields
//
// sd-server (stable-diffusion.cpp) engine adapter — the bundled default
// image engine per C-388/C-390. Talks the native /sdcpp/v1 family so async
// job polling and cancellation map onto the generationProgress /
// generationStatus surface.
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

/** Maximum generation wait (bounded so a dead engine cannot hang forever). */
const MAX_POLL_ATTEMPTS = 180;

/** Max time to wait for a job slot (sd-server is single-slot). */
const QUEUE_WAIT_MS = 120_000;

/** Job states reported by GET /sdcpp/v1/jobs/{id}. */
type SdCppJobState = 'queued' | 'generating' | 'completed' | 'failed' | 'cancelled';

type SdCppJob = {
  id?: string;
  state?: SdCppJobState;
  status?: SdCppJobState;
  progress?: number;
  width?: number;
  height?: number;
  image?: string;
  images?: readonly unknown[];
  data?: readonly { b64_json?: string; url?: string; image?: string }[];
  message?: string;
  error?: string;
};

/**
 * sd-server engine adapter.
 *
 * Base URL: resolved from the runtime config chain (C-389) —
 * localStorage → Tauri file → ./config.json → dev-only PUBLIC_IMAGE_URL
 * default, or the Vite `/api/image` proxy in emulator. Both engines bind
 * 8188 mutually exclusively per C-390; no baked-in localhost literal
 * (C-389 AC-1) — an unconfigured engine reports unavailable.
 *
 * Transport:
 * - POST /sdcpp/v1/img_gen   → create a job (returns job id)
 * - GET  /sdcpp/v1/jobs/{id} → poll state (queued/generating/completed/…)
 * - POST /sdcpp/v1/jobs/{id}/cancel → cancellation
 * - GET  /sdapi/v1/sd-models → model listing (A1111-compatible layer)
 *
 * The job response carries the image data inline — no second fetch hop.
 */
export class SdCppEngine implements ImageEngineClient {
  readonly id = 'sdcpp' as const;

  readonly capabilities: ImageEngineCapabilities = {
    negativePrompt: true,
    seed: true,
    sampler: true,
    initImage: true,
    mask: true,
    referenceImages: true,
    controlNet: true,
    lora: true,
    cancel: true,
    progress: true,
  };

  private readonly _baseUrl: string;

  /** Single-slot queue guard — sd-server processes one job at a time. */
  private _inFlight = false;

  constructor(baseUrl?: string) {
    this._baseUrl = (baseUrl ?? resolveImageBaseUrl('sdcpp'))?.replace(/\/+$/, '') ?? '';
  }

  async healthCheck(): Promise<boolean> {
    if (!this._baseUrl) {
      return false; // C-389: no engine configured — never probe a hardcoded host
    }
    try {
      const response = await fetch(`${this._baseUrl}/sdapi/v1/sd-models`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<readonly ImageModelInfo[]> {
    if (!this._baseUrl) {
      throw new Error('Image engine is not configured (image.url missing from config.json)');
    }
    const response = await fetch(`${this._baseUrl}/sdapi/v1/sd-models`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error(`sd-server sd-models failed (${response.status})`);
    }

    const data = (await response.json()) as Array<{ title?: string; model_name?: string }>;
    return data.map((entry) => ({
      id: entry.model_name ?? entry.title ?? 'unknown',
      description: entry.title ?? entry.model_name ?? 'unknown',
    }));
  }

  async generate(
    request: ImageGenerationRequest,
    callbacks?: ImageEngineCallbacks,
  ): Promise<ImageGenerationResult> {
    const { signal, onProgress } = callbacks ?? {};

    if (!this._baseUrl) {
      throw new Error('Image engine is not configured (image.url missing from config.json)');
    }

    if (this._inFlight) {
      throw new Error(
        'sd-server is single-slot — another generation is already running. Wait for it to finish.',
      );
    }
    this._inFlight = true;

    try {
      assertNotAborted(signal);

      const sanitised = this._sanitiseRequest(request);

      if (sanitised.initImage) {
        assertPayloadSize(sanitised.initImage);
      }
      for (const ref of sanitised.referenceImages ?? []) {
        assertPayloadSize(ref);
      }
      if (sanitised.mask) {
        assertPayloadSize(sanitised.mask);
      }

      onProgress?.({ fraction: 0.02, label: 'Queuing' });

      // ── Create the job ────────────────────────────────────────────────
      const body = this._buildRequestBody(sanitised);
      const job = await this._post<SdCppJob>('/sdcpp/v1/img_gen', body, signal);
      const jobId = this._extractJobId(job);
      if (!jobId) {
        // Some builds return the image inline instead of a job id — use it.
        const inline = this._extractInlineImage(job);
        if (inline) {
          onProgress?.({ fraction: 1, label: 'Complete' });
          return this._imageResult(inline, sanitised);
        }
        throw new Error('sd-server did not return a job id or image');
      }

      try {
        // ── Poll until terminal ───────────────────────────────────────────
        const jobResult = await this._pollJob(jobId, signal, onProgress);

        onProgress?.({ fraction: 1, label: 'Complete' });

        return this._imageResult(jobResult, sanitised);
      } finally {
        // AC-6: abort issues sd-server's native cancel endpoint.
        if (signal?.aborted) {
          void this._cancelJob(jobId).catch(() => {});
        }
      }
    } finally {
      this._inFlight = false;
    }
  }

  // ── Private: request sanitisation ────────────────────────────────────

  /**
   * Strips fields the engine does not declare support for (AC-5) and drops
   * meaningless combinations (denoise/mask without initImage).
   */
  private _sanitiseRequest(request: ImageGenerationRequest): ImageGenerationRequest {
    const sanitised: ImageGenerationRequest = {
      positivePrompt: request.positivePrompt,
      model: request.model,
      width: request.width,
      height: request.height,
      steps: request.steps,
      cfgScale: request.cfgScale,
    };

    if (request.negativePrompt && this.capabilities.negativePrompt) {
      sanitised.negativePrompt = request.negativePrompt;
    }
    if (request.seed !== undefined && this.capabilities.seed) {
      sanitised.seed = request.seed;
    }
    if (request.sampler && this.capabilities.sampler) {
      sanitised.sampler = request.sampler;
    }
    if (request.initImage && this.capabilities.initImage) {
      sanitised.initImage = request.initImage;
      if (request.denoise !== undefined) {
        sanitised.denoise = request.denoise;
      }
      // mask is only meaningful with an init image (inpainting)
      if (request.mask && this.capabilities.mask) {
        sanitised.mask = request.mask;
      }
    }
    if (
      request.referenceImages &&
      request.referenceImages.length > 0 &&
      this.capabilities.referenceImages
    ) {
      sanitised.referenceImages = request.referenceImages;
    }
    if (request.loras && request.loras.length > 0 && this.capabilities.lora) {
      sanitised.loras = request.loras;
    }
    // controlNet has no dedicated field in this request type — the sd-server
    // API accepts control_image, which is out of the current scope.

    return sanitised;
  }

  // ── Private: request body builder ────────────────────────────────────

  private _buildRequestBody(request: ImageGenerationRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      prompt: request.positivePrompt,
      width: request.width ?? 512,
      height: request.height ?? 512,
      sample_steps: request.steps ?? 20,
      txt_cfg: request.cfgScale ?? 7.0,
      seed: request.seed ?? Math.floor(Math.random() * 2 ** 32),
      batch_count: 1,
    };

    if (request.negativePrompt) {
      body.negative_prompt = request.negativePrompt;
    }
    if (request.sampler) {
      body.sample_method = request.sampler;
    }
    if (request.model) {
      body.model = request.model;
    }
    if (request.initImage) {
      body.init_image = request.initImage;
      if (request.denoise !== undefined) {
        body.denoise = request.denoise;
      }
      if (request.mask) {
        body.mask = request.mask;
      }
    }
    if (request.referenceImages && request.referenceImages.length > 0) {
      body.ref_images = request.referenceImages;
    }
    if (request.loras && request.loras.length > 0) {
      body.lora = request.loras.map((lora) => ({
        path: lora.path,
        multiplier: lora.multiplier,
      }));
    }

    return body;
  }

  // ── Private: polling ─────────────────────────────────────────────────

  private async _pollJob(
    jobId: string,
    signal: AbortSignal | undefined,
    onProgress?: (progress: { fraction: number; label: string }) => void,
  ): Promise<SdCppJob> {
    const startTime = Date.now();
    let attempt = 0;

    while (true) {
      assertNotAborted(signal);

      // First request fires immediately; sleep only between subsequent polls.
      if (attempt > 0) {
        await sleep(POLL_INTERVAL_MS, signal);
      }

      let job: SdCppJob;
      try {
        job = await this._get<SdCppJob>(`/sdcpp/v1/jobs/${jobId}`, signal);
      } catch (error) {
        // Request timeout (not caller abort) means the server job may still
        // be running — cancel it so the GPU is not left busy.
        if (isTimeoutError(error)) {
          void this._cancelJob(jobId).catch(() => {});
        }
        throw error;
      }
      const state = job.state ?? job.status ?? 'queued';

      if (state === 'completed') {
        return job;
      }
      if (state === 'failed' || state === 'cancelled') {
        throw new Error(`sd-server job ${state}: ${job.message ?? job.error ?? ''}`.trim());
      }

      // Progress: prefer the server's number when available (0..100),
      // otherwise ramp within the generating band.
      const fraction =
        typeof job.progress === 'number'
          ? Math.min(0.95, Math.max(0.1, job.progress / 100))
          : Math.min(0.95, 0.1 + (attempt / MAX_POLL_ATTEMPTS) * 0.85);
      onProgress?.({ fraction, label: state === 'queued' ? 'Queuing' : 'Generating' });

      // Bound the total wait by wall clock — a dead engine must not hang.
      if (Date.now() - startTime >= QUEUE_WAIT_MS) {
        break;
      }
      attempt++;
    }

    throw new Error('Image generation timed out — sd-server did not complete in time');
  }

  // ── Private: result extraction ───────────────────────────────────────

  private _imageResult(job: SdCppJob, request: ImageGenerationRequest): ImageGenerationResult {
    const imageData = this._extractInlineImage(job);
    if (!imageData) {
      throw new Error('sd-server job completed without returning an image');
    }

    const blob = imageDataToBlob(imageData);
    return {
      blob,
      // Prefer the dimensions reported by the job payload; fall back to the
      // requested dimensions (then 512) only when the job omits them.
      width: job.width ?? request.width ?? 512,
      height: job.height ?? request.height ?? 512,
      mimeType: blob.type || 'image/png',
    };
  }

  /**
   * Recursively finds an inline image payload (data URL, base64, or URL).
   * sd-server returns image data inline — never add a second fetch hop.
   */
  private _extractInlineImage(payload: unknown): string | undefined {
    if (typeof payload === 'string') {
      // Every string must pass image validation — non-image strings such as
      // "queued" are ignored so the caller can produce a missing-image error.
      return isImageString(payload) ? payload : undefined;
    }
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }

    const obj = payload as Record<string, unknown>;

    // OpenAI-style `data: [{ b64_json }]` or A1111 `images: ["..."]`
    if (Array.isArray(obj.data)) {
      for (const item of obj.data) {
        const found = this._extractInlineImage(item);
        if (found) {
          return found;
        }
      }
    }
    if (Array.isArray(obj.images)) {
      for (const item of obj.images) {
        const found = this._extractInlineImage(item);
        if (found) {
          return found;
        }
      }
    }

    for (const key of ['image', 'b64_json', 'output', 'result']) {
      const value = obj[key];
      const found = this._extractInlineImage(value);
      if (found) {
        return found;
      }
    }

    return undefined;
  }

  private _extractJobId(payload: SdCppJob): string | undefined {
    const id = payload.id;
    if (typeof id === 'string' && id.length > 0) {
      return id;
    }
    // Some builds nest the job id.
    const nested = (payload as Record<string, unknown>).job;
    if (nested && typeof nested === 'object') {
      const nestedId = (nested as Record<string, unknown>).id;
      if (typeof nestedId === 'string') {
        return nestedId;
      }
    }
    return undefined;
  }

  /** Issues sd-server's native job cancel (AC-6). Fire-and-forget on abort. */
  private async _cancelJob(jobId: string): Promise<void> {
    await this._post(`/sdcpp/v1/jobs/${jobId}/cancel`, {}, undefined);
  }

  // ── Private: transport ───────────────────────────────────────────────

  private async _post<TResponse>(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<TResponse> {
    const response = await fetch(`${this._baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: withRequestTimeout(signal),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`sd-server API error (${response.status}): ${text.slice(0, 200)}`);
    }

    return response.json() as Promise<TResponse>;
  }

  private async _get<TResponse>(path: string, signal?: AbortSignal): Promise<TResponse> {
    const response = await fetch(`${this._baseUrl}${path}`, {
      method: 'GET',
      signal: withRequestTimeout(signal),
    });

    if (!response.ok) {
      throw new Error(`sd-server error (${response.status})`);
    }

    return response.json() as Promise<TResponse>;
  }
}

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

const isBase64Like = (value: string): boolean => {
  if (value.length === 0 || value.includes(' ')) {
    return false;
  }
  // A generous heuristic — sd-server returns raw base64 PNGs.
  return /^[A-Za-z0-9+/]+=*$/.test(value.slice(0, 4096));
};

/** True when a string looks like inline image data (data URL or base64). */
const MIN_IMAGE_STRING_LENGTH = 64;

const isImageString = (value: string): boolean => {
  if (value.startsWith('data:')) {
    return true;
  }
  // Raw base64 must be long enough to be real image bytes — short state
  // strings such as "queued" must not be mistaken for image data.
  return isBase64Like(value) && value.length >= MIN_IMAGE_STRING_LENGTH;
};

/** Per-request timeout — a hung sd-server must not stall a fetch forever. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Combines the caller signal with a hard per-request timeout. Caller
 * cancellation is preserved via AbortSignal.any (AbortError), while a
 * timeout aborts with TimeoutError so the poll loop can distinguish them.
 */
const withRequestTimeout = (signal?: AbortSignal): AbortSignal =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS);

const isTimeoutError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === 'TimeoutError'
    : (error as Error)?.name === 'TimeoutError';

const imageDataToBlob = (imageData: string): Blob => {
  if (imageData.startsWith('data:')) {
    const [meta, base64] = imageData.split(',');
    const mime = /data:(.*?)(?:;|$)/.exec(meta)?.[1] ?? 'image/png';
    return new Blob([base64ToBytes(base64 ?? '')], { type: mime });
  }
  // Raw base64 (A1111 `images: [...]`) — assume PNG.
  return new Blob([base64ToBytes(imageData)], { type: 'image/png' });
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
  return new Uint8Array(Buffer.from(base64, 'base64'));
};

const assertNotAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
};

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
