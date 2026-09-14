// apps/backend/local-stack/stack/generation/runner.ts
//
// C-519: the host runner — resource scheduling, the durable claim, recovery
// and the batch/report orchestration behind `generate:batch`.
//
// It is the only place that combines the portable core
// (`@aikami/local-ai`: plan, spec identity, budget, state machine) with the
// host store (filesystem, pid, clock, atomic replacement).
//
// The ordering inside one item's submission is the contract:
//
//   1. resolve the submission against the persisted jobs (idempotency first,
//      then duplicate detection);
//   2. check every declared budget ceiling — *before* anything is dispatched;
//   3. take the lease for the item's physical resource group;
//   4. write the job record (claimed, with the lease) — never a dispatch
//      without a durable record that says who owns it;
//   5. reuse verified raw bytes when a previous attempt already produced them;
//   6. dispatch through `runAssetGeneration` with the lease-aware engine;
//   7. persist the raw blob, then stage the prepared bytes and the candidate
//      record under the staging lock;
//   8. release the lease only on confirmed provider completion.
//
// Contract: C-519 Durable asset jobs and batch execution

import {
  GENERATION_BATCH_EXIT_CODES,
  GENERATION_PROVIDER_PROFILES,
  type GenerationProviderProfile,
} from '@aikami/constants';
import {
  applyJobTransition,
  buildAssetFragments,
  classifySubmissionFailure,
  createJobRecordFromPlanItem,
  decideSubmission,
  enforceGenerationBudget,
  makeCandidateId,
  mimeTypeForExt,
  requireRecipe,
  runAssetGeneration,
  sha256Hex,
  toGeneratedAsset,
} from '@aikami/local-ai';
import type {
  AssetHashesFile,
  AssetManifest,
  CandidateRecord,
  GeneratedAsset,
  GenerationEngineClient,
  GenerationEngineId,
  GenerationJobRecord,
  GenerationJobReport,
  GenerationLease,
  GenerationPlan,
  GenerationPlanBlocker,
  GenerationPlanItem,
  GenerationRunRecord,
} from '@aikami/types';
import { jobReport } from './job_reports.ts';
import {
  acquireLease,
  type GenerationStorePaths,
  isProcessAlive,
  listLiveLeases,
  listParsedJobs,
  readVerifiedBlob,
  releaseLease,
  resourceGroupForEngine,
  updateRunRecord,
  withJobRecordLock,
  writeBlob,
  writeJobRecord,
} from './job_store.ts';
import {
  applyPreparation,
  type BatchMediaValidationRecord,
  type BatchPreparationHook,
} from './preparation.ts';
import { appendCandidateRecord, type StagingWriteName, stagePreparedAsset } from './staging.ts';

/** Internal: a simulated mid-run kill, swallowed by the abort handler. */
class BatchAbortSignal extends Error {}

/** Internal: cancellation won the job lock before a runner transition. */
class BatchCancellationSignal extends Error {
  readonly record: GenerationJobRecord;

  constructor(record: GenerationJobRecord) {
    super(`Job ${record.jobId} was cancelled`);
    this.record = record;
  }
}

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

/** Options for {@link executeBatch}. */
export type ExecuteBatchOptions = {
  readonly paths: GenerationStorePaths;
  readonly plan: GenerationPlan;
  readonly engineFactory: BatchEngineFactory;
  /** Restrict execution to these brief item ids. Defaults to every item. */
  readonly itemIds?: readonly string[];
  /** An explicit new variation: bumps attempt/seed and consumes candidate budget. */
  readonly variation?: { readonly itemId: string; readonly attempt: number };
  /** Owner tag recorded on the lease (defaults to `pid:<pid>`). */
  readonly owner?: string;
  readonly leaseTtlMs?: number;
  /** Injected clock, for deterministic tests. */
  readonly now?: () => Date;
  /**
   * Test seam: called right after raw bytes are persisted. Returning `abort`
   * simulates a process kill at that exact moment (the job stays `preparing`
   * with its raw blob durable, exactly as a hard kill would leave it).
   */
  readonly onRawPersisted?: (record: GenerationJobRecord) => 'abort' | undefined;
  /** Test seam: called after each staging write (same `abort` contract). */
  readonly onStagingWrite?: (name: StagingWriteName) => 'abort' | undefined;
  /**
   * C-520: deterministic preparation of the verified raw bytes.
   *
   * Called once per job, after the raw blob is durable and before anything is
   * staged, so a crash-resumed run prepares the *same verified raw bytes*
   * again rather than regenerating them. Returning bytes that differ from the
   * raw input re-derives the descriptor, so the staged hash is the prepared
   * hash — and a returned report is surfaced for the CLI to persist.
   */
  readonly prepare?: BatchPreparationHook;
};

