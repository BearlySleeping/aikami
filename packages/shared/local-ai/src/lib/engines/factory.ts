// packages/shared/local-ai/src/lib/engines/factory.ts
//
// Generation engine factory (C-510) — one adapter per engine, selected by id.
// Both the Bun CLI and the frontend engine adapter resolve through here so a
// new engine is added in exactly one place.
//
// C-521 adds a second axis to that selection: ACE-Step ships two incompatible
// REST protocols, and a provider profile declares which one it speaks. The
// factory is therefore **protocol-aware** — a profile carrying
// `protocol: 'ace-step-v1.5'` must never be handed the v1 adapter, which would
// dispatch a `release_task`/`query_result` profile at the v1 `/generate` API.
//
// Contract: C-510 Engine-Agnostic Asset Generation Pipeline;
//           C-521 AC-1 (the versioned v1.5 protocol is a real dispatch target)

import type { GenerationEngineClient, GenerationEngineId } from '@aikami/types';
import { AceStepGenerationEngine, type AceStepGenerationEngineOptions } from './ace_step_engine.ts';
import {
  AceStepV15GenerationEngine,
  type AceStepV15GenerationEngineOptions,
} from './ace_step_v15_engine.ts';
import { ComfyUiGenerationEngine, type ComfyUiGenerationEngineOptions } from './comfyui_engine.ts';
import { SdCppGenerationEngine, type SdCppGenerationEngineOptions } from './sdcpp_engine.ts';

/**
 * The ACE-Step wire protocols this package can dispatch to.
 *
 * A provider profile declares one of these; the factory picks the adapter. The
 * values match `GenerationProviderProfile['protocol']` in `@aikami/constants`.
 */
export const ACE_STEP_PROTOCOLS = ['ace-step-v1', 'ace-step-v1.5'] as const;

/** An ACE-Step wire protocol. */
export type AceStepProtocol = (typeof ACE_STEP_PROTOCOLS)[number];

/**
 * The protocol assumed when a caller does not name one.
 *
 * The v1 adapter is the shipped default so an existing call site that predates
 * C-521 keeps working; a v1.5 profile must opt in explicitly.
 */
export const DEFAULT_ACE_STEP_PROTOCOL: AceStepProtocol = 'ace-step-v1';

/** Narrows a raw string to a declared protocol. */
export const isAceStepProtocol = (value: string | undefined): value is AceStepProtocol =>
  value === 'ace-step-v1' || value === 'ace-step-v1.5';

/** Construction options shared by every adapter. */
export type GenerationEngineOptions = {
  /** Engine base URL. Empty/unset means "not configured" — never probe. */
  baseUrl?: string;
  /** Engine poll deadline in milliseconds. */
  queueWaitMs?: number;
  /** sd.cpp only — verify a named model against `listModels()` first. */
  verifyModel?: boolean;
  /**
   * ACE-Step only (C-511) — v1 construction options (checkpoint path, output
   * directory, the artifact reader). `baseUrl`/`queueWaitMs` are deliberately
   * excluded: they are shared options above.
   */
  aceStep?: Omit<AceStepGenerationEngineOptions, 'baseUrl' | 'queueWaitMs'>;
  /**
   * ACE-Step only (C-521) — which wire protocol the caller's profile speaks.
   * Defaults to `ace-step-v1` for a call site that predates the versioned
   * profile registry.
   */
  aceStepProtocol?: AceStepProtocol;
  /**
   * ACE-Step v1.5 only (C-521) — the versioned adapter's construction options
   * (pinned model id, explicit output format, artifact-root bounds, the
   * bounded artifact fetcher). `baseUrl`/`pollDeadlineMs` are excluded because
   * they are shared options above.
   */
  aceStepV15?: Omit<AceStepV15GenerationEngineOptions, 'baseUrl' | 'pollDeadlineMs'>;
};

/** The default engine when a recipe does not name one — sd.cpp (MIT, lighter). */
export const DEFAULT_GENERATION_ENGINE_ID: GenerationEngineId = 'sdcpp';

/** Every engine id this package can construct. */
export const GENERATION_ENGINE_IDS: readonly GenerationEngineId[] = [
  'sdcpp',
  'comfyui',
  'ace-step',
];

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
  if (engineId === 'ace-step') {
    // 🔴 The protocol decides the adapter. Constructing the v1 adapter for a
    // v1.5 profile is the failure this branch exists to make impossible.
    const protocol = options.aceStepProtocol ?? DEFAULT_ACE_STEP_PROTOCOL;
    if (protocol === 'ace-step-v1.5') {
      return new AceStepV15GenerationEngine({
        baseUrl: options.baseUrl,
        pollDeadlineMs: options.queueWaitMs,
        ...options.aceStepV15,
      });
    }
    return new AceStepGenerationEngine({
      baseUrl: options.baseUrl,
      queueWaitMs: options.queueWaitMs,
      ...options.aceStep,
    });
  }
  const sdcppOptions: SdCppGenerationEngineOptions = {
    baseUrl: options.baseUrl,
    queueWaitMs: options.queueWaitMs,
    verifyModel: options.verifyModel,
  };
  return new SdCppGenerationEngine(sdcppOptions);
};
