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

import {
  GENERATION_PROVIDER_PROFILES,
  type GenerationProviderProfile,
  isGenerationHostedTransportId,
} from '@aikami/constants';
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

/**
 * Narrows a string to a shipped engine id.
 *
 * C-524: the hosted transports are valid *dispatch* ids too — they are members
 * of `GenerationEngineIdSchema` so a hosted candidate's provenance can stay
 * truthful — but they are resolved by the host's hosted factory, never by
 * `createGenerationEngine` (which constructs local adapters only).
 */
export const parseEngineId = (value: string | undefined): GenerationEngineId | undefined => {
  if (value === 'sdcpp' || value === 'comfyui' || value === 'ace-step') {
    return value;
  }
  if (isGenerationHostedTransportId(value)) {
    return value;
  }
  return undefined;
};

/**
 * Resolves an item's engine, turning a factory throw into a refusal.
 *
 * A factory refuses in two ways: `undefined` for a protocol or pinned model set
 * this host cannot resolve, or a throw for a profile the selected engine has no
 * support for. Both are refusals, so both are returned as data — a throw must
 * never escape the batch loop and abort the whole run, which is how C-520's
 * `--workflow-profile` refusal reaches the report.
 */
export const resolveItemEngine = (options: {
  factory: BatchEngineFactory;
  context: BatchEngineContext;
}): { engine?: GenerationEngineClient; refusal?: string } => {
  try {
    return { engine: options.factory(options.context) };
  } catch (error) {
    return { refusal: error instanceof Error ? error.message : String(error) };
  }
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
