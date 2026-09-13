// packages/shared/schemas/src/lib/generation/generation_job.ts
//
// C-519: the durable job protocol — job records, the immutable run lock, the
// declared budget, the machine-readable plan and the CLI report.
//
// These shapes are the *only* cross-boundary vocabulary for the batch runner.
// The portable core in `@aikami/local-ai` derives them, the host store in
// `apps/backend/local-stack` persists them, and the CLI prints them. Nothing
// reconstructs them at a call site.
//
// Vocabulary rules that the schemas encode:
//   - `cancellation.requested` and `cancellation.confirmed` are separate
//     booleans: a request is not a provider-side confirmation.
//   - `reconciliation_required` is a first-class status, never a retry.
//   - an unresolved reference keeps `sha256` absent — a hash that was never
//     computed is never written.
//
// Contract: C-519 Durable asset jobs and batch execution

import { type Static, Type } from 'typebox';
import { GenerationJobIdSchema, GenerationSha256Schema } from './generation_provenance.ts';

/** Job-record version. Bump only for a breaking change to the record shape. */
export const GENERATION_JOB_SCHEMA_VERSION = 1;

/** Run-lock version — an older runner's lock is reported, never rewritten. */
export const GENERATION_RUN_LOCK_SCHEMA_VERSION = 1;

/** Plan/report version. */
export const GENERATION_PLAN_SCHEMA_VERSION = 1;

/**
 * The job lifecycle.
 *
 * `planned → queued → running → preparing → awaiting_review → succeeded` is
 * the happy path; `failed`, `interrupted`, `cancelled` and
 * `reconciliation_required` are the off-nominal ends. A completed
 * *unaccepted* candidate is `awaiting_review`, never `succeeded`.
 */
export const GenerationJobStatusSchema = Type.Union([
  Type.Literal('planned'),
  Type.Literal('queued'),
  Type.Literal('running'),
  Type.Literal('preparing'),
  Type.Literal('awaiting_review'),
  Type.Literal('succeeded'),
  Type.Literal('failed'),
  Type.Literal('interrupted'),
  Type.Literal('cancelled'),
  Type.Literal('reconciliation_required'),
]);

/** One durable job status. */
export type GenerationJobStatus = Static<typeof GenerationJobStatusSchema>;

/** How a resolved provider profile reaches its bytes. */
export const GenerationProviderModeSchema = Type.Union([
  Type.Literal('local'),
  Type.Literal('hosted'),
  Type.Literal('import'),
  Type.Literal('unavailable'),
]);

/** How a provider profile is reached. */
export type GenerationProviderMode = Static<typeof GenerationProviderModeSchema>;

