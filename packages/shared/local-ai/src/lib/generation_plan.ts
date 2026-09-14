// packages/shared/local-ai/src/lib/generation_plan.ts
//
// C-519: the portable plan and run-lock derivation.
//
// A plan turns an authored asset brief into the exact jobs a runner may
// dispatch — and, just as importantly, into the structured *reasons* it may
// not. It is pure: reading reference bytes and hashing them is injected
// through a `ReferenceResolver`, so `--plan` can be proven side-effect-free
// and the same derivation can run in a test.
//
// Honesty rules this module enforces:
//
//   - a required reference with no verified bytes is a *blocker*, and it never
//     acquires a fabricated hash;
//   - a provider group that resolves only to an unavailable or import-only
//     profile is a *blocker*, never a silent substitution;
//   - a declared budget ceiling that a dispatch would exceed is named before
//     anything is dispatched.
//
// Contract: C-519 Durable asset jobs and batch execution

import {
  ASSET_BATCH_JOB_RECIPES,
  GENERATION_PROVIDER_PROFILES,
  type GenerationProviderProfile,
} from '@aikami/constants';
import type {
  AssetBrief,
  GenerationBudget,
  GenerationPlan,
  GenerationPlanBlocker,
  GenerationPlanItem,
  GenerationPlanWarning,
  GenerationRunLock,
  GenerationRunLockProvider,
} from '@aikami/types';
import { sha256Hex } from './generated_asset.ts';
import { enforceGenerationBudget, resolveBudget } from './generation_job_state.ts';
import {
  computeEffectiveSpecHash,
  type EffectiveSpecOverrides,
  makeJobId,
  makeRequestKey,
  makeRunId,
  seedForAttempt,
} from './generation_spec.ts';
import { getRecipe } from './recipes/recipe_registry.ts';

/** One brief reference resolved (or not) to verified bytes. */
export type ReferenceResolution = {
  readonly referenceId: string;
  readonly status: 'resolved' | 'unresolved';
  /** Present only when bytes were actually read and hashed. */
  readonly sha256?: string;
  readonly bytes?: number;
  readonly sourcePath?: string;
  /** Why it could not be resolved. */
  readonly reason?: string;
};

/** The host's reference resolver — filesystem/network live here, not in the core. */
export type ReferenceResolver = (
  reference: AssetBrief['references'][number],
) => Promise<ReferenceResolution>;

/** One provider preference group resolved to a concrete profile. */
export type ProviderResolution = {
  readonly preferenceGroup: string;
  readonly profile: GenerationProviderProfile;
  readonly blocker?: GenerationPlanBlocker;
};

/** Options for {@link buildGenerationPlan}. */
export type BuildGenerationPlanOptions = {
  readonly brief: AssetBrief;
  readonly briefPath: string;
  /** SHA-256 of the brief bytes as they were read. Falls back to the parsed JSON. */
  readonly briefSha256?: string;
  readonly phase: 'slice' | 'expansion';
  readonly resolveReference: ReferenceResolver;
  /** Profile ids reachable on this host. Defaults to the declared registry. */
  readonly availableProfiles?: readonly string[];
  /** Ceiling overrides (the CLI's documented budget flags). */
  readonly budgetOverrides?: Partial<GenerationBudget>;
  /** An explicit new variation for one item: bumps attempt/seed. */
  readonly variation?: { readonly itemId: string; readonly attempt: number };
  /** Force a provider profile, e.g. to demonstrate a hosted budget refusal. */
  readonly forcedProviderProfileId?: string;
  /** Brief item ids already satisfied in the store (dependency checks). */
  readonly satisfiedItemIds?: readonly string[];
  /** Restrict planning to one brief item id. */
  readonly onlyItemId?: string;
};

/** The declared profile ids a host can reach out of the box. */
const declaredAvailableProfiles = (): readonly string[] =>
  Object.values(GENERATION_PROVIDER_PROFILES)
    .filter((profile) => profile.mode !== 'unavailable')
    .map((profile) => profile.id);

/** Reads a reference out of the brief, or undefined. */
const findReference = (
  brief: AssetBrief,
  referenceId: string,
): AssetBrief['references'][number] | undefined =>
  brief.references.find((reference) => reference.id === referenceId);

