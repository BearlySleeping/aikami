// packages/shared/local-ai/src/lib/generation_job_state.ts
//
// C-519: the portable job protocol — the state machine, the budget ceilings
// and the duplicate/variation decision.
//
// It is pure: no clock, no filesystem, no process identity. The host runner
// supplies the timestamp and the persisted records, so the same rules can be
// replayed in a test or inside a future client/Hub front door.
//
// Two rules carry most of the weight:
//
//   1. `reconciliation_required` exists because an AbortSignal stops *waiting*,
//      not GPU execution. A submission that timed out with no native handle
//      recorded must never be retried automatically — it may be paid and
//      running.
//   2. Cancellation is two facts (`requested`, `confirmed`). An engine that
//      reports `capabilities.cancel === false` can only ever produce the first.
//
// Contract: C-519 Durable asset jobs and batch execution
/** biome-ignore-all lint/style/useNamingConvention: transition-table keys are the job status vocabulary (snake_case by contract), not identifiers */

import { DEFAULT_GENERATION_BUDGET } from '@aikami/constants';
import type {
  AssetBrief,
  GenerationBudget,
  GenerationJobCancellation,
  GenerationJobRecord,
  GenerationJobStatus,
  GenerationPlanBlocker,
  GenerationPlanItem,
  GenerationProviderMode,
} from '@aikami/types';

/** Every job status, in lifecycle order. */
export const GENERATION_JOB_STATUSES: readonly GenerationJobStatus[] = [
  'planned',
  'queued',
  'running',
  'preparing',
  'awaiting_review',
  'succeeded',
  'failed',
  'interrupted',
  'cancelled',
  'reconciliation_required',
];

/** The statuses a job can reach when nothing goes wrong. */
export const GENERATION_JOB_HAPPY_PATH: readonly GenerationJobStatus[] = [
  'planned',
  'queued',
  'running',
  'preparing',
  'awaiting_review',
  'succeeded',
];

/**
 * Legal transitions.
 *
 * `succeeded` and `cancelled` are terminal. `failed` and `interrupted` may be
 * re-queued — but only explicitly (`--resume`), never by an automatic retry.
 * `reconciliation_required` may only leave once a native handle has been
 * resolved.
 */
export const GENERATION_JOB_TRANSITIONS: Readonly<
  Record<GenerationJobStatus, readonly GenerationJobStatus[]>
> = {
  planned: ['queued', 'failed', 'cancelled'],
  queued: ['running', 'reconciliation_required', 'failed', 'cancelled'],
  running: ['preparing', 'interrupted', 'reconciliation_required', 'failed', 'cancelled'],
  preparing: ['awaiting_review', 'interrupted', 'reconciliation_required', 'failed', 'cancelled'],
  awaiting_review: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: ['queued', 'cancelled'],
  interrupted: ['queued', 'reconciliation_required', 'cancelled'],
  cancelled: [],
  reconciliation_required: ['queued', 'failed', 'cancelled'],
};

/** True when a job has a candidate and cannot be dispatched again. */
export const hasCandidateResult = (status: GenerationJobStatus): boolean =>
  status === 'awaiting_review' || status === 'succeeded';

/** True when the status ends the automatic lifecycle. */
export const isTerminalJobStatus = (status: GenerationJobStatus): boolean =>
  GENERATION_JOB_TRANSITIONS[status].length === 0;

/**
 * True when a job is owned by a *live* attempt.
 *
 * `queued` is deliberately excluded: a queued record has no owner yet (the
 * resource lease decides that), so a second submission may attempt it — and
 * will lose the lease if another process got there first. `running` and
 * `preparing` ARE an owner, and `reconciliation_required` must never be
 * re-dispatched automatically.
 */
export const isClaimedJobStatus = (status: GenerationJobStatus): boolean =>
  status === 'running' || status === 'preparing' || status === 'reconciliation_required';

/** True when a job can be picked up again by `--resume`. */
export const isResumableJobStatus = (status: GenerationJobStatus): boolean =>
  status === 'failed' || status === 'interrupted';

