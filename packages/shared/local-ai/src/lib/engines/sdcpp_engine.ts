// packages/shared/local-ai/src/lib/engines/sdcpp_engine.ts
// biome-ignore-all lint/style/useNamingConvention: sd-server API uses snake_case fields
//
// sd-server (stable-diffusion.cpp) generation transport — THE single
// implementation of the `/sdcpp/v1` wire protocol (C-510 AC-1). The Bun CLI,
// the frontend engine adapter and the backend test harness all delegate here;
// no other module re-implements submit/poll/extract.
//
// Transport:
// - POST /sdcpp/v1/img_gen           → create a job (returns a job id)
// - GET  /sdcpp/v1/jobs/{id}         → poll state (queued/generating/completed/…)
// - POST /sdcpp/v1/jobs/{id}/cancel  → cancellation
// - GET  /sdapi/v1/sd-models         → model listing (readiness probe shape)
//
// The job response carries the image data inline — no second fetch hop.
//
// Portable: no Svelte runes, no DOM-only globals, no Node/Bun-only imports.
//
// Contract: C-510 Engine-Agnostic Asset Generation Pipeline

import type {
  GenerationCallbacks,
  GenerationCapabilities,
  GenerationEngineClient,
  GenerationEngineId,
  GenerationModality,
  GenerationModelInfo,
  GenerationRequest,
  GenerationResult,
} from '@aikami/types';
import {
  assertNotAborted,
  assertPayloadSize,
  assertSafeBaseUrl,
  decodeImagePayload,
  isImageString,
  isTimeoutError,
  normaliseBaseUrl,
  sleep,
  withRequestTimeout,
} from './transport.ts';

/** Poll interval when waiting for a generation. */
const POLL_INTERVAL_MS = 1000;

/** Maximum generation wait (bounded so a dead engine cannot hang forever). */
const MAX_POLL_ATTEMPTS = 180;

/**
 * Default poll deadline for a generation job, in milliseconds.
 *
 * sd-server runs on CPU and a 512×512/20-step job takes ~140s on a developer
 * machine (measured; longer under load and on slower hardware). This is the
 * same 900s budget the pre-C-510 `generate_avatar.ts` shipped for exactly that
 * reason — a shorter deadline silently fails ordinary generations. The poll
 * loop is bounded by wall clock, so this is a ceiling, not a wait.
 *
 * Callers can raise or lower it per engine instance via
 * {@link SdCppGenerationEngineOptions.queueWaitMs} (`--timeout` on the CLI).
 */
export const DEFAULT_SDCPP_POLL_DEADLINE_MS = 900_000;

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

/** Construction options for {@link SdCppGenerationEngine}. */
export type SdCppGenerationEngineOptions = {
  /** Engine base URL. Empty/unset means "not configured" — never probe. */
  baseUrl?: string;
  /**
   * Poll deadline in milliseconds — how long to wait for the job to reach a
   * terminal state. Defaults to {@link DEFAULT_SDCPP_POLL_DEADLINE_MS}.
   */
  queueWaitMs?: number;
  /**
   * Verify a named `model` against `listModels()` before submitting.
   * sd-server queues forever on an unknown model name, so this defaults on.
   */
  verifyModel?: boolean;
};

/**
 * sd-server generation engine.
 *
 * Single-slot: `generate()` calls are serialized per instance, so a second
 * concurrent call waits for the first instead of failing the GPU job.
 */
export class SdCppGenerationEngine implements GenerationEngineClient {
  readonly id: GenerationEngineId = 'sdcpp';

  readonly modality: GenerationModality = 'image';

