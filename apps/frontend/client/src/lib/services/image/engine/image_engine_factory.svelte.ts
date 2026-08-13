// apps/frontend/client/src/lib/services/image/engine/image_engine_factory.svelte.ts
//
// Image engine factory (C-388) — resolves the active engine from
// PUBLIC_IMAGE_ENGINE (`auto` | `sdcpp` | `comfyui`) with parallel
// auto-detection as the default. Mirrors `.../ai/clients/ai/factory.ts`:
// one file per implementation, a factory that selects one.
//
// Detection contract (AC-4):
// - both respond        → sd-server (deterministic preference)
// - only ComfyUI        → ComfyUI
// - only sd-server      → sd-server
// - neither responds    → undefined (isReady stays false, no throw)
//
// Performance: detection runs once per session and is cached; the parallel
// probes use a hard timeout so detection completes well under 500 ms.
//
// Contract: C-388 Image Engine Provider Abstraction

import type { ImageEngineId } from '@aikami/types';
import { logger } from '$logger';
import { ComfyUiEngine } from './comfyui_engine.svelte.ts';
import { SdCppEngine } from './sdcpp_engine.svelte.ts';
import type { ImageEngineClient, ResolvedImageEngineId } from './types.ts';

/** Hard timeout per health probe — keeps auto-detection under 500 ms. */
const PROBE_TIMEOUT_MS = 250;

/** Timeout used by the factory-level AbortController for probes. */
const DETECTION_BUDGET_MS = 450;

const isResolvedEngineId = (id: string): id is ResolvedImageEngineId =>
  id === 'comfyui' || id === 'sdcpp';

/**
 * Reads the configured engine id from PUBLIC_IMAGE_ENGINE.
 * Defaults to `auto`.
 */
export const getConfiguredImageEngineId = (): ImageEngineId => {
  const raw = import.meta.env.PUBLIC_IMAGE_ENGINE as string | undefined;
  if (raw === 'comfyui' || raw === 'sdcpp' || raw === 'auto') {
    return raw;
  }
  return 'auto';
};

/** Detection cache — reset via {@link resetImageEngineCache} (tests). */
let _detectionCache: ImageEngineClient | undefined;

/** Runtime override — set by the dev sandbox engine selector (C-388). */
let _engineOverride: ImageEngineId | undefined;

/**
 * Sets a runtime engine override (dev sandbox). `auto` clears the override
 * and returns to config + detection. Not persisted — PUBLIC_IMAGE_ENGINE
 * remains the kill switch.
 */
export const setImageEngineOverride = (engine: ImageEngineId): void => {
  _engineOverride = engine;
  resetImageEngineCache();
};

/** Reads the effective engine id: runtime override → config → auto. */
export const getEffectiveImageEngineId = (): ImageEngineId => {
  if (_engineOverride && isResolvedEngineId(_engineOverride)) {
    return _engineOverride;
  }
  return getConfiguredImageEngineId();
};

/**
 * Resolves the active image engine.
 *
 * - Explicit config / override (`comfyui` | `sdcpp`) returns that engine
 *   immediately — no probing.
 * - `auto` probes both engines in parallel, prefers sd-server on a tie,
 *   caches the result for the session.
 *
 * @returns The selected engine, or undefined when auto-detection finds no
 *          reachable engine (callers degrade to demo/placeholder).
 */
export const resolveImageEngine = async (): Promise<ImageEngineClient | undefined> => {
  const configured = getEffectiveImageEngineId();

  if (isResolvedEngineId(configured)) {
    logger.info('image-engine:configured', { engine: configured });
    return createEngine(configured);
  }

  return detectImageEngine();
};

/**
 * Probes both engines in parallel with a hard budget and prefers sd-server.
 * Cached per session.
 */
export const detectImageEngine = async (): Promise<ImageEngineClient | undefined> => {
  if (_detectionCache) {
    return _detectionCache;
  }

  const budget = new AbortController();
  const timer = setTimeout(() => budget.abort(), DETECTION_BUDGET_MS);

  const sdcpp = createEngine('sdcpp');
  const comfyui = createEngine('comfyui');

  try {
    const [sdcppOk, comfyuiOk] = await Promise.all([
      probeWithTimeout(sdcpp, budget.signal),
      probeWithTimeout(comfyui, budget.signal),
    ]);

    const selected: ImageEngineClient | undefined = sdcppOk
      ? sdcpp
      : comfyuiOk
        ? comfyui
        : undefined;

    logger.info('image-engine:detected', {
      sdcpp: sdcppOk,
      comfyui: comfyuiOk,
      selected: selected?.id ?? 'none',
    });

    _detectionCache = selected;
    return selected;
  } finally {
    clearTimeout(timer);
  }
};

/** Clears the detection cache — used by tests between permutations. */
export const resetImageEngineCache = (): void => {
  _detectionCache = undefined;
};

const createEngine = (engineId: ResolvedImageEngineId): ImageEngineClient =>
  engineId === 'comfyui' ? new ComfyUiEngine() : new SdCppEngine();

const probeWithTimeout = async (
  engine: ImageEngineClient,
  budgetSignal: AbortSignal,
): Promise<boolean> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const onBudgetAbort = (): void => controller.abort();
  budgetSignal.addEventListener('abort', onBudgetAbort, { once: true });

  try {
    return await engine.healthCheck().catch(() => false);
  } finally {
    clearTimeout(timer);
    budgetSignal.removeEventListener('abort', onBudgetAbort);
  }
};