/** The runner's result — the machine-readable half of the CLI report. */
export type BatchExecutionResult = {
  readonly jobs: readonly GenerationJobReport[];
  readonly engineRequests: number;
  readonly blockers: readonly GenerationPlanBlocker[];
  readonly activeLeases: readonly GenerationLease[];
  readonly exitCode: number;
  /** C-520: preparation reports for the jobs this run prepared. */
  readonly mediaValidations?: readonly BatchMediaValidationRecord[];
};

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

/** Candidate/spend already committed, derived from the persisted jobs. */
const committedProgress = (jobs: readonly GenerationJobRecord[]) => {
  const withResults = jobs.filter((job) => job.candidateCount > 0);
  return {
    itemCandidateCount: 0,
    runCandidateCount: withResults.reduce((total, job) => total + job.candidateCount, 0),
    runSpendUsd: withResults.reduce(
      (total, job) =>
        total +
        (job.providerMode === 'hosted'
          ? (GENERATION_PROVIDER_PROFILES[job.providerProfileId]?.estimatedSpendUsdPerCandidate ??
              0) * job.candidateCount
          : 0),
      0,
    ),
    runDurationSeconds: 0,
    runPixels: 0,
    runRetainedBytes: withResults.reduce((total, job) => total + (job.rawBytes ?? 0), 0),
  };
};

/** Applies one runner write to the latest job record while holding its lock. */
const commitRunnerJob = (options: {
  paths: GenerationStorePaths;
  fallback: GenerationJobRecord;
  update: (latest: GenerationJobRecord) => GenerationJobRecord;
}): GenerationJobRecord =>
  withJobRecordLock(
    { paths: options.paths, jobId: options.fallback.jobId },
    (current): GenerationJobRecord => {
      const latest = current ?? options.fallback;
      if (latest.status === 'cancelled') {
        throw new BatchCancellationSignal(latest);
      }
      const updated = options.update(latest);
      writeJobRecord(options.paths, updated);
      return updated;
    },
  );

/**
 * Summarizes a run's durable status from its jobs.
 *
 * `reconciliation_required` outranks everything: a run with an unresolved
 * native handle is not "awaiting review", it is unsettled.
 */
const summarizeRunStatus = (
  jobs: readonly GenerationJobRecord[],
): GenerationRunRecord['status'] => {
  if (jobs.some((job) => job.status === 'reconciliation_required')) {
    return 'reconciliation_required';
  }
  if (jobs.some((job) => job.status === 'running' || job.status === 'preparing')) {
    return 'running';
  }
  if (jobs.some((job) => job.status === 'cancelled')) {
    return 'cancelled';
  }
  if (jobs.some((job) => job.status === 'awaiting_review')) {
    return 'awaiting_review';
  }
  return jobs.length > 0 ? 'completed' : 'planned';
};

/** True when an error means the request left the process (timeout/abort). */
const looksLikeUncertainRequest = (message: string): boolean =>
  /timed out|timeout|aborted|AbortError|deadline/i.test(message);

/** The C-518-shaped candidate record for one prepared job. */
const candidateRecordFor = (options: {
  record: GenerationJobRecord;
  descriptor: GeneratedAsset;
  at: string;
}): CandidateRecord => ({
  candidateId: options.record.candidateId ?? `${options.record.jobId}-c1`,
  tag: options.descriptor.tag,
  jobId: options.record.jobId,
  status: 'pending_review',
  preparedHash: options.descriptor.sha256,
  provenanceState: 'captured',
  createdAt: options.at,
  updatedAt: options.at,
});

/**
 * Runs the requested items of a plan, in plan order.
 *
 * One failing item never touches another item's outputs or records: each job
 * owns its own blob, staged path and record, and the loop continues after a
 * refusal (`AC-5`'s "one failing item leaves every other item's outputs and
 * records untouched").
 */
