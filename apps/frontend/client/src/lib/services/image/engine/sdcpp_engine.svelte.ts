// apps/frontend/client/src/lib/services/image/engine/sdcpp_engine.svelte.ts
//
// sd-server (stable-diffusion.cpp) engine adapter — the bundled default image
// engine per C-388/C-390.
//
// C-510: the transport moved to `@aikami/local-ai`'s `SdCppGenerationEngine`.
// This file is now a thin delegating adapter — it owns base-URL resolution,
// the C-388 `Blob` result bridge, the reactive-facing capability flags and the
// single-slot guard. It contains no `/sdcpp/v1` literals.
//
// Contract: C-388 Image Engine Provider Abstraction / C-510 AC-1

import {
  bytesToBlob,
  DEFAULT_SDCPP_POLL_DEADLINE_MS,
  SdCppGenerationEngine,
} from '@aikami/local-ai';
import type { GenerationRequest } from '@aikami/types';
import { resolveImageBaseUrl } from './base_url.ts';
import type {
  ImageEngineCallbacks,
  ImageEngineCapabilities,
  ImageEngineClient,
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageModelInfo,
} from './types.ts';

/**
 * sd-server engine adapter.
 *
 * Base URL: resolved from the runtime config chain (C-389) —
 * localStorage → Tauri file → ./config.json → dev-only PUBLIC_IMAGE_URL
 * default, or the Vite `/api/image` proxy in emulator. Both engines bind
 * 8188 mutually exclusively per C-390; no baked-in localhost literal
 * (C-389 AC-1) — an unconfigured engine reports unavailable.
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

  /** The shared, framework-agnostic transport (C-510). */
  private readonly _client: SdCppGenerationEngine;

  /**
   * Single-slot guard. sd-server processes one job at a time; the shared
   * client serializes, and this rejects a second concurrent call so the UI
   * can tell the user why nothing happened instead of silently queueing.
   */
  private _inFlight = false;

  constructor(baseUrl?: string) {
    this._client = new SdCppGenerationEngine({
      baseUrl: baseUrl ?? resolveImageBaseUrl('sdcpp'),
      // Explicit, not implicit: sd-server is CPU-only and a 512×512/20-step job
      // takes ~140s, so the poll deadline must be the shared CPU budget rather
      // than a tighter default. Cancellation still works (AbortSignal → the
      // engine's native cancel), so this is a ceiling, not a wait.
      queueWaitMs: DEFAULT_SDCPP_POLL_DEADLINE_MS,
    });
  }

  async healthCheck(): Promise<boolean> {
    return this._client.healthCheck();
  }

  async listModels(): Promise<readonly ImageModelInfo[]> {
    const models = await this._client.listModels();
    return models.map((model) => ({ id: model.id, description: model.description }));
  }

  async generate(
    request: ImageGenerationRequest,
    callbacks?: ImageEngineCallbacks,
  ): Promise<ImageGenerationResult> {
    if (this._inFlight) {
      throw new Error(
        'sd-server is single-slot — another generation is already running. Wait for it to finish.',
      );
    }
    this._inFlight = true;

    try {
      const result = await this._client.generate(toGenerationRequest(request), {
        signal: callbacks?.signal,
        onProgress: callbacks?.onProgress,
      });

      // C-510 return-shape bridge: the shared client is Blob-free (the Bun CLI
      // has no `Blob`); the C-388 public shape stays a `Blob`.
      return {
        blob: bytesToBlob(result.bytes, result.mimeType),
        width: result.width ?? request.width ?? 512,
        height: result.height ?? request.height ?? 512,
        mimeType: result.mimeType,
      };
    } finally {
      this._inFlight = false;
    }
  }
}

/** Widens a C-388 image request into the modality-generic request. */
const toGenerationRequest = (request: ImageGenerationRequest): GenerationRequest => ({
  modality: 'image',
  engine: 'sdcpp',
  positivePrompt: request.positivePrompt,
  negativePrompt: request.negativePrompt,
  model: request.model,
  width: request.width,
  height: request.height,
  steps: request.steps,
  cfgScale: request.cfgScale,
  seed: request.seed,
  sampler: request.sampler,
  initImage: request.initImage,
  denoise: request.denoise,
  mask: request.mask,
  referenceImages: request.referenceImages ? [...request.referenceImages] : undefined,
  loras: request.loras ? request.loras.map((lora) => ({ ...lora })) : undefined,
});
