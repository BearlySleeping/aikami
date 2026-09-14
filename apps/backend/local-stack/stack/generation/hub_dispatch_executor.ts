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
// Contract: C-522 Hub and client access to the generation runner

import { GENERATION_PLAN_SCHEMA_VERSION } from '@aikami/schemas';
import type {
  GenerationDispatch,
  GenerationJobRecord,
  GenerationJobStatus,
  GenerationPlan,
  GenerationPlanItem,
} from '@aikami/types';
import type { GenerationStorePaths } from './job_store.ts';
import { type BatchExecutionResult, executeBatch } from './runner.ts';
import type { BatchEngineFactory } from './runner_engine.ts';

/**
 * Project one Hub dispatch into a one-item C-519 plan.
 *
 * Everything the plan needs that a dispatch does not carry is either derived
 * from the dispatch itself (`briefId`/`briefSha256` are the dispatch's own
 * identity, so a re-dispatch of the same locked request lands on the same run)
 * or stated as "known to be zero" — a single-item run has no expansion phase
 * and no cross-item dependencies.
 */
export const planFromDispatch = (dispatch: GenerationDispatch): GenerationPlan => {
  const { spec } = dispatch;
  const item: GenerationPlanItem = {
    jobId: dispatch.jobId,
    itemId: spec.itemId,
    requestKey: dispatch.requestKey,
    effectiveSpecHash: dispatch.effectiveSpecHash,
    phase: 'slice',
    recipeId: spec.recipeId,
    prompt: spec.prompt,
    providerProfileId: spec.providerProfileId,
    // A dispatch only ever names a local or import profile: the Hub never
    // chooses a hosted provider on the creator's behalf.
    providerMode: 'local',
    preparationProfile: spec.preparationProfile,
    referenceIds: [...spec.referenceIds],
    // Reference *hashes* are resolved locally by the run's own resolver; the
    // Hub never receives or supplies artifact bytes at dispatch time.
    referenceHashes: {},
    attempt: dispatch.attempt,
    seed: spec.seed,
    candidateLimit: spec.candidateLimit,
    dependsOn: [],
    estimatedDurationSeconds: 0,
    estimatedPixels: 0,
    dispatchable: true,
    blockers: [],
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
    dispatchableItems: 1,
    blockedItems: 0,
    budget: spec.budget,
    items: [item],
    blockers: [],
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
  /** Test seam — the real `executeBatch`. */
  execute?: (options: {
    paths: GenerationStorePaths;
    plan: GenerationPlan;
    engineFactory: BatchEngineFactory;
  }) => Promise<BatchExecutionResult>;
  /** Root an owned/licensed import locator must stay inside (C-521). */
  audioImportRoot?: string;
};

/** Map a batch execution result onto the single job the Hub asked about. */
const outcomeFrom = (
  result: BatchExecutionResult,
  dispatch: GenerationDispatch,
  now: Date,
): HubDispatchOutcome => {
  const report = result.jobs.find((job) => job.jobId === dispatch.jobId);
  if (!report) {
    return {
      status: 'failed',
      candidateCount: 0,
      failure: {
        code: 'engine_dispatch_failed',
        message: 'the local runner produced no report for this dispatch',
        at: now.toISOString(),
      },
    };
  }
  return {
    status: report.status,
    candidateCount: report.status === 'awaiting_review' || report.status === 'succeeded' ? 1 : 0,
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
