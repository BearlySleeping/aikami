// apps/frontend/client/src/lib/services/image/engine/types.ts
//
// Image engine abstraction types (C-388). Client-local transport types —
// single-app, per Pillar 2. The persisted engine preference lives in
// packages/shared (ImageEngineId / ImageEnginePreference).
//
// Contract: C-388 Image Engine Provider Abstraction

import type { ImageEngineId } from '@aikami/types';

/** Concrete engine id — the resolved result of `ImageEngineId` minus `auto`. */
export type ResolvedImageEngineId = Exclude<ImageEngineId, 'auto'>;

/** What a given engine can actually do. Drives UI affordances. */
export type ImageEngineCapabilities = {
  /** Negative prompt is sent to the engine. */
  negativePrompt: boolean;
  /** Seed can be fixed. */
  seed: boolean;
  /** Sampler can be selected. */
  sampler: boolean;
  /** Init image (img2img) is supported. */
  initImage: boolean;
  /** Inpainting mask is supported. */
  mask: boolean;
  /** PhotoMaker-style reference images are supported. */
  referenceImages: boolean;
  /** ControlNet conditioning is supported. */
  controlNet: boolean;
  /** LoRA adapters are supported. */
  lora: boolean;
  /** Native cancel endpoint exists. */
  cancel: boolean;
  /** Fine-grained progress is reported. */
  progress: boolean;
};

/**
 * Supersedes the five-field ImageOptions in the image path.
 * `FrontendAiInterface.generateImage` keeps ImageOptions for the other
 * providers — the image path uses this request type.
 */
export type ImageGenerationRequest = {
  /** The compiled positive prompt. */
  positivePrompt: string;
  /** The compiled negative prompt (comma-joined tags). */
  negativePrompt?: string;
  /** Model / checkpoint id. */
  model?: string;
  /** Output width in pixels. */
  width?: number;
  /** Output height in pixels. */
  height?: number;
  /** Number of denoising steps. */
  steps?: number;
  /** Prompt guidance scale. */
  cfgScale?: number;
  /** Fixed seed (engine picks one when omitted). */
  seed?: number;
  /** Sampler name. */
  sampler?: string;
  /** Base64 or data URL — img2img source. */
  initImage?: string;
  /** 0..1 — only meaningful with initImage. */
  denoise?: number;
  /** Base64 or data URL, single-channel — inpainting mask. */
  mask?: string;
  /** Base64 or data URLs — character consistency (expression packs). */
  referenceImages?: readonly string[];
  /** LoRA adapters. */
  loras?: readonly { path: string; multiplier: number }[];
};

/** Model descriptor returned by an engine's model list. */
export type ImageModelInfo = {
  readonly id: string;
  readonly description: string;
};

/** Progress pushed from an engine into the service layer. */
export type ImageProgress = {
  /** 0..1. Engines without fine-grained progress emit 0 then 1. */
  readonly fraction: number;
  /** Engine-agnostic human-readable label. */
  readonly label: string;
};

/** Result of an engine generation. */
export type ImageGenerationResult = {
  /** Generated image bytes. */
  readonly blob: Blob;
  /** Image width in pixels. */
  readonly width: number;
  /** Image height in pixels. */
  readonly height: number;
  /** MIME type (e.g. 'image/png', 'image/webp'). */
  readonly mimeType: string;
};

/** Engine callbacks. */
export type ImageEngineCallbacks = {
  /** Abort signal — native cancel is issued on abort. */
  signal?: AbortSignal;
  /** Progress callback (0..1 fraction, engine-agnostic label). */
  onProgress?: (progress: ImageProgress) => void;
};

/**
 * Narrow image-specific engine interface.
 * One file per implementation, capability flags on the instance, and a
 * factory that selects one (mirrors `.../ai/clients/ai/factory.ts`).
 */
export type ImageEngineClient = {
  /** Engine id. */
  readonly id: ResolvedImageEngineId;
  /** Capability flags — drives UI affordances. */
  readonly capabilities: ImageEngineCapabilities;
  /** Whether the engine is reachable right now. */
  healthCheck(): Promise<boolean>;
  /** List available models/checkpoints. */
  listModels(): Promise<readonly ImageModelInfo[]>;
  /**
   * Generate an image.
   * @param request — Generation request.
   * @param callbacks — Abort signal + progress callback.
   * @returns Image blob with dimensions and MIME type.
   */
  generate(
    request: ImageGenerationRequest,
    callbacks?: ImageEngineCallbacks,
  ): Promise<ImageGenerationResult>;
};
