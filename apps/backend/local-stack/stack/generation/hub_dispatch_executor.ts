// apps/backend/local-stack/stack/generation/hub_dispatch_executor.ts
//
// C-522 — bridging a Hub dispatch onto the C-519 durable runner.
//
// A Hub dispatch *is* a one-item run: it carries the same job identity
// (`jobId`/`requestKey`/`effectiveSpecHash`/`attempt`), the same allowlisted
// recipe/profile/reference ids and the same `GenerationBudget`. So rather than
// grow a second generation path, this module projects the dispatch into a
// `GenerationPlan` and hands it to the existing `executeBatch`. The Hub adds
// routing, pairing and fencing; it does not add a runner.
//
// The Hub is the authority for *who owns which pending job*. This machine stays
// the authority for its own bytes: a revoked credential or an expired lease
// stops new work and Hub-side retrieval, and never deletes a local result.
//
// Stated limitation: a Hub dispatch performs no C-520 image preparation. That is
// exactly the CLI's supported "no `--preparation-profile`" configuration, not a
// second generation path — C-520 preparation is a CLI-run concern selected by
// that flag, and the `preparationProfile` on the item is the *brief's* key
// (which drives audio renditions and lineage), not the flag's workflow id.
// Audio preparation is unaffected: `prepareAudioCandidate` runs for every audio
// job and takes the item's `preparationProfile` directly.
//
// Contract: C-522 Hub and client access to the generation runner

import { GENERATION_PROVIDER_PROFILES, type GenerationProviderProfile } from '@aikami/constants';
import { getRecipe } from '@aikami/local-ai';
import { GENERATION_PLAN_SCHEMA_VERSION, releasesLease } from '@aikami/schemas';
import type {
  GenerationDispatch,
  GenerationJobRecord,
  GenerationJobStatus,
  GenerationPlan,
  GenerationPlanBlocker,
  GenerationPlanItem,
} from '@aikami/types';
import type { GenerationStorePaths } from './job_store.ts';
import { type BatchExecutionResult, type ExecuteBatchOptions, executeBatch } from './runner.ts';
import type { BatchEngineFactory } from './runner_engine.ts';

/**
 * The provider profile a dispatch names, when the registry declares it.
 *
 * The registry is the authority, not the dispatch: a dispatch can name any
 * string, and a string that resolves to nothing must become a typed blocker
 * rather than a fabricated `local` capability.
 */
const profileForDispatch = (dispatch: GenerationDispatch): GenerationProviderProfile | undefined =>
  GENERATION_PROVIDER_PROFILES[dispatch.spec.providerProfileId];

/**
 * The blocker for a dispatch whose profile cannot run on this machine.
 *
 * 🔴 A dispatch that cannot dispatch must SAY so. The alternative is what this
 * replaces: the item was marked `dispatchable: true` with no blockers, the
 * runner then refused it with `provider_unavailable` after creating a fresh
 * `queued` job record, and the Hub reported that back as `queued` — a dispatch
 * that could never be claimed, with no reason shown to the creator.
 *
 * @returns The blocker, or `undefined` when the profile can run locally.
 */
const profileBlocker = (
  dispatch: GenerationDispatch,
  profile: GenerationProviderProfile | undefined,
): GenerationPlanBlocker | undefined => {
  const named = dispatch.spec.providerProfileId;
  const itemId = dispatch.spec.itemId;
  if (profile === undefined) {
    return {
      code: 'unknown_provider_preference',
      message: `This dispatch names the provider profile "${named}", which is not a registered profile. Re-submit it with a profile the runner can resolve.`,
      itemId,
      providerProfileId: named,
    };
  }
  switch (profile.mode) {
    case 'local':
      return undefined;
    case 'unavailable':
      return {
        code: 'provider_unavailable',
        message: `The provider profile "${named}" is declared unavailable: ${profile.note}`,
        itemId,
        providerProfileId: named,
      };
    case 'import':
      // A Hub dispatch carries no locator for the out-of-band bytes, and the
      // Hub never receives artifact bytes at dispatch time.
      return {
        code: 'import_source_unavailable',
        message: `The provider profile "${named}" resolves only to an out-of-band import, and this dispatch carries no locator for it.`,
        itemId,
        providerProfileId: named,
      };
    case 'hosted':
      // The Hub never chooses a hosted provider — and never spends — on the
      // creator's behalf, so a dispatch naming one is refused by name.
      return {
        code: 'provider_unavailable',
        message: `The provider profile "${named}" is hosted; the Hub never selects a hosted provider on the creator's behalf.`,
        itemId,
        providerProfileId: named,
      };
  }
};

