// apps/frontend/client/src/lib/services/image/engine/comfyui_engine.svelte.ts
//
// ComfyUI engine adapter — the opt-in advanced image engine (C-388).
//
// C-510: the transport (graph builder, submit, poll, interrupt) moved to
// `@aikami/local-ai`'s `ComfyUiGenerationEngine`. This file is now a thin
// delegating adapter — it owns base-URL resolution and the C-388 `Blob`
// result bridge.
//
// Contract: C-388 Image Engine Provider Abstraction / C-510 AC-1

import { bytesToBlob, ComfyUiGenerationEngine } from '@aikami/local-ai';
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
 * ComfyUI engine adapter.
 *
 * Talks the native ComfyUI HTTP API on the base URL (resolved from the
 * runtime config chain — C-389: localStorage → Tauri file → ./config.json
 * → dev-only PUBLIC_IMAGE_URL default, or the Vite `/api/image` proxy in
 * emulator). No baked-in localhost default (C-389 AC-1): an unconfigured
 * engine reports unavailable instead of probing a hardcoded host.
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

  /** The shared, framework-agnostic transport (C-510). */
  private readonly _client: ComfyUiGenerationEngine;

  constructor(baseUrl?: string) {
    this._client = new ComfyUiGenerationEngine({
      baseUrl: baseUrl ?? resolveImageBaseUrl('comfyui'),
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
    const result = await this._client.generate(toGenerationRequest(request), {
      signal: callbacks?.signal,
      onProgress: callbacks?.onProgress,
    });

    // C-510 return-shape bridge: the shared client is Blob-free; the C-388
    // public shape stays a `Blob`.
    return {
      blob: bytesToBlob(result.bytes, result.mimeType),
      width: result.width ?? request.width ?? 512,
      height: result.height ?? request.height ?? 512,
      mimeType: result.mimeType,
    };
  }
}

/** Widens a C-388 image request into the modality-generic request. */
const toGenerationRequest = (request: ImageGenerationRequest): GenerationRequest => ({
  modality: 'image',
  engine: 'comfyui',
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
