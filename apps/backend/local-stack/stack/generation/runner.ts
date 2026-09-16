// apps/backend/local-stack/stack/generation/runner.ts
//
// C-519: the host runner — resource scheduling, the durable claim, recovery
// and the batch/report orchestration behind `generate:batch`.
//
// It is the only place that combines the portable core
// (`@aikami/local-ai`: plan, spec identity, budget, state machine) with the
// host store (filesystem, pid, clock, atomic replacement). Its record/report,
// engine and audio seams live in neighbouring modules.
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

import { GENERATION_BATCH_EXIT_CODES } from '@aikami/constants';
import {
  applyJobTransition,
  buildAssetFragments,
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
  GeneratedAsset,
  GenerationJobRecord,
  GenerationJobReport,
  GenerationLease,
  GenerationPlanBlocker,
  GenerationRunRecord,
} from '@aikami/types';
import { defaultAudioImportRoot, readImportedMaster } from './audio_preparation.ts';
import { withHostedReservation } from './hosted/hosted_dispatch_guard.ts';
import { hostedRecordPatchForJob } from './hosted/hosted_evidence.ts';
import { jobReport } from './job_reports.ts';
import {
  acquireLease,
  isProcessAlive,
  listLiveLeases,
  listParsedJobs,
  readVerifiedBlob,
  releaseLease,
  resourceGroupForEngine,
  updateRunRecord,
  writeBlob,
} from './job_store.ts';
import { applyPreparation, type BatchMediaValidationRecord } from './preparation.ts';
import {
  createLeaseAwareEngine,
  parseEngineId,
  profileForItem,
  resolveItemEngine,
} from './runner_engine.ts';
import {
  candidateRecordFor,
  commitRunnerJob,
  committedProgress,
  failItem,
  handleDispatchFailure,
  prepareAudioOrFail,
  summarizeRunStatus,
} from './runner_reports.ts';
import { BatchAbortSignal } from './runner_signals.ts';
import type { BatchExecutionResult, ExecuteBatchOptions } from './runner_types.ts';
import { appendCandidateRecord, stagePreparedAsset } from './staging.ts';

export {
  type BatchEngineContext,
  type BatchEngineFactory,
  createLeaseAwareEngine,
  parseEngineId,
  profileForItem,
} from './runner_engine.ts';
export { BatchAbortSignal, BatchCancellationSignal } from './runner_signals.ts';