/** The budget ceilings a run is authorized to spend. */
export const GenerationBudgetSchema = Type.Object(
  {
    /** Physical GPU/resource-group concurrency. Default 1. */
    gpuConcurrency: Type.Integer({ minimum: 1 }),
    /** Per-item candidate ceiling (`candidateLimitPerItem`). */
    candidateLimitPerItem: Type.Integer({ minimum: 1 }),
    /** Whole-run candidate ceiling (`summary.maxCandidates`). */
    maxCandidatesPerRun: Type.Integer({ minimum: 1 }),
    /** Provider spend ceiling. `0` refuses every hosted provider. */
    hostedBudgetUsd: Type.Number({ minimum: 0 }),
    /** Total generated duration ceiling, in seconds. */
    maxDurationSeconds: Type.Number({ minimum: 0 }),
    /** Total pixel ceiling across generated images. */
    maxPixels: Type.Integer({ minimum: 0 }),
    /** Retained-bytes ceiling for the run's blob store. */
    maxRetainedBytes: Type.Integer({ minimum: 0 }),
    /** `summary.maxRequestedAudioSecondsPerCandidatePass`. */
    maxRequestedAudioSecondsPerCandidatePass: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

/** The declared, checkable budget ceilings. */
export type GenerationBudget = Static<typeof GenerationBudgetSchema>;

/** The budget field names a refusal can name. */
export const GenerationBudgetFieldSchema = Type.Union([
  Type.Literal('candidateLimitPerItem'),
  Type.Literal('maxCandidatesPerRun'),
  Type.Literal('hostedBudgetUsd'),
  Type.Literal('maxDurationSeconds'),
  Type.Literal('maxPixels'),
  Type.Literal('maxRetainedBytes'),
  Type.Literal('maxRequestedAudioSecondsPerCandidatePass'),
]);

/** Which ceiling was violated. */
export type GenerationBudgetField = Static<typeof GenerationBudgetFieldSchema>;

/** The native provider handle recorded before a submission returns success. */
export const GenerationNativeHandleSchema = Type.Object(
  {
    providerProfileId: Type.String({ minLength: 1, maxLength: 160 }),
    engineId: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
    /** The provider's own job/request id, when it reports one. */
    nativeJobId: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
    endpoint: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    submittedAt: Type.String({ maxLength: 40 }),
  },
  { additionalProperties: false },
);

/** A native provider handle. */
export type GenerationNativeHandle = Static<typeof GenerationNativeHandleSchema>;

/** The exclusive lease that makes one process the resource owner. */
export const GenerationLeaseSchema = Type.Object(
  {
    /** Physical resource group the lease covers (e.g. `gpu:0`). */
    resourceGroup: Type.String({ minLength: 1, maxLength: 120 }),
    /** Process identity that holds it. */
    owner: Type.String({ minLength: 1, maxLength: 200 }),
    pid: Type.Integer({ minimum: 0 }),
    leaseId: Type.String({ minLength: 1, maxLength: 160 }),
    acquiredAt: Type.String({ maxLength: 40 }),
    expiresAt: Type.String({ maxLength: 40 }),
  },
  { additionalProperties: false },
);

/** One resource lease. */
export type GenerationLease = Static<typeof GenerationLeaseSchema>;

/** One state transition, kept as an audit trail. */
export const GenerationJobStateEntrySchema = Type.Object(
  {
    status: GenerationJobStatusSchema,
    at: Type.String({ maxLength: 40 }),
    note: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);

/** One recorded job state transition. */
export type GenerationJobStateEntry = Static<typeof GenerationJobStateEntrySchema>;

/**
 * Cancellation is two facts, deliberately unmerged: a *request* leaves the
 * runner waiting, and *confirmation* is the provider's own receipt. An engine
 * with `capabilities.cancel === false` (ACE-Step v1) can only ever produce the
 * first.
 */
export const GenerationJobCancellationSchema = Type.Object(
  {
    requested: Type.Boolean(),
    requestedAt: Type.Optional(Type.String({ maxLength: 40 })),
    confirmed: Type.Boolean(),
    confirmedAt: Type.Optional(Type.String({ maxLength: 40 })),
    /** Present when confirmed is false but a request was made. */
    reason: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);

/** The split cancellation record. */
export type GenerationJobCancellation = Static<typeof GenerationJobCancellationSchema>;

/** A structured failure, with a stable code. */
export const GenerationJobFailureSchema = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 120 }),
    message: Type.String({ minLength: 1, maxLength: 2000 }),
    at: Type.String({ maxLength: 40 }),
  },
  { additionalProperties: false },
);

/** A job failure. */
export type GenerationJobFailure = Static<typeof GenerationJobFailureSchema>;

/** One durable job record. */
export const GenerationJobRecordSchema = Type.Object(
  {
    schemaVersion: Type.Literal(GENERATION_JOB_SCHEMA_VERSION),
    jobId: GenerationJobIdSchema,
    runId: Type.String({ minLength: 1, maxLength: 160 }),
    briefId: Type.String({ minLength: 1, maxLength: 160 }),
    phase: Type.Union([Type.Literal('slice'), Type.Literal('expansion')]),
    /** The brief's job id (logical item). */
    itemId: Type.String({ minLength: 1, maxLength: 160 }),
    /** Client request key — the API idempotency handle. */
    requestKey: Type.String({ minLength: 1, maxLength: 300 }),
    /** Canonical effective-spec hash — the duplicate detector. */
    effectiveSpecHash: GenerationSha256Schema,
    /** 1 for the first attempt; incremented only by an explicit variation. */
    attempt: Type.Integer({ minimum: 1 }),
    seed: Type.Integer({ minimum: 0 }),
    recipeId: Type.String({ minLength: 1, maxLength: 160 }),
    prompt: Type.String({ minLength: 1, maxLength: 8000 }),
    providerProfileId: Type.String({ minLength: 1, maxLength: 160 }),
    providerMode: GenerationProviderModeSchema,
    preparationProfile: Type.String({ minLength: 1, maxLength: 160 }),
    referenceHashes: Type.Record(Type.String(), GenerationSha256Schema),
    status: GenerationJobStatusSchema,
    candidateLimit: Type.Integer({ minimum: 1 }),
    candidateCount: Type.Integer({ minimum: 0 }),
    stateHistory: Type.Array(GenerationJobStateEntrySchema, { minItems: 1 }),
    createdAt: Type.String({ maxLength: 40 }),
    updatedAt: Type.String({ maxLength: 40 }),
    nativeHandle: Type.Optional(GenerationNativeHandleSchema),
    /**
     * The provider's `capabilities.cancel` at dispatch time. Recorded so a later
     * `--cancel` can report honestly whether the provider can stop compute —
     * `false` (ACE-Step v1) means a cancel request can only stop polling.
     */
    providerCancelSupported: Type.Optional(Type.Boolean()),
    lease: Type.Optional(GenerationLeaseSchema),
    rawHash: Type.Optional(GenerationSha256Schema),
    rawBytes: Type.Optional(Type.Integer({ minimum: 0 })),
    rawPath: Type.Optional(Type.String({ maxLength: 2048 })),
    preparedHash: Type.Optional(GenerationSha256Schema),
    preparedPath: Type.Optional(Type.String({ maxLength: 2048 })),
    candidateId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    stagedPath: Type.Optional(Type.String({ maxLength: 2048 })),
    failure: Type.Optional(GenerationJobFailureSchema),
    cancellation: Type.Optional(GenerationJobCancellationSchema),
  },
  { additionalProperties: false },
);

