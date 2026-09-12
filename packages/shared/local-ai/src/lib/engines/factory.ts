// packages/shared/local-ai/src/lib/engines/factory.ts
//
// Generation engine factory (C-510) — one adapter per engine, selected by id.
// Both the Bun CLI and the frontend engine adapter resolve through here so a
// new engine is added in exactly one place.
//
// Contract: C-510 Engine-Agnostic Asset Generation Pipeline

import type { GenerationEngineClient, GenerationEngineId } from '@aikami/types';
import { ComfyUiGenerationEngine, type ComfyUiGenerationEngineOptions } from './comfyui_engine.ts';
import { SdCppGenerationEngine, type SdCppGenerationEngineOptions } from './sdcpp_engine.ts';

/** Construction options shared by both adapters. */
export type GenerationEngineOptions = {
  /** Engine base URL. Empty/unset means "not configured" — never probe. */
  baseUrl?: string;
  /** Engine poll deadline in milliseconds. */
  queueWaitMs?: number;
  /** sd.cpp only — verify a named model against `listModels()` first. */
  verifyModel?: boolean;
};

/** The default engine when a recipe does not name one — sd.cpp (MIT, lighter). */
export const DEFAULT_GENERATION_ENGINE_ID: GenerationEngineId = 'sdcpp';

/** Every engine id this package can construct. */
export const GENERATION_ENGINE_IDS: readonly GenerationEngineId[] = ['sdcpp', 'comfyui'];

/** Runtime guard for a raw engine-id string. */
export const isGenerationEngineId = (value: string): value is GenerationEngineId =>
  GENERATION_ENGINE_IDS.includes(value as GenerationEngineId);

/**
 * Constructs the adapter for an engine id.
 *
 * @param engineId — Engine to construct.
 * @param options — Base URL + engine-specific tuning.
 * @returns A ready-to-use {@link GenerationEngineClient}.
 */
export const createGenerationEngine = (
  engineId: GenerationEngineId,
  options: GenerationEngineOptions = {},
): GenerationEngineClient => {
  if (engineId === 'comfyui') {
    const comfyuiOptions: ComfyUiGenerationEngineOptions = {
      baseUrl: options.baseUrl,
      queueWaitMs: options.queueWaitMs,
    };
    return new ComfyUiGenerationEngine(comfyuiOptions);
  }
  const sdcppOptions: SdCppGenerationEngineOptions = {
    baseUrl: options.baseUrl,
    queueWaitMs: options.queueWaitMs,
    verifyModel: options.verifyModel,
  };
  return new SdCppGenerationEngine(sdcppOptions);
};