/** Whether the transition is legal. */
export const canTransitionJobStatus = (
  from: GenerationJobStatus,
  to: GenerationJobStatus,
): boolean => GENERATION_JOB_TRANSITIONS[from].includes(to);

/** Builds the `from → to` transition error message. */
const illegalTransitionMessage = (from: GenerationJobStatus, to: GenerationJobStatus): string =>
  `Illegal generation job transition ${from} → ${to} — legal targets: ${
    GENERATION_JOB_TRANSITIONS[from].join(', ') || '(terminal)'
  }`;

/**
 * Applies one transition and appends it to the audit trail.
 *
 * @throws Error when the transition is illegal — a silent state jump would
 *         lose the audit trail that makes a resume auditable.
 */
export const applyJobTransition = (options: {
  job: GenerationJobRecord;
  status: GenerationJobStatus;
  at: string;
  patch?: Partial<GenerationJobRecord>;
  note?: string;
}): GenerationJobRecord => {
  const { job, status } = options;
  if (job.status === status) {
    // Idempotent re-entry (a resumed process re-observing its own state) is a
    // no-op, not an illegal transition.
    return { ...job, ...options.patch, updatedAt: options.at };
  }
  if (!canTransitionJobStatus(job.status, status)) {
    throw new Error(illegalTransitionMessage(job.status, status));
  }
  const entry = { status, at: options.at, note: options.note };
  return {
    ...job,
    ...options.patch,
    status,
    stateHistory: [...job.stateHistory, entry],
    updatedAt: options.at,
  };
};

/**
 * Classifies a submission failure.
 *
 * A request that left the process without a recorded native handle is
 * *uncertain*, not failed: repeating it could pay for a generation twice.
 */
export const classifySubmissionFailure = (options: {
  requestLeftProcess: boolean;
  nativeHandleRecorded: boolean;
  engineReportsCancel: boolean;
  message: string;
  at: string;
}): { status: GenerationJobStatus; failure: GenerationJobRecord['failure'] } => {
  if (options.requestLeftProcess && !options.nativeHandleRecorded) {
    return {
      status: 'reconciliation_required',
      failure: {
        code: 'submission_unconfirmed',
        message: `Submission left the process without a recorded native handle — reconciliation required before any retry. ${options.message}`,
        at: options.at,
      },
    };
  }
  if (options.requestLeftProcess && !options.engineReportsCancel) {
    return {
      status: 'reconciliation_required',
      failure: {
        code: 'cancellation_unconfirmed',
        message: `The provider rejected the request and reports capabilities.cancel === false — the engine may still be computing, so reconciliation is required. ${options.message}`,
        at: options.at,
      },
    };
  }
  return {
    status: 'failed',
    failure: { code: 'generation_failed', message: options.message, at: options.at },
  };
};

/**
 * Builds the split cancellation record.
 *
 * `confirmed` is true only when the provider acknowledged the cancellation
 * itself. Reporting confirmation for a request that was merely *sent* would
 * claim compute stopped when only polling stopped.
 */
export const resolveCancellation = (options: {
  engineReportsCancel: boolean;
  requestedAt: string;
  providerAcknowledged: boolean;
  confirmedAt?: string;
}): GenerationJobCancellation => {
  const confirmed = options.engineReportsCancel && options.providerAcknowledged;
  return {
    requested: true,
    requestedAt: options.requestedAt,
    confirmed,
    ...(confirmed && options.confirmedAt ? { confirmedAt: options.confirmedAt } : {}),
    ...(confirmed
      ? {}
      : {
          reason: options.engineReportsCancel
            ? 'Cancellation request sent; the provider has not acknowledged it yet — compute may still be running.'
            : 'The provider reports capabilities.cancel === false — the cancel request cannot stop compute; only polling stopped.',
        }),
  };
};

/** Candidates/spend already committed by the run when a dispatch is considered. */
export type GenerationRunProgress = {
  readonly itemCandidateCount: number;
  readonly runCandidateCount: number;
  readonly runSpendUsd: number;
  readonly runDurationSeconds: number;
  readonly runPixels: number;
  readonly runRetainedBytes: number;
};