/** The durable record of one submitted job. */
export type GenerationJobRecord = Static<typeof GenerationJobRecordSchema>;

/** One reference, as resolved (or not) into the run lock. */
export const GenerationRunLockReferenceSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 160 }),
    kind: Type.String({ minLength: 1, maxLength: 120 }),
    locator: Type.String({ minLength: 1, maxLength: 2048 }),
    resolution: Type.Union([Type.Literal('required'), Type.Literal('optional')]),
    status: Type.Union([Type.Literal('resolved'), Type.Literal('unresolved')]),
    /** Present only when bytes were actually read and hashed. */
    sha256: Type.Optional(GenerationSha256Schema),
    bytes: Type.Optional(Type.Integer({ minimum: 0 })),
    sourcePath: Type.Optional(Type.String({ maxLength: 2048 })),
    /** Why it could not be resolved (never an invented hash). */
    reason: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);

/** One resolved (or blocked) reference in the run lock. */
export type GenerationRunLockReference = Static<typeof GenerationRunLockReferenceSchema>;

/** One provider preference group resolved to a concrete profile. */
export const GenerationRunLockProviderSchema = Type.Object(
  {
    /** The brief's `providerPreference` group. */
    preferenceGroup: Type.String({ minLength: 1, maxLength: 160 }),
    profileId: Type.String({ minLength: 1, maxLength: 160 }),
    mode: GenerationProviderModeSchema,
    engineId: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
    /** The recipe's declared model id — never an invented revision hash. */
    model: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    recipeId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    workflow: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
    processor: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
  },
  { additionalProperties: false },
);

/** One provider profile pinned by the run lock. */
export type GenerationRunLockProvider = Static<typeof GenerationRunLockProviderSchema>;

/**
 * The immutable run lock: which profiles, models, recipes, processors and
 * reference artifacts this run is bound to. Written once per run; a differing
 * re-resolution is reported, never silently overwritten.
 */
export const GenerationRunLockSchema = Type.Object(
  {
    schemaVersion: Type.Literal(GENERATION_RUN_LOCK_SCHEMA_VERSION),
    runId: Type.String({ minLength: 1, maxLength: 160 }),
    briefId: Type.String({ minLength: 1, maxLength: 160 }),
    briefPath: Type.String({ minLength: 1, maxLength: 2048 }),
    /** Hash of the brief bytes actually read. */
    briefSha256: GenerationSha256Schema,
    phase: Type.Union([Type.Literal('slice'), Type.Literal('expansion')]),
    createdAt: Type.String({ maxLength: 40 }),
    budget: GenerationBudgetSchema,
    references: Type.Array(GenerationRunLockReferenceSchema, { maxItems: 512 }),
    providers: Type.Array(GenerationRunLockProviderSchema, { maxItems: 128 }),
  },
  { additionalProperties: false },
);

/** The run lock. */
export type GenerationRunLock = Static<typeof GenerationRunLockSchema>;

/** The run record — the durable container the jobs live in. */
export const GenerationRunRecordSchema = Type.Object(
  {
    schemaVersion: Type.Literal(GENERATION_JOB_SCHEMA_VERSION),
    runId: Type.String({ minLength: 1, maxLength: 160 }),
    briefId: Type.String({ minLength: 1, maxLength: 160 }),
    briefPath: Type.String({ minLength: 1, maxLength: 2048 }),
    briefSha256: GenerationSha256Schema,
    phase: Type.Union([Type.Literal('slice'), Type.Literal('expansion')]),
    createdAt: Type.String({ maxLength: 40 }),
    updatedAt: Type.String({ maxLength: 40 }),
    budget: GenerationBudgetSchema,
    status: Type.Union([
      Type.Literal('planned'),
      Type.Literal('running'),
      Type.Literal('awaiting_review'),
      Type.Literal('completed'),
      Type.Literal('cancelled'),
      Type.Literal('interrupted'),
      Type.Literal('reconciliation_required'),
    ]),
    jobIds: Type.Array(GenerationJobIdSchema, { maxItems: 4096 }),
  },
  { additionalProperties: false },
);

