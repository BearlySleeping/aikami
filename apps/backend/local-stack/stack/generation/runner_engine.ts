// apps/backend/local-stack/stack/generation/runner_engine.ts
//
// C-519/C-521: the runner's engine seam — the context a factory is called with,
// the factory type itself, the two id helpers and the lease-aware decorator
// that makes a dispatch impossible without the resource lease.
//
// Extracted from `runner.ts` so the item loop reads as policy. The decorator is
// still the last line of defence: if this process lost the lease (a reclaimed
// stale lock, a manual release) it refuses to dispatch rather than compete for
// the GPU.
//
// Contract: C-519 Durable asset jobs and batch execution;
//           C-521 Music and SFX generation with audio preparation

import { GENERATION_PROVIDER_PROFILES, type GenerationProviderProfile } from '@aikami/constants';
import type { GenerationEngineClient, GenerationEngineId, GenerationPlanItem } from '@aikami/types';

/** The engine a plan item should dispatch to. */
export type BatchEngineContext = {
  readonly item: GenerationPlanItem;
  readonly engineId: GenerationEngineId;
  /** Base URL override (`--engine-url`). */
  readonly engineUrl?: string;
  /** Poll deadline in milliseconds. */
  readonly queueWaitMs?: number;
};

/** Builds the engine for one item. Returning undefined blocks the dispatch. */
export type BatchEngineFactory = (
  context: BatchEngineContext,
) => GenerationEngineClient | undefined;

/** The provider profile for a plan item, when the registry declares it. */
export const profileForItem = (item: GenerationPlanItem): GenerationProviderProfile | undefined =>
  GENERATION_PROVIDER_PROFILES[item.providerProfileId];

/** Narrows a string to a shipped engine id. */
export const parseEngineId = (value: string | undefined): GenerationEngineId | undefined => {
  if (value === 'sdcpp' || value === 'comfyui' || value === 'ace-step') {
    return value;
  }
  return undefined;
};

/**
 * Wraps an engine so a dispatch can never happen without the lease.
 *
 * The lease is the cross-process authority; this decorator is the last line —
 * if this process lost the lease (a reclaimed stale lock, a manual release),
 * it refuses to dispatch rather than compete for the GPU.
 */
export const createLeaseAwareEngine = (options: {
  engine: GenerationEngineClient;
  isLeaseHeld: () => boolean;
  onDispatch: () => void;
}): GenerationEngineClient => ({
  id: options.engine.id,
  modality: options.engine.modality,
  capabilities: options.engine.capabilities,
  healthCheck: (healthOptions) => options.engine.healthCheck(healthOptions),
  listModels: (modelOptions) => options.engine.listModels(modelOptions),
  generate: async (request, callbacks) => {
    if (!options.isLeaseHeld()) {
      throw new Error(
        `Refusing to dispatch to "${options.engine.id}": this process no longer holds the resource lease`,
      );
    }
    options.onDispatch();
    return options.engine.generate(request, callbacks);
  },
});