  readonly capabilities: GenerationCapabilities = {
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

  private readonly _queueWaitMs: number;

  private readonly _verifyModel: boolean;

  /** Tail of the serialization chain — single-slot engines run one job. */
  private _queue: Promise<unknown> = Promise.resolve();

  constructor(options: SdCppGenerationEngineOptions = {}) {
    this._baseUrl = normaliseBaseUrl(options.baseUrl);
    if (this._baseUrl) {
      assertSafeBaseUrl(this._baseUrl, 'sd-server');
    }
    this._queueWaitMs = options.queueWaitMs ?? DEFAULT_SDCPP_POLL_DEADLINE_MS;
    this._verifyModel = options.verifyModel ?? true;
  }

  /** @inheritdoc */
  async healthCheck(options?: { signal?: AbortSignal }): Promise<boolean> {
    if (!this._baseUrl) {
      return false; // no engine configured — never probe a hardcoded host
    }
    try {
      const response = await fetch(`${this._baseUrl}/sdapi/v1/sd-models`, {
        method: 'GET',
        signal: options?.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(2000)])
          : AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** @inheritdoc */
  async listModels(options?: { signal?: AbortSignal }): Promise<readonly GenerationModelInfo[]> {
    this._assertConfigured();
    const response = await fetch(`${this._baseUrl}/sdapi/v1/sd-models`, {
      method: 'GET',
      signal: withRequestTimeout(options?.signal, 5000),
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

  /** @inheritdoc */
  generate(request: GenerationRequest, callbacks?: GenerationCallbacks): Promise<GenerationResult> {
    // Serialize per instance: sd-server is single-slot, so a queued call must
    // wait rather than fail the GPU job. The chain never rejects — each link
    // swallows its own error so one failure cannot poison the queue.
    const run = this._queue.then(
      () => this._generate(request, callbacks),
      () => this._generate(request, callbacks),
    );
    this._queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // ── Private ──────────────────────────────────────────────────────────

  private async _generate(
    request: GenerationRequest,
    callbacks?: GenerationCallbacks,
  ): Promise<GenerationResult> {
    const { signal, onProgress } = callbacks ?? {};
    this._assertConfigured();

    if (request.modality !== this.modality) {
      throw new Error(
        `sd-server generates '${this.modality}' — a '${request.modality}' request cannot be dispatched to it`,
      );
    }

    assertNotAborted(signal);

    const sanitised = this._sanitiseRequest(request);

    if (sanitised.initImage) {
      assertPayloadSize(sanitised.initImage);
    }
    for (const reference of sanitised.referenceImages ?? []) {
      assertPayloadSize(reference);
    }
    if (sanitised.mask) {
      assertPayloadSize(sanitised.mask);
    }

    // Fail fast: sd-server queues forever on an unknown model name.
    if (sanitised.model && this._verifyModel) {
      await this._assertModelAvailable(sanitised.model, signal);
    }

    // The engine picks a seed when the caller omits one — record what it used
    // so the caller can reproduce the run.
    const resolvedSeed = sanitised.seed ?? Math.floor(Math.random() * 2 ** 32);

    onProgress?.({ fraction: 0.02, label: 'Queuing' });

    const body = this._buildRequestBody(sanitised, resolvedSeed);
    const job = await this._post<SdCppJob>('/sdcpp/v1/img_gen', body, signal);
    const jobId = this._extractJobId(job);
    if (!jobId) {
      // Some builds return the image inline instead of a job id — use it.
      const inline = this._extractInlineImage(job);
      if (inline) {
        onProgress?.({ fraction: 1, label: 'Complete' });
        return this._imageResult(inline, job, sanitised, resolvedSeed);
      }
      throw new Error('sd-server did not return a job id or image');
    }

    try {
      const jobResult = await this._pollJob(jobId, signal, onProgress);
      onProgress?.({ fraction: 1, label: 'Complete' });
      return this._imageResult(jobResult, jobResult, sanitised, resolvedSeed);
    } finally {
      // Abort issues sd-server's native cancel endpoint.
      if (signal?.aborted) {
        void this._cancelJob(jobId).catch(() => {});
      }
    }
  }

  private _assertConfigured(): void {
    if (!this._baseUrl) {
      throw new Error('Image engine is not configured (image.url missing from config.json)');
    }
  }

  private async _assertModelAvailable(model: string, signal?: AbortSignal): Promise<void> {
    let models: readonly GenerationModelInfo[];
    try {
      models = await this.listModels({ signal });
    } catch (error) {
      if (isTimeoutError(error) || signal?.aborted) {
        throw error;
      }
      throw new Error(
        `Cannot verify model "${model}" — sd-server model listing failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const known = models.some((entry) => entry.id === model || entry.description === model);
    if (!known) {
      const available = models.map((entry) => entry.id).join(', ') || '(none reported)';
      throw new Error(
        `sd-server has no model "${model}" — refusing to submit (an unknown model queues forever). Available: ${available}`,
      );
    }
  }

  /** Strips fields the engine does not declare support for. */
  private _sanitiseRequest(request: GenerationRequest): GenerationRequest {
    const sanitised: GenerationRequest = {
      modality: request.modality,
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

    return sanitised;
  }

  private _buildRequestBody(
    request: GenerationRequest,
    resolvedSeed: number,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      prompt: request.positivePrompt,
      width: request.width ?? 512,
      height: request.height ?? 512,
      sample_steps: request.steps ?? 20,
      txt_cfg: request.cfgScale ?? 7.0,
      seed: resolvedSeed,
      batch_count: 1,
    };

    if (request.negativePrompt) {
      body.negative_prompt = request.negativePrompt;
    }
    if (request.model) {
      body.model = request.model;
    }
    if (request.sampler) {
      body.sample_method = request.sampler;
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

  private async _pollJob(
    jobId: string,
    signal: AbortSignal | undefined,
    onProgress?: GenerationCallbacks['onProgress'],
  ): Promise<SdCppJob> {
    const startTime = Date.now();
    let attempt = 0;

    while (true) {
      assertNotAborted(signal);

      // First request fires immediately; sleep only between subsequent polls.
      if (attempt > 0) {
        await sleep(POLL_INTERVAL_MS, signal);
        assertNotAborted(signal);
      }

      let job: SdCppJob;
      try {
        job = await this._get<SdCppJob>(`/sdcpp/v1/jobs/${jobId}`, signal);
      } catch (error) {
        // A request timeout (not a caller abort) means the server job may
        // still be running — cancel it so the GPU is not left busy.
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

      const fraction =
        typeof job.progress === 'number'
          ? Math.min(0.95, Math.max(0.1, job.progress / 100))
          : Math.min(0.95, 0.1 + (attempt / MAX_POLL_ATTEMPTS) * 0.85);
      onProgress?.({ fraction, label: state === 'queued' ? 'Queuing' : 'Generating' });

      if (Date.now() - startTime >= this._queueWaitMs) {
        break;
      }
      attempt++;
    }

    const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
    const deadlineSeconds = Math.round(this._queueWaitMs / 1000);
    throw new Error(
      `Image generation timed out after ${elapsedSeconds}s (deadline ${deadlineSeconds}s) — sd-server did not complete in time. ` +
        'CPU inference is slow: raise the deadline (generate:asset --timeout <seconds>) or reduce steps/width/height.',
    );
  }

  private _imageResult(
    payload: SdCppJob | string,
    job: SdCppJob,
    request: GenerationRequest,
    resolvedSeed: number,
  ): GenerationResult {
    const imageData = this._extractInlineImage(payload);
    if (!imageData) {
      throw new Error('sd-server job completed without returning an image');
    }
    const { bytes, mimeType } = decodeImagePayload(imageData);
    if (bytes.length === 0) {
      throw new Error('sd-server returned an empty image payload');
    }
    return {
      bytes,
      mimeType,
      width: job.width ?? request.width ?? 512,
      height: job.height ?? request.height ?? 512,
      engine: this.id,
      seed: resolvedSeed,
      metadata: { bytes: bytes.length, prompt: request.positivePrompt },
    };
  }

  /**
   * Recursively finds an inline image payload (data URL, base64, or URL).
   * sd-server returns image data inline — never add a second fetch hop.
   */
  private _extractInlineImage(payload: unknown): string | undefined {
    if (typeof payload === 'string') {
      // Non-image strings such as "queued" are ignored so the caller can
      // produce a missing-image error instead of writing garbage.
      return isImageString(payload) ? payload : undefined;
    }
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }

    const obj = payload as Record<string, unknown>;

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
      const found = this._extractInlineImage(obj[key]);
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

  /** Issues sd-server's native job cancel. Fire-and-forget on abort. */
  private async _cancelJob(jobId: string): Promise<void> {
    await this._post(`/sdcpp/v1/jobs/${jobId}/cancel`, {}, undefined);
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