/** The durable run record. */
export type GenerationRunRecord = Static<typeof GenerationRunRecordSchema>;

/** Why a plan item cannot be dispatched. */
export const GenerationPlanBlockerCodeSchema = Type.Union([
  /** A required reference has no verified bytes. */
  Type.Literal('unresolved_required_reference'),
  /** No profile in the preference group can run here. */
  Type.Literal('provider_unavailable'),
  /** The only resolution is an out-of-band import. */
  Type.Literal('provider_requires_import'),
  /** The group names a profile the brief never declares. */
  Type.Literal('unknown_provider_preference'),
  /** A budget ceiling would be exceeded. */
  Type.Literal('budget_exceeded'),
  /** The preparation profile is not declared by the brief. */
  Type.Literal('unsupported_preparation_profile'),
  /** An experimental provider is not enabled. */
  Type.Literal('experimental_provider_disabled'),
  /** A dependency is not planned and not already satisfied. */
  Type.Literal('dependency_not_satisfied'),
  /** The job's kind has no recipe. */
  Type.Literal('unsupported_job_kind'),
  /** Another process already holds the job or its resource lease. */
  Type.Literal('job_already_claimed'),
  /** The job's native handle is unresolved; no new attempt is dispatched. */
  Type.Literal('job_reconciliation_required'),
  /** The provider dispatch failed; see the job's `failure`. */
  Type.Literal('engine_dispatch_failed'),
]);

/** A plan blocker code. */
export type GenerationPlanBlockerCode = Static<typeof GenerationPlanBlockerCodeSchema>;

/** One structured reason a plan item (or the plan) cannot proceed. */
export const GenerationPlanBlockerSchema = Type.Object(
  {
    code: GenerationPlanBlockerCodeSchema,
    message: Type.String({ minLength: 1, maxLength: 1000 }),
    itemId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    referenceId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    providerProfileId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    /** Named only for `budget_exceeded`. */
    budget: Type.Optional(GenerationBudgetFieldSchema),
  },
  { additionalProperties: false },
);

/** One structured blocker. */
export type GenerationPlanBlocker = Static<typeof GenerationPlanBlockerSchema>;

/** A non-fatal observation (rights decision still open, optional ref unresolved). */
export const GenerationPlanWarningSchema = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 120 }),
    message: Type.String({ minLength: 1, maxLength: 1000 }),
    itemId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    referenceId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    providerProfileId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  },
  { additionalProperties: false },
);

/** One non-fatal plan observation. */
export type GenerationPlanWarning = Static<typeof GenerationPlanWarningSchema>;

/** One planned (or blocked) job in a plan. */
export const GenerationPlanItemSchema = Type.Object(
  {
    jobId: GenerationJobIdSchema,
    itemId: Type.String({ minLength: 1, maxLength: 160 }),
    requestKey: Type.String({ minLength: 1, maxLength: 300 }),
    effectiveSpecHash: GenerationSha256Schema,
    phase: Type.Union([Type.Literal('slice'), Type.Literal('expansion')]),
    recipeId: Type.String({ minLength: 1, maxLength: 160 }),
    prompt: Type.String({ minLength: 1, maxLength: 8000 }),
    providerProfileId: Type.String({ minLength: 1, maxLength: 160 }),
    providerMode: GenerationProviderModeSchema,
    providerEngineId: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
    preparationProfile: Type.String({ minLength: 1, maxLength: 160 }),
    referenceIds: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 64 }),
    referenceHashes: Type.Record(Type.String(), GenerationSha256Schema),
    attempt: Type.Integer({ minimum: 1 }),
    seed: Type.Integer({ minimum: 0 }),
    candidateLimit: Type.Integer({ minimum: 1 }),
    dependsOn: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 64 }),
    /** Estimated duration in seconds (audio) — 0 for image jobs. */
    estimatedDurationSeconds: Type.Number({ minimum: 0 }),
    /** Estimated pixels (image) — 0 for audio jobs. */
    estimatedPixels: Type.Integer({ minimum: 0 }),
    dispatchable: Type.Boolean(),
    blockers: Type.Array(GenerationPlanBlockerSchema, { maxItems: 32 }),
  },
  { additionalProperties: false },
);