/**
 * Resolves one job's provider preference group.
 *
 * The group's declared order *is* the fallback order
 * (`providerFallbackPolicy: explicit_only`), so the first entry usable on this
 * host wins. Anything else — an absent group, no usable entry, an
 * experimental provider that is not enabled — becomes a structured blocker.
 */
export const resolveProviderGroup = (options: {
  brief: AssetBrief;
  preferenceGroup: string;
  availableProfiles: readonly string[];
  forcedProviderProfileId?: string;
}): ProviderResolution | undefined => {
  const groupIds = options.forcedProviderProfileId
    ? [options.forcedProviderProfileId]
    : options.brief.providerPreferences[options.preferenceGroup];
  const firstProfileId = groupIds?.[0];

  if (groupIds === undefined || groupIds.length === 0 || firstProfileId === undefined) {
    return undefined;
  }

  const firstProfile = GENERATION_PROVIDER_PROFILES[firstProfileId];
  if (options.forcedProviderProfileId && !firstProfile) {
    return undefined;
  }

  const experimental = new Map(
    options.brief.experimentalProviders.map((provider) => [provider.id, provider]),
  );

  for (const profileId of groupIds) {
    const profile = GENERATION_PROVIDER_PROFILES[profileId];
    if (!profile) {
      continue;
    }
    const experimentalEntry = experimental.get(profileId);
    if (experimentalEntry && experimentalEntry.defaultEnabled === false) {
      return {
        preferenceGroup: options.preferenceGroup,
        profile,
        blocker: {
          code: 'experimental_provider_disabled',
          providerProfileId: profileId,
          message: `Provider "${profileId}" is declared experimental and not enabled: ${experimentalEntry.requires.join('; ')}.`,
        },
      };
    }
    if (profile.mode === 'unavailable' || !options.availableProfiles.includes(profileId)) {
      continue;
    }
    if (profile.mode === 'import') {
      return {
        preferenceGroup: options.preferenceGroup,
        profile,
        blocker: {
          code: 'provider_requires_import',
          providerProfileId: profileId,
          message: `Provider group "${options.preferenceGroup}" resolves only to "${profileId}", which needs bytes supplied out of band. C-519 ships no import path — supply the bytes and register them instead.`,
        },
      };
    }
    return { preferenceGroup: options.preferenceGroup, profile };
  }

  const fallbackProfile = GENERATION_PROVIDER_PROFILES[firstProfileId];
  if (!fallbackProfile) {
    return undefined;
  }
  return {
    preferenceGroup: options.preferenceGroup,
    profile: fallbackProfile,
    blocker: {
      code: 'provider_unavailable',
      providerProfileId: firstProfileId,
      message: `None of the profiles declared for "${options.preferenceGroup}" (${groupIds.join(
        ', ',
      )}) is available on this host.`,
    },
  };
};

/** The recipe-derived per-run overrides for one brief job. */
const overridesForJob = (job: AssetBrief['jobs'][number]): EffectiveSpecOverrides => {
  if (job.audio === null) {
    return {};
  }
  return {
    durationSeconds: job.audio.durationSeconds,
    ...(job.audio.requestedBpm === null ? {} : { bpm: job.audio.requestedBpm }),
    ...(job.audio.requestedKey === null ? {} : { key: job.audio.requestedKey }),
    instrumental: job.audio.instrumental,
  };
};

/** The pixel cost of one image job (its declared canvas, else the recipe default). */
const pixelsForJob = (options: {
  job: AssetBrief['jobs'][number];
  defaultWidth: number;
  defaultHeight: number;
}): number => {
  const [width, height] = options.job.targetCanvas ?? [options.defaultWidth, options.defaultHeight];
  return width * height;
};

/** The provider entry the run lock records for one resolution. */
const providerLockEntry = (options: {
  resolution: ProviderResolution;
  recipeId?: string;
  engineId?: string;
  model?: string;
}): GenerationRunLockProvider => ({
  preferenceGroup: options.resolution.preferenceGroup,
  profileId: options.resolution.profile.id,
  mode: options.resolution.profile.mode,
  ...(options.engineId === undefined ? {} : { engineId: options.engineId }),
  ...(options.model === undefined ? {} : { model: options.model }),
  ...(options.recipeId === undefined ? {} : { recipeId: options.recipeId }),
  processor: `local-ai:recipe-pipeline@${options.recipeId ?? 'unknown'}`,
});

/**
 * Derives the plan for one phase.
 *
 * `--plan` calls exactly this and nothing else: the resolver is the only thing
 * that may touch the disk, so the caller passes a recording resolver when the
 * absence of side effects is under test.
 */
