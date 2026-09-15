// apps/frontend/client/src/lib/views/studio/studio_dispatch_spec.ts
//
// C-522 — the studio's allowlisted dispatch spec and its canonical hash.
//
// Extracted from `studio_composition.ts` for two reasons:
//
//   1. **Hash identity is the contract.** The hash must come from
//      `computeEffectiveSpecHash` — the same canonicalizer C-519's plan core
//      uses — or "the same locked request" means something different depending
//      on which front door submitted it. It imports nothing but
//      `@aikami/local-ai` and `@aikami/constants` and has no `$services`
//      dependency, so it is checkable from a test without a browser.
//   2. **The provider profile is resolved, not named.** A hardcoded id can be
//      absent from the registry, and then the runner refuses the dispatch for a
//      reason the Hub cannot explain — see `localProviderProfileForEngine`.
//
// Contract: C-522 Hub and client access to the generation runner

import { type GenerationProviderProfile, localProviderProfileForEngine } from '@aikami/constants';
import {
  computeEffectiveSpecHash,
  getRecipe,
  makeJobId,
  makeRequestKey,
  makeRunId,
} from '@aikami/local-ai';

/** One run per studio recipe — the stable idempotency namespace. */
const STUDIO_RUN_ID = makeRunId({ briefId: 'studio', phase: 'slice' });
const STUDIO_ITEM_ID = 'studio';
const STUDIO_RECIPE_ID = 'portrait';

/**
 * The studio's preparation profile, in the *brief's* namespace.
 *
 * `preparationProfile` on a plan item is a key the brief declares under
 * `preparationProfiles` — `buildGenerationPlan` refuses one the brief does not
 * declare — and not a C-520 `PREPARATION_PROFILE_IDS` workflow id, which is a
 * different vocabulary (`portrait-original`). The shipped
 * `emberwatch_asset_brief.json` names `portrait` for every portrait job, so the
 * studio uses the same word for the same recipe: a Hub dispatch carries no brief
 * for the Hub to validate against, so this must stay the convention the CLI
 * already writes.
 */
const STUDIO_PREPARATION_PROFILE_ID = 'portrait';

/** The studio recipe's declared engine, and the registry profile that serves it. */
type StudioProvider = {
  readonly profile: GenerationProviderProfile;
  readonly engineId: NonNullable<GenerationProviderProfile['engineId']>;
};

/**
 * Resolves the studio's recipe → engine → provider profile from the registries.
 *
 * 🔴 Resolved, never invented. The previous revision hardcoded `local-sdcpp`,
 * which is in no registry: the runner's `profileForItem` resolved nothing, so it
 * raised `provider_unavailable` before dialling an engine — and the Hub then
 * reported that blocked plan as `queued` with its lease still held, a dispatch
 * that could never be claimed and never explained itself.
 *
 * Throwing here is deliberate. An unresolvable pairing is a repository
 * inconsistency, not a runtime condition, and papering it over by dispatching an
 * id the runner cannot resolve is the defect this replaces.
 */
const studioProvider = (): StudioProvider => {
  const recipe = getRecipe(STUDIO_RECIPE_ID);
  if (recipe?.engine === undefined) {
    throw new Error(
      `studio dispatch: the recipe "${STUDIO_RECIPE_ID}" is not registered or declares no engine`,
    );
  }
  if (recipe.modality !== 'image') {
    // The studio's dispatch spec is image-only; an audio recipe needs a different
    // budget and a different transport, not a silently widened type here.
    throw new Error(
      `studio dispatch: the recipe "${STUDIO_RECIPE_ID}" declares modality "${recipe.modality}", but the studio dispatches images only`,
    );
  }
  const profile = localProviderProfileForEngine({
    engineId: recipe.engine,
    modality: recipe.modality,
  });
  if (profile === undefined) {
    throw new Error(
      `studio dispatch: no local provider profile serves engine "${recipe.engine}" — refusing rather than dispatching an id the runner cannot resolve`,
    );
  }
  return { profile, engineId: recipe.engine };
};

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

/**
 * A fresh seed for each studio dispatch.
 *
 * The Hub's enqueue is idempotent on `(owner, jobId, attempt)`, and `jobId`
 * derives from the effective spec hash — which includes the seed. A fixed seed
 * made every re-roll of the same prompt collapse onto the first dispatch: the
 * Hub answered 200 with the existing row and the creator's new request was
 * silently dropped. Each call therefore takes a new seed.
 */
let studioSeedCounter = Math.floor(Math.random() * 1_000_000);
const freshSeed = (): number => {
  studioSeedCounter += 1;
  return studioSeedCounter;
};

/** The identity a re-roll carries; injectable so tests stay deterministic. */
export type StudioDispatchIdentity = {
  readonly attempt: number;
  readonly seed: number;
};

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
export const buildStudioDispatch = async (
  request: { prompt: string; negativePrompt?: string },
  identity?: Partial<StudioDispatchIdentity>,
): Promise<StudioDispatchSpec> => {
  const { profile, engineId } = studioProvider();
  // One identity threaded through the hash, the spec, the job id and the
  // request key — so a re-roll is a new dispatch everywhere, not just in one
  // field.
  const attempt = identity?.attempt ?? 1;
  const seed = identity?.seed ?? freshSeed();
  const overrides = {
    ...(request.negativePrompt === undefined ? {} : { negativePrompt: request.negativePrompt }),
  };
  const effectiveSpecHash = await computeEffectiveSpecHash({
    briefId: 'studio',
    itemId: STUDIO_ITEM_ID,
    recipeId: STUDIO_RECIPE_ID,
    engineId,
    providerProfileId: profile.id,
    // The profile decides the provider and the transport, exactly as the C-519
    // plan core resolves them, so the two front doors cannot disagree.
    providerMode: profile.mode,
    preparationProfile: STUDIO_PREPARATION_PROFILE_ID,
    prompt: request.prompt,
    // References are resolved locally by the run's own resolver; the Hub never
    // receives artifact bytes at dispatch time, so there are no hashes to send.
    referenceHashes: {},
    attempt,
    seed,
    overrides,
  });
  const spec = {
    itemId: STUDIO_ITEM_ID,
    recipeId: STUDIO_RECIPE_ID,
    modality: 'image' as const,
    providerProfileId: profile.id,
    preparationProfile: STUDIO_PREPARATION_PROFILE_ID,
    referenceIds: [] as readonly string[],
    seed,
    candidateLimit: 1,
    budget: STUDIO_HUB_BUDGET,
    prompt: request.prompt,
    ...overrides,
  };
  return {
    jobId: makeJobId({ itemId: STUDIO_ITEM_ID, attempt, specHash: effectiveSpecHash }),
    // `makeRunId` is the studio's stable run id for this pairing; the request
    // key is derived from it exactly as the batch CLI derives its own.
    requestKey: makeRequestKey({ runId: STUDIO_RUN_ID, itemId: STUDIO_ITEM_ID, attempt }),
    effectiveSpecHash,
    spec,
  };
};