/** What one more dispatch would consume. */
export type GenerationDispatchCost = {
  readonly providerProfileId: string;
  readonly providerMode: GenerationProviderMode;
  readonly estimatedSpendUsdPerCandidate: number;
  readonly itemCandidateLimit: number;
  readonly attempt: number;
  readonly estimatedDurationSeconds: number;
  readonly estimatedPixels: number;
  readonly estimatedRetainedBytes: number;
};

/** Narrows the budget-violation blocker to the field that was violated. */
const budgetBlocker = (options: {
  field: NonNullable<GenerationPlanBlocker['budget']>;
  itemId: string;
  message: string;
}): GenerationPlanBlocker => ({
  code: 'budget_exceeded',
  budget: options.field,
  itemId: options.itemId,
  message: options.message,
});

/**
 * Checks every declared ceiling before dispatch.
 *
 * The *first* violated ceiling is named, so the caller gets an actionable
 * reason (`candidateLimitPerItem`, `hostedBudgetUsd`, `maxDurationSeconds`, …)
 * rather than a generic refusal. Returns `undefined` when the dispatch is
 * authorized.
 */
export const enforceGenerationBudget = (options: {
  budget: GenerationBudget;
  progress: GenerationRunProgress;
  cost: GenerationDispatchCost;
  itemId: string;
}): GenerationPlanBlocker | undefined => {
  const { budget, progress, cost } = options;

  if (cost.attempt > Math.min(cost.itemCandidateLimit, budget.candidateLimitPerItem)) {
    return budgetBlocker({
      field: 'candidateLimitPerItem',
      itemId: options.itemId,
      message: `Attempt ${cost.attempt} exceeds the candidate limit of ${Math.min(
        cost.itemCandidateLimit,
        budget.candidateLimitPerItem,
      )} per item — an explicit new variation consumes candidate budget.`,
    });
  }

  if (cost.providerMode === 'hosted') {
    const committed = progress.runSpendUsd + cost.estimatedSpendUsdPerCandidate;
    if (cost.estimatedSpendUsdPerCandidate > 0 && committed > budget.hostedBudgetUsd) {
      return budgetBlocker({
        field: 'hostedBudgetUsd',
        itemId: options.itemId,
        message: `Hosted provider "${cost.providerProfileId}" would spend ~$${cost.estimatedSpendUsdPerCandidate.toFixed(
          4,
        )}, over the declared hostedBudgetUsd ceiling of $${budget.hostedBudgetUsd.toFixed(2)}.`,
      });
    }
  }

  if (progress.runCandidateCount + 1 > budget.maxCandidatesPerRun) {
    return budgetBlocker({
      field: 'maxCandidatesPerRun',
      itemId: options.itemId,
      message: `Candidate ${progress.runCandidateCount + 1} exceeds the run ceiling of ${
        budget.maxCandidatesPerRun
      }.`,
    });
  }

  const duration = progress.runDurationSeconds + cost.estimatedDurationSeconds;
  if (cost.estimatedDurationSeconds > 0 && duration > budget.maxDurationSeconds) {
    return budgetBlocker({
      field: 'maxDurationSeconds',
      itemId: options.itemId,
      message: `Generated audio would reach ${duration.toFixed(1)}s, over the declared ${
        budget.maxDurationSeconds
      }s ceiling.`,
    });
  }

  const pixels = progress.runPixels + cost.estimatedPixels;
  if (cost.estimatedPixels > 0 && pixels > budget.maxPixels) {
    return budgetBlocker({
      field: 'maxPixels',
      itemId: options.itemId,
      message: `Generated pixels would reach ${pixels}, over the declared ${budget.maxPixels} pixel ceiling.`,
    });
  }

  const retained = progress.runRetainedBytes + cost.estimatedRetainedBytes;
  if (retained > budget.maxRetainedBytes) {
    return budgetBlocker({
      field: 'maxRetainedBytes',
      itemId: options.itemId,
      message: `Retained bytes would reach ${retained}, over the declared ${budget.maxRetainedBytes} byte ceiling.`,
    });
  }

  return undefined;
};