export const buildGenerationPlan = async (
  options: BuildGenerationPlanOptions,
): Promise<GenerationPlan> => {
  const { brief } = options;
  const budget = resolveBudget({ brief, overrides: options.budgetOverrides });
  const availableProfiles = options.availableProfiles ?? declaredAvailableProfiles();
  const runId = makeRunId({ briefId: brief.id, phase: options.phase });

  const briefSha256 =
    options.briefSha256 ?? (await sha256Hex(new TextEncoder().encode(JSON.stringify(brief))));

  // Resolve every declared reference once — the run lock describes the whole
  // brief, not only the phase being planned.
  const resolutions = new Map<string, ReferenceResolution>();
  for (const reference of brief.references) {
    resolutions.set(reference.id, await options.resolveReference(reference));
  }

  const phaseJobs = brief.jobs.filter(
    (job) =>
      job.phase === options.phase &&
      (options.onlyItemId === undefined || job.id === options.onlyItemId),
  );
  const phaseItemIds = new Set(phaseJobs.map((job) => job.id));
  const satisfied = new Set(options.satisfiedItemIds ?? []);

  const blockers: GenerationPlanBlocker[] = [];
  const warnings: GenerationPlanWarning[] = [];
  const providerResolutions = new Map<
    string,
    { resolution: ProviderResolution; recipeId?: string; engineId?: string; model?: string }
  >();
  const items: GenerationPlanItem[] = [];

  const progress = {
    itemCandidateCount: 0,
    runCandidateCount: 0,
    runSpendUsd: 0,
    runDurationSeconds: 0,
    runPixels: 0,
    runRetainedBytes: 0,
  };

  const declaredSliceCount = brief.jobs.filter((job) => job.phase === 'slice').length;
  const declaredExpansionCount = brief.jobs.filter((job) => job.phase === 'expansion').length;
  if (brief.summary.sliceItems !== declaredSliceCount) {
    warnings.push({
      code: 'brief_summary_mismatch',
      message: `The brief's summary.sliceItems is ${brief.summary.sliceItems} but it declares ${declaredSliceCount} slice jobs.`,
    });
  }
  if (brief.summary.expansionItems !== declaredExpansionCount) {
    warnings.push({
      code: 'brief_summary_mismatch',
      message: `The brief's summary.expansionItems is ${brief.summary.expansionItems} but it declares ${declaredExpansionCount} expansion jobs.`,
    });
  }

  for (const job of phaseJobs) {
    const itemBlockers: GenerationPlanBlocker[] = [];
    const itemWarnings: GenerationPlanWarning[] = [];

    // 1. Recipe + declared preparation profile.
    const recipeId = ASSET_BATCH_JOB_RECIPES[job.kind];
    const recipe = recipeId === undefined ? undefined : getRecipe(recipeId);
    if (!recipe) {
      itemBlockers.push({
        code: 'unsupported_job_kind',
        itemId: job.id,
        message: `Job kind "${job.kind}" has no shipped recipe.`,
      });
    }
    if (brief.preparationProfiles[job.preparationProfile] === undefined) {
      itemBlockers.push({
        code: 'unsupported_preparation_profile',
        itemId: job.id,
        message: `Preparation profile "${job.preparationProfile}" is not declared by the brief.`,
      });
    }

    // 2. References — required and unresolved is a blocker, optional a warning.
    const referenceHashes: Record<string, string> = {};
    for (const referenceId of job.referenceIds) {
      const reference = findReference(brief, referenceId);
      if (!reference) {
        itemBlockers.push({
          code: 'unresolved_required_reference',
          itemId: job.id,
          referenceId,
          message: `Reference "${referenceId}" is used by job "${job.id}" but not declared by the brief.`,
        });
        continue;
      }
      const resolution = resolutions.get(referenceId);
      if (resolution?.status === 'resolved' && resolution.sha256 !== undefined) {
        referenceHashes[referenceId] = resolution.sha256;
        continue;
      }
      const message = `Reference "${referenceId}" (${reference.kind}) has no verified bytes: ${
        resolution?.reason ?? 'unresolved'
      }`;
      if (reference.resolution === 'required') {
        itemBlockers.push({
          code: 'unresolved_required_reference',
          itemId: job.id,
          referenceId,
          message,
        });
      } else {
        itemWarnings.push({
          code: 'unresolved_optional_reference',
          itemId: job.id,
          referenceId,
          message,
        });
      }
    }

    // 3. Provider group (resolved once per group-and-recipe pair). A shared
    // provider may serve jobs whose recipes pin different models/engines.
    const providerResolutionKey = JSON.stringify([job.providerPreference, recipeId]);
    let providerEntry = providerResolutions.get(providerResolutionKey);
    if (!providerEntry) {
      const resolution = resolveProviderGroup({
        brief,
        preferenceGroup: job.providerPreference,
        availableProfiles,
        ...(options.forcedProviderProfileId === undefined
          ? {}
          : { forcedProviderProfileId: options.forcedProviderProfileId }),
      });
      if (resolution) {
        providerEntry = {
          resolution,
          ...(recipeId === undefined ? {} : { recipeId }),
          ...(resolution.profile.engineId === undefined
            ? {}
            : { engineId: resolution.profile.engineId }),
          ...(recipe?.model === undefined ? {} : { model: recipe.model }),
        };
        providerResolutions.set(providerResolutionKey, providerEntry);
      }
    }
    if (!providerEntry) {
      if (options.forcedProviderProfileId !== undefined) {
        itemBlockers.push({
          code: 'provider_unavailable',
          itemId: job.id,
          providerProfileId: options.forcedProviderProfileId,
          message: `The explicit --provider profile "${options.forcedProviderProfileId}" is not declared in the provider registry.`,
        });
      } else {
        itemBlockers.push({
          code: 'unknown_provider_preference',
          itemId: job.id,
          message: `Job "${job.id}" names the provider group "${job.providerPreference}", which the brief does not declare.`,
        });
      }
    } else if (providerEntry.resolution.blocker) {
      itemBlockers.push({ ...providerEntry.resolution.blocker, itemId: job.id });
    }
    const provider = providerEntry?.resolution;

    // 4. Dependencies declared by another phase (or not yet satisfied).
    for (const dependency of job.dependsOn) {
      if (!phaseItemIds.has(dependency) && !satisfied.has(dependency)) {
        itemBlockers.push({
          code: 'dependency_not_satisfied',
          itemId: job.id,
          message: `Dependency "${dependency}" is not part of the ${options.phase} phase and is not satisfied in the run store.`,
        });
      }
    }

    // 5. Identity.
    const attempt = options.variation?.itemId === job.id ? options.variation.attempt : 1;
    const overrides = overridesForJob(job);
    const estimatedPixels =
      job.audio === null
        ? pixelsForJob({
            job,
            defaultWidth: recipe?.defaults?.width ?? 512,
            defaultHeight: recipe?.defaults?.height ?? 512,
          })
        : 0;
    const estimatedDurationSeconds = job.audio?.durationSeconds ?? 0;

    const specInput = {
      briefId: brief.id,
      itemId: job.id,
      recipeId: recipeId ?? `unknown:${job.kind}`,
      engineId: provider?.profile.engineId ?? recipe?.engine ?? 'sdcpp',
      providerProfileId: provider?.profile.id ?? job.providerPreference,
      providerMode: provider?.profile.mode ?? 'unavailable',
      preparationProfile: job.preparationProfile,
      prompt: job.subject,
      referenceHashes,
      attempt,
      seed: 0,
      overrides,
    };
    const provisionalHash = await computeEffectiveSpecHash(specInput);
    const seed = seedForAttempt({ specHash: provisionalHash, attempt });
    const effectiveSpecHash = await computeEffectiveSpecHash({ ...specInput, seed });
    const jobId = makeJobId({ itemId: job.id, attempt, specHash: effectiveSpecHash });
    const requestKey = makeRequestKey({ runId, itemId: job.id, attempt });

    // 6. Budget ceilings, accumulated in plan order.
    if (itemBlockers.length === 0 && provider) {
      progress.itemCandidateCount = 0;
      const refusal = enforceGenerationBudget({
        budget,
        progress,
        cost: {
          providerProfileId: provider.profile.id,
          providerMode: provider.profile.mode,
          estimatedSpendUsdPerCandidate: provider.profile.estimatedSpendUsdPerCandidate,
          itemCandidateLimit: job.candidateLimit,
          attempt,
          estimatedDurationSeconds,
          estimatedPixels,
          // Unknown before generation — the runner re-checks retained bytes
          // against the bytes actually written.
          estimatedRetainedBytes: 0,
        },
        itemId: job.id,
      });
      if (refusal) {
        itemBlockers.push(refusal);
      } else {
        progress.runCandidateCount += 1;
        progress.runPixels += estimatedPixels;
        progress.runDurationSeconds += estimatedDurationSeconds;
        progress.runSpendUsd += provider.profile.estimatedSpendUsdPerCandidate;
      }
      if (provider.profile.requiresRightsDecision) {
        itemWarnings.push({
          code: 'rights_decision_open',
          itemId: job.id,
          providerProfileId: provider.profile.id,
          message: `The intended-use/rights decision for "${provider.profile.id}" is still open — it gates publication, not local generation.`,
        });
      }
    }

    blockers.push(...itemBlockers);
    warnings.push(...itemWarnings);

    items.push({
      jobId,
      itemId: job.id,
      requestKey,
      effectiveSpecHash,
      phase: job.phase,
      recipeId: recipeId ?? `unknown:${job.kind}`,
      prompt: job.subject,
      providerProfileId: provider?.profile.id ?? job.providerPreference,
      providerMode: provider?.profile.mode ?? 'unavailable',
      // The profile decides the provider (and therefore the transport); the
      // recipe decides the pipeline. A profile with no engine (hosted/import)
      // falls back to the recipe's declared engine for lock-reporting only.
      ...(provider?.profile.engineId === undefined && recipe?.engine === undefined
        ? {}
        : { providerEngineId: provider?.profile.engineId ?? recipe?.engine }),
      preparationProfile: job.preparationProfile,
      referenceIds: [...job.referenceIds],
      referenceHashes,
      attempt,
      seed,
      candidateLimit: Math.min(job.candidateLimit, budget.candidateLimitPerItem),
      dependsOn: [...job.dependsOn],
      estimatedDurationSeconds,
      estimatedPixels,
      dispatchable: itemBlockers.length === 0,
      blockers: itemBlockers,
    });
  }

  const dispatchableItems = items.filter((item) => item.dispatchable).length;

  return {
    schemaVersion: 1,
    kind: 'generation-plan',
    briefId: brief.id,
    briefPath: options.briefPath,
    briefSha256,
    phase: options.phase,
    sliceItems: brief.summary.sliceItems,
    expansionItems: brief.summary.expansionItems,
    totalItems: brief.summary.totalItems,
    plannedItems: items.length,
    dispatchableItems,
    blockedItems: items.length - dispatchableItems,
    budget,
    items,
    blockers,
    warnings,
    references: brief.references.map((reference) => {
      const resolution = resolutions.get(reference.id);
      return {
        id: reference.id,
        kind: reference.kind,
        locator: reference.locator,
        resolution: reference.resolution,
        status: resolution?.status ?? 'unresolved',
        ...(resolution?.sha256 === undefined ? {} : { sha256: resolution.sha256 }),
        ...(resolution?.bytes === undefined ? {} : { bytes: resolution.bytes }),
        ...(resolution?.sourcePath === undefined ? {} : { sourcePath: resolution.sourcePath }),
        ...(resolution?.reason === undefined ? {} : { reason: resolution.reason }),
      };
    }),
    providers: [...providerResolutions.values()]
      .filter((entry) => entry.resolution.blocker === undefined)
      .map((entry) =>
        providerLockEntry({
          resolution: entry.resolution,
          ...(entry.recipeId === undefined ? {} : { recipeId: entry.recipeId }),
          ...(entry.engineId === undefined ? {} : { engineId: entry.engineId }),
          ...(entry.model === undefined ? {} : { model: entry.model }),
        }),
      ),
  };
};

/**
 * The immutable run lock derived from a plan.
 *
 * Written once per run: it pins the provider profiles, recipes, declared
 * models and verified reference hashes the run is bound to, and it never
 * invents a revision hash for a model the host cannot fingerprint.
 */
export const buildGenerationRunLock = (options: {
  plan: GenerationPlan;
  runId: string;
  createdAt: string;
}): GenerationRunLock => ({
  schemaVersion: 1,
  runId: options.runId,
  briefId: options.plan.briefId,
  briefPath: options.plan.briefPath,
  briefSha256: options.plan.briefSha256,
  phase: options.plan.phase,
  createdAt: options.createdAt,
  budget: options.plan.budget,
  references: options.plan.references,
  providers: options.plan.providers,
});
