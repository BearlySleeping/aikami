// apps/frontend/client/src/lib/views/studio/studio_dispatch_spec.ts
//
// C-522 — the studio's allowlisted dispatch spec and its canonical hash.
//
// Extracted from `studio_composition.ts` for two reasons:
//
//   1. **Hash identity is the contract.** The hash must come from
//      `computeEffectiveSpecHash` — the same canonicalizer C-519's plan core
//      uses — or "the same locked request" means something different depending
//      on which front door submitted it. Keeping the derivation in a module
//      that imports nothing but `@aikami/local-ai` makes that checkable from a
//      test in another package (see `apps/e2e/tests/hub/generation_runner.spec.ts`).
//   2. It has no `$services` dependency, so it is testable without a browser.
//
// Contract: C-522 Hub and client access to the generation runner

import { computeEffectiveSpecHash, makeJobId, makeRequestKey, makeRunId } from '@aikami/local-ai';

/** One run per studio recipe — the stable idempotency namespace. */
const STUDIO_RUN_ID = makeRunId({ briefId: 'studio', phase: 'slice' });
const STUDIO_ITEM_ID = 'studio';
const STUDIO_RECIPE_ID = 'portrait';
const STUDIO_ENGINE_ID = 'sdcpp' as const;
const STUDIO_PROVIDER_PROFILE_ID = 'local-sdcpp';
const STUDIO_PREPARATION_PROFILE_ID = 'image-default';

/** One-candidate, one-GPU budget for a studio dispatch — the shared shape. */
export const STUDIO_HUB_BUDGET = {
  gpuConcurrency: 1,
  candidateLimitPerItem: 1,
  maxCandidatesPerRun: 1,
  hostedBudgetUsd: 0,
  maxDurationSeconds: 0,
  maxPixels: 4_194_304,
  maxRetainedBytes: 33_554_432,
  maxRequestedAudioSecondsPerCandidatePass: 0,
} as const;

/** The identity of a studio dispatch, as every other surface must compute it. */
export type StudioDispatchSpec = {
  readonly jobId: string;
  readonly requestKey: string;
  readonly effectiveSpecHash: string;
  readonly spec: {
    readonly itemId: string;
    readonly recipeId: string;
    readonly modality: 'image';
    readonly providerProfileId: string;
    readonly preparationProfile: string;
    readonly referenceIds: readonly string[];
    readonly seed: number;
    readonly candidateLimit: number;
    readonly budget: typeof STUDIO_HUB_BUDGET;
    readonly prompt: string;
    readonly negativePrompt?: string;
  };
};

/**
 * Builds the allowlisted dispatch spec for one studio request.
 *
 * 🔴 The hash comes from `computeEffectiveSpecHash` — the *same* canonicalizer
 * the C-519 CLI and the local runner use. Computing a second, local hash here
 * would make the same locked request look like two different jobs depending on
 * which front door submitted it, which is precisely what the shared
 * `effectiveSpecHash` exists to prevent.
 */
export const buildStudioDispatch = async (request: {
  prompt: string;
  negativePrompt?: string;
}): Promise<StudioDispatchSpec> => {
  const overrides = {
    ...(request.negativePrompt === undefined ? {} : { negativePrompt: request.negativePrompt }),
  };
  const effectiveSpecHash = await computeEffectiveSpecHash({
    briefId: 'studio',
    itemId: STUDIO_ITEM_ID,
    recipeId: STUDIO_RECIPE_ID,
    engineId: STUDIO_ENGINE_ID,
    providerProfileId: STUDIO_PROVIDER_PROFILE_ID,
    providerMode: 'local',
    preparationProfile: STUDIO_PREPARATION_PROFILE_ID,
    prompt: request.prompt,
    // References are resolved locally by the run's own resolver; the Hub never
    // receives artifact bytes at dispatch time, so there are no hashes to send.
    referenceHashes: {},
    attempt: 1,
    seed: 0,
    overrides,
  });
  const spec = {
    itemId: STUDIO_ITEM_ID,
    recipeId: STUDIO_RECIPE_ID,
    modality: 'image' as const,
    providerProfileId: STUDIO_PROVIDER_PROFILE_ID,
    preparationProfile: STUDIO_PREPARATION_PROFILE_ID,
    referenceIds: [] as readonly string[],
    seed: 0,
    candidateLimit: 1,
    budget: STUDIO_HUB_BUDGET,
    prompt: request.prompt,
    ...overrides,
  };
  return {
    jobId: makeJobId({ itemId: STUDIO_ITEM_ID, attempt: 1, specHash: effectiveSpecHash }),
    // `makeRunId` is the studio's stable run id for this pairing; the request
    // key is derived from it exactly as the batch CLI derives its own.
    requestKey: makeRequestKey({ runId: STUDIO_RUN_ID, itemId: STUDIO_ITEM_ID, attempt: 1 }),
    effectiveSpecHash,
    spec,
  };
};