/** What a submission should do, given the jobs already in the store. */
export type SubmissionDecision =
  | { readonly kind: 'duplicate_request'; readonly job: GenerationJobRecord }
  | { readonly kind: 'duplicate_spec'; readonly job: GenerationJobRecord }
  | { readonly kind: 'already_claimed'; readonly job: GenerationJobRecord }
  | { readonly kind: 'resume'; readonly job: GenerationJobRecord }
  | { readonly kind: 'dispatch' };

/**
 * Resolves one submission against the persisted jobs.
 *
 * Order matters: the client request key wins (idempotency), then the effective
 * spec hash (duplicate detection). An explicit new variation is never
 * deduplicated — its `attempt` is part of the spec hash, and `explicitVariation`
 * makes the intent explicit even when the hashes collide.
 */
export const decideSubmission = (options: {
  incoming: { requestKey: string; effectiveSpecHash: string };
  existing: readonly GenerationJobRecord[];
  explicitVariation: boolean;
}): SubmissionDecision => {
  const byRequestKey = options.existing.find(
    (job) => job.requestKey === options.incoming.requestKey,
  );
  if (byRequestKey) {
    if (hasCandidateResult(byRequestKey.status) || byRequestKey.status === 'cancelled') {
      return { kind: 'duplicate_request', job: byRequestKey };
    }
    if (isClaimedJobStatus(byRequestKey.status)) {
      return { kind: 'already_claimed', job: byRequestKey };
    }
    // `queued`, `planned`, `failed` and `interrupted` may be picked up again;
    // the resource lease — not this record — is what prevents a double dispatch.
    return { kind: 'resume', job: byRequestKey };
  }

  const bySpec = options.existing.find(
    (job) => job.effectiveSpecHash === options.incoming.effectiveSpecHash,
  );
  if (bySpec) {
    if (hasCandidateResult(bySpec.status) && !options.explicitVariation) {
      return { kind: 'duplicate_spec', job: bySpec };
    }
    if (isClaimedJobStatus(bySpec.status)) {
      return { kind: 'already_claimed', job: bySpec };
    }
    if (!options.explicitVariation) {
      return { kind: 'resume', job: bySpec };
    }
  }

  return { kind: 'dispatch' };
};

/** The budget ceilings a plan/run derives from the brief plus overrides. */
export const resolveBudget = (options: {
  brief: AssetBrief;
  overrides?: Partial<GenerationBudget>;
}): GenerationBudget => {
  const { execution, summary } = options.brief;
  return {
    gpuConcurrency: execution.gpuConcurrency,
    candidateLimitPerItem: execution.candidateLimitPerItem,
    maxCandidatesPerRun: summary.maxCandidates,
    hostedBudgetUsd: execution.hostedBudgetUsd,
    maxDurationSeconds: DEFAULT_GENERATION_BUDGET.maxDurationSeconds,
    maxPixels: DEFAULT_GENERATION_BUDGET.maxPixels,
    maxRetainedBytes: DEFAULT_GENERATION_BUDGET.maxRetainedBytes,
    maxRequestedAudioSecondsPerCandidatePass: summary.maxRequestedAudioSecondsPerCandidatePass,
    ...options.overrides,
  };
};

/** Builds a fresh job record from a plan item. */
export const createJobRecordFromPlanItem = (options: {
  item: GenerationPlanItem;
  runId: string;
  briefId: string;
  at: string;
}): GenerationJobRecord => {
  const { item } = options;
  return {
    schemaVersion: 1,
    jobId: item.jobId,
    runId: options.runId,
    briefId: options.briefId,
    phase: item.phase,
    itemId: item.itemId,
    requestKey: item.requestKey,
    effectiveSpecHash: item.effectiveSpecHash,
    attempt: item.attempt,
    seed: item.seed,
    recipeId: item.recipeId,
    prompt: item.prompt,
    providerProfileId: item.providerProfileId,
    providerMode: item.providerMode,
    preparationProfile: item.preparationProfile,
    referenceHashes: { ...item.referenceHashes },
    status: 'queued',
    candidateLimit: item.candidateLimit,
    candidateCount: 0,
    stateHistory: [
      { status: 'planned', at: options.at },
      { status: 'queued', at: options.at },
    ],
    createdAt: options.at,
    updatedAt: options.at,
  };
};