export type { BatchExecutionResult, ExecuteBatchOptions } from './runner_types.ts';

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

  /** The result envelope; the leases are read at return, never cached. */
  const resultEnvelope = (resultExitCode: number, validations = false): BatchExecutionResult => ({
    jobs: [...reports],
    engineRequests,
    blockers: [...blockers],
    activeLeases: listLiveLeases(paths),
    exitCode: resultExitCode,
    ...(validations && mediaValidations.length > 0 ? { mediaValidations } : {}),
  });

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

    // C-521: resolve the engine BEFORE the claim and the lease. A profile whose
    // declared protocol or pinned model set cannot be honoured is a structured
    // blocker — it must not leave a claimed job, a held lease or a half-written
    // record behind, and it must never be served by another protocol's adapter
    // or a different checkpoint.
    //
    // Two items legitimately need no engine: an owned/licensed import (its
    // bytes come from a locator) and a resumed job whose verified raw bytes are
    // already durable.
    const isImportItem = item.providerMode === 'import' && item.importLocator !== undefined;
    const resumeRecord = decision.kind === 'resume' ? decision.job : record;
    const hasVerifiedRawBytes =
      resumeRecord?.rawPath !== undefined && resumeRecord.rawHash !== undefined;
    // A factory refuses an item by returning `undefined` or by throwing; both
    // are refusals, and both become the same structured blocker rather than
    // aborting the report (C-520's `--workflow-profile` refusal arrives here).
    const { engine, refusal: engineFailure } =
      isImportItem || hasVerifiedRawBytes
        ? { engine: undefined, refusal: undefined }
        : resolveItemEngine({ factory: options.engineFactory, context: { item, engineId } });
    if (!isImportItem && !hasVerifiedRawBytes && engine === undefined) {
      blockers.push({
        code: 'provider_unavailable',
        itemId: item.itemId,
        providerProfileId: item.providerProfileId,
        message:
          engineFailure ??
          `No engine transport can honour provider profile "${item.providerProfileId}" (engine ${engineId}, protocol ${profile?.protocol ?? 'unspecified'}, model ${profile?.modelId ?? 'unspecified'}) — the profile's declared protocol or its pinned model set is not resolved on this host, so no dispatch was attempted and no fallback checkpoint was used.`,
      });
      exitCode = GENERATION_BATCH_EXIT_CODES.BLOCKED_PLAN;
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
      // C-524: the engine's flat metadata, when it produced one — a hosted
      // transport reports its request id, model/API version and wall time here.
      let engineMetadata: Readonly<Record<string, string | number>> | undefined;

      if (rawBytes === undefined && item.providerMode === 'import') {
        // C-521 AC-2: an owned/licensed recording is a *master source*, not a
        // special case. Its bytes enter the same preparation and finishing path
        // a generated candidate takes; only the byte source differs.
        const locator = item.importLocator;
        if (locator === undefined) {
          throw new Error(
            `Item "${item.itemId}" resolves to the import provider without an importLocator — the plan should have blocked it.`,
          );
        }
        const imported = await readImportedMaster({
          locator,
          importRoot: options.audioImportRoot ?? defaultAudioImportRoot(),
        });
        if (!imported.ok) {
          // A refused import is a *named* failure, not an anonymous one: the
          // report says which bound the locator broke.
          exitCode = GENERATION_BATCH_EXIT_CODES.INTERNAL_ERROR;
          activeRecord = failItem({
            paths,
            fallback: activeRecord ?? claimed,
            item,
            engineCalls,
            jobs,
            reports,
            blockers,
            code: imported.code,
            message: imported.message,
            blockerCode: 'import_source_unavailable',
            at: at(),
          });
          continue;
        }
        const importedBytes = imported.bytes;
        if (imported.extension !== recipe.output.ext) {
          exitCode = GENERATION_BATCH_EXIT_CODES.INTERNAL_ERROR;
          activeRecord = failItem({
            paths,
            fallback: activeRecord ?? claimed,
            item,
            engineCalls,
            jobs,
            reports,
            blockers,
            code: 'import_format_unsupported',
            message: `The imported recording has extension "${imported.extension}", but recipe "${recipe.id}" requires "${recipe.output.ext}".`,
            blockerCode: 'import_source_unavailable',
            at: at(),
          });
          continue;
        }
        descriptor = await toGeneratedAsset(
          {
            bytes: importedBytes,
            mimeType: mimeTypeForExt(imported.extension),
            engine: engineId,
            // The locator itself is never recorded — the archetype tag and the
            // master hash are, so the run says what was prepared without
            // embedding a filesystem path in provenance.
            metadata: { prompt: item.prompt, providerMode: 'import' },
          },
          recipe,
          engineId,
          { prompt: item.prompt, tag: `batch:${plan.briefId}:${item.itemId}` },
        );
        rawBytes = importedBytes;
        manifest = undefined;
        hashes = undefined;
        preparedBytes = importedBytes;
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
                providerCancelSupported: true,
                candidateCount: latest.candidateCount + 1,
              },
              note: 'owned/licensed recording read from its declared import locator',
            }),
        });
      } else if (rawBytes === undefined) {
        if (engine === undefined) {
          // Defensive: the pre-claim check above refuses this item already.
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
        // C-521: the resolved provider profile's pinned model is authoritative
        // at dispatch; the recipe's `model` is only a fallback for a dispatch
        // that names no profile. Without this, a recipe and a profile could
        // silently disagree about which checkpoint an item was served by.
        const dispatchModel = profile?.modelId ?? recipe.model;
        // C-524: a hosted ceiling is reserved before the outbound request and
        // settled after it, under the store's exclusive lock — a plan-time
        // refusal is not a dispatch-time guard.
        const guarded = await withHostedReservation({
          paths,
          item,
          budget: plan.budget,
          progress,
          at: at(),
          engineMetadataOf: (value: {
            engineMetadata: Readonly<Record<string, string | number>>;
          }) => value.engineMetadata,
          dispatch: async () =>
            runAssetGeneration({
              recipeId: item.recipeId,
              prompt: item.prompt,
              engineId,
              engine: leasedEngine,
              tag: `batch:${plan.briefId}:${item.itemId}`,
              overrides: {
                seed: item.seed,
                ...(dispatchModel === undefined ? {} : { model: dispatchModel }),
                ...(item.estimatedDurationSeconds > 0
                  ? { durationSeconds: item.estimatedDurationSeconds }
                  : {}),
              },
            }),
        });
        if (guarded.kind === 'refused') {
          exitCode = guarded.exitCode;
          activeRecord = failItem({
            paths,
            fallback: activeRecord ?? claimed,
            item,
            engineCalls,
            jobs,
            reports,
            blockers,
            code: 'hosted_reservation_refused',
            message: guarded.blocker.message,
            blockerCode: guarded.blocker.code,
            blocker: guarded.blocker,
            status: guarded.status,
            at: at(),
          });
          continue;
        }
        const staging = guarded.value;
        rawBytes = staging.bytes;
        engineMetadata = staging.engineMetadata;
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
      // C-524: a hosted candidate records the provider's own evidence — its
      // request id, the raw/prepared hashes and the measured wall time.
      const hostedPatch = hostedRecordPatchForJob({
        providerMode: item.providerMode,
        engineId,
        engineMetadata,
        rawHash: blob.sha256,
        preparedHash: descriptor.sha256,
        providerProfileId: item.providerProfileId,
      });
      activeRecord = commitRunnerJob({
        paths,
        fallback: activeRecord ?? claimed,
        update: (latest) => ({
          ...latest,
          rawHash: blob.sha256,
          rawBytes: blob.bytes,
          rawPath: blob.path,
          preparedHash: descriptor.sha256,
          ...hostedPatch,
        }),
      });
      if (options.onRawPersisted?.(activeRecord) === 'abort') {
        updateRunRecord(paths, { status: 'interrupted', updatedAt: at() });
        return resultEnvelope(GENERATION_BATCH_EXIT_CODES.INTERNAL_ERROR);
      }

      // ── C-521: audio preparation ────────────────────────────────────
      const audio = await prepareAudioOrFail({
        recipe,
        item,
        paths,
        fallback: activeRecord ?? claimed,
        engineCalls,
        jobs,
        reports,
        blockers,
        masterBytes: rawBytes,
        at: at(),
        ...(options.audioFinisher === undefined ? {} : { finisher: options.audioFinisher }),
      });
      if (!audio.ok) {
        exitCode = GENERATION_BATCH_EXIT_CODES.INTERNAL_ERROR;
        activeRecord = audio.record;
        continue;
      }
      const audioRenditions = audio.renditions.length === 0 ? undefined : audio.renditions;

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
        record: candidateRecordFor({
          record: activeRecord,
          descriptor,
          at: at(),
          ...(audioRenditions === undefined ? {} : { audioRenditions }),
        }),
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
      reports.push(
        jobReport({
          record: activeRecord,
          engineCalls,
          ...(audioRenditions === undefined ? {} : { audioRenditions }),
        }),
      );
    } catch (error) {
      const outcome = handleDispatchFailure({
        paths,
        error,
        fallback: createJobRecordFromPlanItem({
          item,
          runId: paths.runId,
          briefId: plan.briefId,
          at: at(),
        }),
        ...(activeRecord === undefined ? {} : { activeRecord }),
        at: at(),
      });
      if (outcome.kind === 'aborted') {
        return resultEnvelope(GENERATION_BATCH_EXIT_CODES.INTERNAL_ERROR);
      }
      if (outcome.kind === 'cancelled') {
        activeRecord = outcome.record;
        if (!jobs.some((job) => job.jobId === outcome.record.jobId)) {
          jobs.push(outcome.record);
        }
        reports.push(jobReport({ record: outcome.record, engineCalls: 0 }));
        if (outcome.uncertain) {
          // Cancellation only stopped this runner's wait. The provider may
          // still be computing, so keep the resource lease unsettled.
          leaseHeld.current = false;
        }
        continue;
      }
      jobs.push(outcome.record);
      reports.push(jobReport({ record: outcome.record, engineCalls: 0 }));
      blockers.push({
        code: outcome.uncertain ? 'job_reconciliation_required' : 'engine_dispatch_failed',
        itemId: item.itemId,
        providerProfileId: item.providerProfileId,
        message: outcome.message,
      });
      exitCode = GENERATION_BATCH_EXIT_CODES.INTERNAL_ERROR;
      if (outcome.uncertain) {
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

  return resultEnvelope(exitCode, true);
};