/** One planned job. */
export type GenerationPlanItem = Static<typeof GenerationPlanItemSchema>;

/**
 * The machine-readable plan — the `--plan` output. It reports both phase
 * counts (`sliceItems`/`expansionItems`) from the brief's own summary so a
 * caller can assert the plan against the authored brief without re-reading it.
 */
export const GenerationPlanSchema = Type.Object(
  {
    schemaVersion: Type.Literal(GENERATION_PLAN_SCHEMA_VERSION),
    kind: Type.Literal('generation-plan'),
    briefId: Type.String({ minLength: 1, maxLength: 160 }),
    briefPath: Type.String({ minLength: 1, maxLength: 2048 }),
    briefSha256: GenerationSha256Schema,
    phase: Type.Union([Type.Literal('slice'), Type.Literal('expansion')]),
    sliceItems: Type.Integer({ minimum: 0 }),
    expansionItems: Type.Integer({ minimum: 0 }),
    totalItems: Type.Integer({ minimum: 0 }),
    plannedItems: Type.Integer({ minimum: 0 }),
    dispatchableItems: Type.Integer({ minimum: 0 }),
    blockedItems: Type.Integer({ minimum: 0 }),
    budget: GenerationBudgetSchema,
    items: Type.Array(GenerationPlanItemSchema, { maxItems: 4096 }),
    blockers: Type.Array(GenerationPlanBlockerSchema, { maxItems: 4096 }),
    warnings: Type.Array(GenerationPlanWarningSchema, { maxItems: 4096 }),
    references: Type.Array(GenerationRunLockReferenceSchema, { maxItems: 512 }),
    providers: Type.Array(GenerationRunLockProviderSchema, { maxItems: 128 }),
  },
  { additionalProperties: false },
);

/** The machine-readable plan. */
export type GenerationPlan = Static<typeof GenerationPlanSchema>;

/** One job's report line in a run/resume/status/cancel report. */
export const GenerationJobReportSchema = Type.Object(
  {
    jobId: GenerationJobIdSchema,
    itemId: Type.String({ minLength: 1, maxLength: 160 }),
    status: GenerationJobStatusSchema,
    /** Engine dispatches this process performed for the job (0 when deduped). */
    engineCalls: Type.Integer({ minimum: 0 }),
    /** Set when the submission resolved to an existing job instead of dispatching. */
    resolvedToJobId: Type.Optional(GenerationJobIdSchema),
    candidateId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    preparedHash: Type.Optional(GenerationSha256Schema),
    stagedPath: Type.Optional(Type.String({ maxLength: 2048 })),
    cancellation: Type.Optional(GenerationJobCancellationSchema),
    failure: Type.Optional(GenerationJobFailureSchema),
  },
  { additionalProperties: false },
);

/** One job report. */
export type GenerationJobReport = Static<typeof GenerationJobReportSchema>;

/**
 * The CLI's machine-readable report. `ok` is true only when the requested
 * operation completed with no blockers and no failed job.
 */
export const GenerationBatchReportSchema = Type.Object(
  {
    schemaVersion: Type.Literal(GENERATION_PLAN_SCHEMA_VERSION),
    kind: Type.Union([
      Type.Literal('generation-plan'),
      Type.Literal('generation-run'),
      Type.Literal('generation-resume'),
      Type.Literal('generation-status'),
      Type.Literal('generation-cancel'),
    ]),
    ok: Type.Boolean(),
    exitCode: Type.Integer(),
    briefId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    phase: Type.Optional(Type.Union([Type.Literal('slice'), Type.Literal('expansion')])),
    runId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    runsDir: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    plannedItems: Type.Optional(Type.Integer({ minimum: 0 })),
    blockedItems: Type.Optional(Type.Integer({ minimum: 0 })),
    engineRequests: Type.Integer({ minimum: 0 }),
    jobs: Type.Array(GenerationJobReportSchema, { maxItems: 4096 }),
    blockers: Type.Array(GenerationPlanBlockerSchema, { maxItems: 4096 }),
    warnings: Type.Array(GenerationPlanWarningSchema, { maxItems: 4096 }),
    /** Active leases that block a dispatch, when any are reported. */
    activeLeases: Type.Array(GenerationLeaseSchema, { maxItems: 64 }),
    message: Type.Optional(Type.String({ maxLength: 2000 })),
  },
  { additionalProperties: false },
);

/** The CLI's machine-readable report. */
export type GenerationBatchReport = Static<typeof GenerationBatchReportSchema>;