/**
 * Project one Hub dispatch into a one-item C-519 plan.
 *
 * Everything the plan needs that a dispatch does not carry is either derived
 * from the dispatch itself (`briefId`/`briefSha256` are the dispatch's own
 * identity, so a re-dispatch of the same locked request lands on the same run)
 * or stated as "known to be zero" — a single-item run has no expansion phase
 * and no cross-item dependencies.
 *
 * 🔴 The provider half is RESOLVED from the registry, exactly as the C-519 CLI's
 * plan core resolves it (`providerMode` and `providerEngineId` from the profile,
 * falling back to the recipe's engine). Claiming `local` for a profile this
 * module never looked up is how a dispatch naming an unregistered profile
 * reached the runner looking dispatchable.
 */
export const planFromDispatch = (dispatch: GenerationDispatch): GenerationPlan => {
  const { spec } = dispatch;
  const profile = profileForDispatch(dispatch);
  const blocker = profileBlocker(dispatch, profile);
  const recipeEngine = getRecipe(spec.recipeId)?.engine;
  const providerEngineId = profile?.engineId ?? recipeEngine;
  const item: GenerationPlanItem = {
    jobId: dispatch.jobId,
    itemId: spec.itemId,
    requestKey: dispatch.requestKey,
    effectiveSpecHash: dispatch.effectiveSpecHash,
    phase: 'slice',
    recipeId: spec.recipeId,
    prompt: spec.prompt,
    providerProfileId: spec.providerProfileId,
    providerMode: profile?.mode ?? 'unavailable',
    // Omitted only when neither the profile nor the recipe names an engine, so a
    // hosted/import profile reports no transport to dial.
    ...(providerEngineId === undefined ? {} : { providerEngineId }),
    preparationProfile: spec.preparationProfile,
    referenceIds: [...spec.referenceIds],
    // Reference *hashes* are resolved locally by the run's own resolver; the Hub
    // never receives or supplies artifact bytes at dispatch time.
    referenceHashes: {},
    attempt: dispatch.attempt,
    seed: spec.seed,
    candidateLimit: spec.candidateLimit,
    dependsOn: [],
    estimatedDurationSeconds: 0,
    estimatedPixels: 0,
    dispatchable: blocker === undefined,
    blockers: blocker === undefined ? [] : [blocker],
  };
  return {
    schemaVersion: GENERATION_PLAN_SCHEMA_VERSION,
    kind: 'generation-plan',
    briefId: `hub:${dispatch.dispatchId}`,
    briefPath: `hub:${dispatch.dispatchId}`,
    briefSha256: dispatch.effectiveSpecHash,
    phase: 'slice',
    sliceItems: 1,
    expansionItems: 0,
    totalItems: 1,
    plannedItems: 1,
    dispatchableItems: blocker === undefined ? 1 : 0,
    blockedItems: blocker === undefined ? 0 : 1,
    budget: spec.budget,
    items: [item],
    blockers: blocker === undefined ? [] : [blocker],
    warnings: [],
    references: [],
    providers: [],
  };
};

/** What one executed dispatch produced, in the terms the Hub then reports. */
export type HubDispatchOutcome = {
  status: GenerationJobStatus;
  candidateCount: number;
  candidateId?: string;
  preparedHash?: string;
  failure?: { code: string; message: string; at: string };
};

/** Options for {@link createHubDispatchExecutor}. */
export type HubDispatchExecutorOptions = {
  /** Where this run's durable store lives — derived per dispatch. */
  pathsFor: (dispatch: GenerationDispatch) => GenerationStorePaths;
  engineFactory: BatchEngineFactory;
  /** Injected clock, so tests are deterministic. */
  now?: () => Date;
  /** Test seam — the real `executeBatch`, typed to its full option surface. */
  execute?: (options: ExecuteBatchOptions) => Promise<BatchExecutionResult>;
  /** Root an owned/licensed import locator must stay inside (C-521). */
  audioImportRoot?: string;
};