export const executeBatch = async (options: ExecuteBatchOptions): Promise<BatchExecutionResult> => {
  const { paths, plan } = options;
  const owner = options.owner ?? `pid:${process.pid}`;
  const leaseTtlMs = options.leaseTtlMs ?? 30 * 60 * 1000;
  const clock = options.now ?? (() => new Date());
  const at = (): string => clock().toISOString();

  const requested = new Set(options.itemIds ?? []);
  const items = plan.items.filter((item) => requested.size === 0 || requested.has(item.itemId));

  const jobs = [...listParsedJobs(paths)];
  const progress = committedProgress(jobs);

  const reports: GenerationJobReport[] = [];
  const blockers: GenerationPlanBlocker[] = [];
  const mediaValidations: BatchMediaValidationRecord[] = [];
  const activeLeases: GenerationLease[] = [];
  let engineRequests = 0;
  let exitCode: number = GENERATION_BATCH_EXIT_CODES.OK;

  for (const item of items) {
    const explicitVariation = options.variation?.itemId === item.itemId;
    const decision = decideSubmission({
      incoming: { requestKey: item.requestKey, effectiveSpecHash: item.effectiveSpecHash },
      existing: jobs,
      explicitVariation,
    });

    if (decision.kind === 'duplicate_request' || decision.kind === 'duplicate_spec') {
      // No second engine call: the identical effective spec already has a job.
      reports.push(
        jobReport({
          record: decision.job,
          engineCalls: 0,
          resolvedToJobId: decision.job.jobId,
        }),
      );
      continue;
    }

    let record: GenerationJobRecord | undefined =
      decision.kind === 'resume' ? decision.job : undefined;

    if (decision.kind === 'already_claimed') {
      // A `running`/`preparing` record can also be *orphaned*: its owning
      // process died. The recorded lease — not the status — says which it is,
      // so a crashed run resumes while a live one keeps its claim.
      const recordedLease = decision.job.lease;
      const ownerless =
        decision.job.status !== 'reconciliation_required' &&
        (recordedLease === undefined ||
          !isProcessAlive(recordedLease.pid) ||
          recordedLease.owner === owner);
      if (ownerless) {
        record = decision.job;
      } else {
        blockers.push({
          code: 'job_already_claimed',
          itemId: item.itemId,
          providerProfileId: item.providerProfileId,
          message: `Job ${decision.job.jobId} is already owned by another submission (status ${decision.job.status}) — no second generation was dispatched.`,
        });
        if (decision.job.status === 'reconciliation_required') {
          blockers[blockers.length - 1] = {
            ...(blockers[blockers.length - 1] as GenerationPlanBlocker),
            code: 'job_reconciliation_required',
            message: `Job ${decision.job.jobId} requires reconciliation of its native handle before any new attempt — refusing to repeat a possibly running generation.`,
          };
        }
        exitCode = GENERATION_BATCH_EXIT_CODES.CLAIM_CONFLICT;
        reports.push(jobReport({ record: decision.job, engineCalls: 0 }));
        continue;
      }
    }

    const profile = profileForItem(item);
    const refusal = enforceGenerationBudget({
      budget: plan.budget,
      progress,
      cost: {
        providerProfileId: item.providerProfileId,
        providerMode: item.providerMode,
        estimatedSpendUsdPerCandidate: profile?.estimatedSpendUsdPerCandidate ?? 0,
        itemCandidateLimit: item.candidateLimit,
        attempt: item.attempt,
        estimatedDurationSeconds: item.estimatedDurationSeconds,
        estimatedPixels: item.estimatedPixels,
        estimatedRetainedBytes: 0,
      },
      itemId: item.itemId,
    });
    if (refusal) {
      blockers.push(refusal);
      exitCode = GENERATION_BATCH_EXIT_CODES.BUDGET_REFUSED;
      reports.push(
        jobReport({
          record:
            record ??
            createJobRecordFromPlanItem({
              item,
              runId: paths.runId,
              briefId: plan.briefId,
              at: at(),
            }),
          engineCalls: 0,
        }),
      );
      continue;
    }

    const engineId =
      parseEngineId(item.providerEngineId) ??
      parseEngineId(requireRecipe(item.recipeId).engine) ??
      'sdcpp';
    const resourceGroup = resourceGroupForEngine(engineId);
    const acquisition = acquireLease({
      paths,
      resourceGroup,
      owner,
      ttlMs: leaseTtlMs,
      now: clock(),
    });
    if (acquisition.kind === 'held') {
      activeLeases.push(acquisition.lease);
      blockers.push({
        code: 'job_already_claimed',
        itemId: item.itemId,
        providerProfileId: item.providerProfileId,
        message: `Resource group "${resourceGroup}" is already leased by ${acquisition.lease.owner} (pid ${acquisition.lease.pid}) since ${acquisition.lease.acquiredAt} — no second generation was dispatched.`,
      });
      exitCode = GENERATION_BATCH_EXIT_CODES.CLAIM_CONFLICT;
      reports.push(
        jobReport({
          record:
            record ??
            createJobRecordFromPlanItem({
              item,
              runId: paths.runId,
              briefId: plan.briefId,
              at: at(),
            }),
          engineCalls: 0,
        }),
      );
      continue;
    }

    const leaseHeld = { current: true };
    let activeRecord: GenerationJobRecord | undefined;
    try {
      activeRecord =
        record ??
        createJobRecordFromPlanItem({
          item,
          runId: paths.runId,
          briefId: plan.briefId,
          at: at(),
        });
      // A resumed job may already be past `running` (its raw bytes are
      // durable and it died in preparation), so the claim only advances a job
      // that has not reached `running` yet.
      const claimed = commitRunnerJob({
        paths,
        fallback: activeRecord,
        update: (latest) =>
          latest.status === 'preparing'
            ? { ...latest, lease: acquisition.lease, updatedAt: at() }
            : applyJobTransition({
                job: latest,
                status: 'running',
                at: at(),
                patch: { lease: acquisition.lease },
                note: `lease acquired on ${resourceGroup}`,
              }),
      });
      activeRecord = claimed;

      const recipe = requireRecipe(item.recipeId);

      // Recovery first: raw bytes a previous attempt already produced are
      // reused only when they still hash to the recorded digest.
      let rawBytes: Uint8Array | undefined;
      if (claimed.rawHash !== undefined && claimed.rawPath !== undefined) {
        rawBytes = await readVerifiedBlob(claimed.rawPath, claimed.rawHash);
        if (rawBytes === undefined) {
          // The recorded raw blob is gone or corrupt — the job is retried from
          // the engine, because there is nothing verified to resume from.
          activeRecord = commitRunnerJob({
            paths,
            fallback: activeRecord,
            update: (latest) => ({
              ...applyJobTransition({
                job: latest,
                status: 'preparing',
                at: at(),
                note: 'recorded raw blob missing or failing verification — will re-dispatch',
              }),
              rawHash: undefined,
              rawPath: undefined,
            }),
          });
        }
      }

      let engineCalls = 0;
      let descriptor: GeneratedAsset;
      let manifest: AssetManifest | undefined;
      let hashes: AssetHashesFile | undefined;
      let preparedBytes: Uint8Array | undefined;

      if (rawBytes === undefined) {
        const engine = options.engineFactory({ item, engineId });
        if (!engine) {
          throw new Error(
            `No engine is available for "${item.providerProfileId}" (engine ${engineId}) — provider resolution and transport construction disagreed`,
          );
        }
        const leasedEngine = createLeaseAwareEngine({
          engine,
          isLeaseHeld: () => leaseHeld.current,
          onDispatch: () => {
            engineCalls += 1;
            engineRequests += 1;
          },
        });
        const staging = await runAssetGeneration({
          recipeId: item.recipeId,
          prompt: item.prompt,
          engineId,
          engine: leasedEngine,
          tag: `batch:${plan.briefId}:${item.itemId}`,
          overrides: {
            seed: item.seed,
            ...(recipe.model === undefined ? {} : { model: recipe.model }),
            ...(item.estimatedDurationSeconds > 0
              ? { durationSeconds: item.estimatedDurationSeconds }
              : {}),
          },
        });
        rawBytes = staging.bytes;
        descriptor = staging.descriptor;
        manifest = staging.manifest;
        hashes = staging.hashes;
        preparedBytes = staging.bytes;
        activeRecord = commitRunnerJob({
          paths,
          fallback: activeRecord ?? claimed,
          update: (latest) =>
            applyJobTransition({
              job: latest,
              status: 'preparing',
              at: at(),
              patch: {
                nativeHandle: {
                  providerProfileId: item.providerProfileId,
                  engineId,
                  submittedAt: at(),
                },
                providerCancelSupported: engine.capabilities.cancel !== false,
                candidateCount: latest.candidateCount + 1,
              },
              note: 'generation completed; raw bytes persisted',
            }),
        });
      } else {
        // Resume after a crash: the verified raw bytes are the input to the
        // remaining (preparation) work only — the engine is never re-called.
        descriptor = await toGeneratedAsset(
          {
            bytes: rawBytes,
            mimeType: mimeTypeForExt(recipe.output.ext),
            engine: engineId,
            metadata: { prompt: item.prompt },
          },
          recipe,
          engineId,
          { prompt: item.prompt, tag: `batch:${plan.briefId}:${item.itemId}` },
        );
        preparedBytes = rawBytes;
        activeRecord = commitRunnerJob({
          paths,
          fallback: activeRecord ?? claimed,
          update: (latest) =>
            applyJobTransition({
              job: latest,
              status: 'preparing',
              at: at(),
              note: 'verified raw bytes reused — no regeneration',
            }),
        });
      }

      const rawHash = await sha256Hex(rawBytes);
      const blob = writeBlob({ paths, sha256: rawHash, ext: descriptor.ext, bytes: rawBytes });

      // C-520: deterministic preparation runs once, on the verified raw bytes,
      // for both a fresh generation and a crash-resumed one — so a resumed run
      // prepares the same bytes again instead of regenerating them.
      if (options.prepare) {
        const beforePreparationBytes = preparedBytes;
        const beforePreparationDescriptor = descriptor;
        const applied = await applyPreparation({
          prepare: options.prepare,
          context: {
            itemId: item.itemId,
            recipeId: recipe.id,
            engineId,
            prompt: item.prompt,
            rawBytes,
            rawSha256: rawHash,
          },
          descriptor,
          recipe,
          tag: `batch:${plan.briefId}:${item.itemId}`,
        });
        if (
          applied.bytes !== beforePreparationBytes ||
          applied.descriptor !== beforePreparationDescriptor
        ) {
          manifest = undefined;
          hashes = undefined;
        }
        preparedBytes = applied.bytes;
        descriptor = applied.descriptor;
        if (applied.record) {
          mediaValidations.push(applied.record);
        }
      }

      const fragments = buildAssetFragments({ descriptor, scannedAt: at() });
      activeRecord = commitRunnerJob({
        paths,
        fallback: activeRecord ?? claimed,
        update: (latest) => ({
          ...latest,
          rawHash: blob.sha256,
          rawBytes: blob.bytes,
          rawPath: blob.path,
          preparedHash: descriptor.sha256,
        }),
      });
      if (options.onRawPersisted?.(activeRecord) === 'abort') {
        updateRunRecord(paths, { status: 'interrupted', updatedAt: at() });
        return {
          jobs: [...reports],
          engineRequests,
          blockers: [...blockers],
          activeLeases: listLiveLeases(paths),
          exitCode: GENERATION_BATCH_EXIT_CODES.INTERNAL_ERROR,
        };
      }

      const staged = await stagePreparedAsset({
        paths,
        descriptor,
        bytes: preparedBytes,
        manifest: manifest ?? fragments.manifest,
        hashes: hashes ?? fragments.hashes,
        ...(options.onStagingWrite === undefined
          ? {}
          : {
              onWrite: (name) => {
                if (options.onStagingWrite?.(name) === 'abort') {
                  // Simulated kill mid-merge: the previous fragment is intact
                  // because every write is a temp file + rename.
                  updateRunRecord(paths, { status: 'interrupted', updatedAt: at() });
                  throw new BatchAbortSignal();
                }
              },
            }),
      });

      const prepared = activeRecord ?? claimed;
      const candidateId = makeCandidateId({ jobId: prepared.jobId, candidateIndex: 1 });
      activeRecord = commitRunnerJob({
        paths,
        fallback: prepared,
        update: (latest) =>
          applyJobTransition({
            job: latest,
            status: 'awaiting_review',
            at: at(),
            patch: {
              candidateId,
              candidateCount: Math.max(latest.candidateCount, 1),
              preparedPath: staged.stagedPath,
              stagedPath: staged.stagedPath,
            },
            note: 'prepared bytes staged — awaiting review, not yet accepted',
          }),
      });
      await appendCandidateRecord({
        paths,
        record: candidateRecordFor({ record: activeRecord, descriptor, at: at() }),
        ...(options.onStagingWrite === undefined ? {} : { onWrite: options.onStagingWrite }),
      });

      progress.runCandidateCount += 1;
      progress.runPixels += item.estimatedPixels;
      progress.runDurationSeconds += item.estimatedDurationSeconds;
      progress.runRetainedBytes += blob.bytes;
      if (item.providerMode === 'hosted') {
        progress.runSpendUsd += profile?.estimatedSpendUsdPerCandidate ?? 0;
      }
      jobs.push(activeRecord);
      reports.push(jobReport({ record: activeRecord, engineCalls }));
    } catch (error) {
      if (error instanceof BatchCancellationSignal) {
        activeRecord = error.record;
        if (!jobs.some((job) => job.jobId === error.record.jobId)) {
          jobs.push(error.record);
        }
        reports.push(jobReport({ record: error.record, engineCalls: 0 }));
        continue;
      }
      if (error instanceof BatchAbortSignal) {
        return {
          jobs: [...reports],
          engineRequests,
          blockers: [...blockers],
          activeLeases: listLiveLeases(paths),
          exitCode: GENERATION_BATCH_EXIT_CODES.INTERNAL_ERROR,
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      const classified = classifySubmissionFailure({
        requestLeftProcess: looksLikeUncertainRequest(message),
        nativeHandleRecorded: false,
        engineReportsCancel: activeRecord?.providerCancelSupported !== false,
        message,
        at: at(),
      });
      const fallback =
        activeRecord ??
        createJobRecordFromPlanItem({
          item,
          runId: paths.runId,
          briefId: plan.briefId,
          at: at(),
        });
      let failed: GenerationJobRecord;
      try {
        failed = commitRunnerJob({
          paths,
          fallback,
          update: (latest) =>
            applyJobTransition({
              job: latest,
              status: classified.status,
              at: at(),
              patch: { failure: classified.failure },
              note: classified.failure?.code ?? 'dispatch failed',
            }),
        });
      } catch (commitError) {
        if (commitError instanceof BatchCancellationSignal) {
          activeRecord = commitError.record;
          if (!jobs.some((job) => job.jobId === commitError.record.jobId)) {
            jobs.push(commitError.record);
          }
          reports.push(jobReport({ record: commitError.record, engineCalls: 0 }));
          if (looksLikeUncertainRequest(message)) {
            // Cancellation only stopped this runner's wait. The provider may
            // still be computing, so keep the resource lease unsettled.
            leaseHeld.current = false;
          }
          continue;
        }
        throw commitError;
      }
      jobs.push(failed);
      reports.push(jobReport({ record: failed, engineCalls: 0 }));
      blockers.push({
        code:
          classified.status === 'reconciliation_required'
            ? 'job_reconciliation_required'
            : 'engine_dispatch_failed',
        itemId: item.itemId,
        providerProfileId: item.providerProfileId,
        message,
      });
      exitCode = GENERATION_BATCH_EXIT_CODES.INTERNAL_ERROR;
      if (classified.status === 'reconciliation_required') {
        // 🔴 The lease stays held: the provider may still be computing, and an
        // AbortSignal only stopped *waiting*.
        leaseHeld.current = false;
      }
    } finally {
      if (leaseHeld.current) {
        leaseHeld.current = false;
        releaseLease({ paths, resourceGroup, owner });
      }
    }
  }

  const currentJobs = listParsedJobs(paths);
  const runStatus: GenerationRunRecord['status'] = summarizeRunStatus(currentJobs);
  updateRunRecord(paths, {
    status: runStatus,
    updatedAt: at(),
    jobIds: currentJobs.map((job) => job.jobId),
  });

  return {
    jobs: reports,
    engineRequests,
    blockers,
    activeLeases: listLiveLeases(paths),
    exitCode,
    ...(mediaValidations.length === 0 ? {} : { mediaValidations }),
  };
};