/**
 * Map a batch execution result onto the single job the Hub asked about.
 *
 * 🔴 The outcome the Hub is sent MUST release the lease, or the dispatch is
 * stranded. A blocked plan leaves a fresh job record at `queued` (C-519's
 * deliberate semantics), and echoing that status back made the Hub write
 * `queued` over `running` while KEEPING the lease — and `findClaimable` requires
 * a *released* lease, so the dispatch could never be claimed again while showing
 * no failure at all. Every blocked plan hit this, not just an unknown profile.
 *
 * So a blocker is reported as a terminal `failed` with the blocker's own code,
 * and any status that would not release the lease is converted to one that does
 * — that is the defect class, not the single instance.
 */
const outcomeFrom = (
  result: BatchExecutionResult,
  dispatch: GenerationDispatch,
  now: Date,
): HubDispatchOutcome => {
  const at = now.toISOString();
  const report = result.jobs.find((job) => job.jobId === dispatch.jobId);
  if (!report) {
    return {
      status: 'failed',
      candidateCount: 0,
      failure: {
        code: 'engine_dispatch_failed',
        message: 'the local runner produced no report for this dispatch',
        at,
      },
    };
  }
  const candidateCount =
    report.status === 'awaiting_review' || report.status === 'succeeded' ? 1 : 0;
  // This dispatch's own blocker first, then any plan-level one: both mean the
  // job did not run, and the Hub must hear why rather than "still queued".
  const blocker =
    result.blockers.find((entry) => entry.itemId === dispatch.spec.itemId) ?? result.blockers[0];
  if (blocker !== undefined) {
    return {
      status: 'failed',
      candidateCount,
      ...(report.candidateId === undefined ? {} : { candidateId: report.candidateId }),
      ...(report.preparedHash === undefined ? {} : { preparedHash: report.preparedHash }),
      // The report's own failure names the engine-level cause when there is one;
      // the blocker names why the item was never dispatched.
      failure: report.failure ?? { code: blocker.code, message: blocker.message, at },
    };
  }
  if (!releasesLease(report.status)) {
    // No blocker, no failure, and yet not finished: the honest report is that
    // the run did not complete, because reporting the status verbatim would
    // leave the lease held and the dispatch unclaimable.
    return {
      status: 'failed',
      candidateCount,
      ...(report.candidateId === undefined ? {} : { candidateId: report.candidateId }),
      ...(report.preparedHash === undefined ? {} : { preparedHash: report.preparedHash }),
      failure: report.failure ?? {
        code: 'engine_dispatch_failed',
        message: `the local runner finished with the non-terminal status "${report.status}"`,
        at,
      },
    };
  }
  return {
    status: report.status,
    candidateCount,
    ...(report.candidateId === undefined ? {} : { candidateId: report.candidateId }),
    ...(report.preparedHash === undefined ? {} : { preparedHash: report.preparedHash }),
    ...(report.failure === undefined ? {} : { failure: report.failure }),
  };
};

/**
 * Builds the executor the runner loop calls for a claimed dispatch.
 *
 * A refusal (no engine for this profile, an unreachable provider) is returned
 * as a `failed` outcome with the runner's own structured code, so the Hub learns
 * *why* instead of watching a job sit in `running` until its lease expires.
 */
export const createHubDispatchExecutor = (options: HubDispatchExecutorOptions) => {
  const now = options.now ?? (() => new Date());
  const execute = options.execute ?? executeBatch;

  return async (dispatch: GenerationDispatch): Promise<HubDispatchOutcome> => {
    const paths = options.pathsFor(dispatch);
    try {
      const result = await execute({
        paths,
        plan: planFromDispatch(dispatch),
        engineFactory: options.engineFactory,
        // The injected clock is forwarded so an injected executor observes the
        // complete options and `executeBatch` uses the configured clock.
        now,
        ...(options.audioImportRoot === undefined
          ? {}
          : { audioImportRoot: options.audioImportRoot }),
      });
      return outcomeFrom(result, dispatch, now());
    } catch (error) {
      // The durable store keeps whatever the failed attempt left behind; the
      // Hub is told the job failed, not that it is still running.
      return {
        status: 'failed',
        candidateCount: 0,
        failure: {
          code: 'engine_dispatch_failed',
          message: error instanceof Error ? error.message : String(error),
          at: now().toISOString(),
        },
      };
    }
  };
};

/** The executor surface. */
export type HubDispatchExecutor = ReturnType<typeof createHubDispatchExecutor>;

/** One durable record the executor may want to read back after a run. */
export type HubDispatchRecordReader = (dispatch: GenerationDispatch) => {
  record?: GenerationJobRecord;
};
