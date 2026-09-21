// apps/backend/local-stack/stack/generation/runner_reports.ts
//
// C-519/C-521: the durable job-record and report plumbing the runner uses on
// every item — committing a transition under the job lock, deriving a run's
// committed progress, shaping a candidate record, and reading a run's status
// from its jobs.
//
// Extracted from `runner.ts` so the item loop stays about *policy* (claim,
// dispatch, prepare, record) rather than about writes.
//
// Contract: C-519 Durable asset jobs and batch execution;
//           C-521 Music and SFX generation with audio preparation

import { GENERATION_PROVIDER_PROFILES } from '@aikami/constants';
import { applyJobTransition, classifySubmissionFailure } from '@aikami/local-ai';
import type {
  AssetRecipe,
  AudioRendition,
  CandidateRecord,
  GeneratedAsset,
  GenerationJobRecord,
  GenerationJobReport,
  GenerationPlanBlocker,
  GenerationPlanItem,
  GenerationRunRecord,
} from '@aikami/types';
import { type AudioCandidateFinisher, prepareAudioCandidate } from './audio_preparation.ts';
import { jobReport } from './job_reports.ts';
import { type GenerationStorePaths, withJobRecordLock, writeJobRecord } from './job_store.ts';
import { BatchAbortSignal, BatchCancellationSignal } from './runner_signals.ts';

/** Internal: cancellation won the job lock before a transition. */
/** Candidate/spend already committed, derived from the persisted jobs. */
export const committedProgress = (jobs: readonly GenerationJobRecord[]) => {
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
export const commitRunnerJob = (options: {
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
export const summarizeRunStatus = (
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
export const looksLikeUncertainRequest = (message: string): boolean =>
  /timed out|timeout|aborted|AbortError|deadline/i.test(message);

/** The C-518-shaped candidate record for one prepared job. */
export const candidateRecordFor = (options: {
  record: GenerationJobRecord;
  descriptor: GeneratedAsset;
  at: string;
  /** C-521: the audio rendition set, master first. Absent for image jobs. */
  audioRenditions?: readonly AudioRendition[];
}): CandidateRecord => ({
  candidateId: options.record.candidateId ?? `${options.record.jobId}-c1`,
  tag: options.descriptor.tag,
  jobId: options.record.jobId,
  status: 'pending_review',
  preparedHash: options.descriptor.sha256,
  ...(options.audioRenditions === undefined
    ? {}
    : { audioRenditions: [...options.audioRenditions] }),
  provenanceState: 'captured',
  createdAt: options.at,
  updatedAt: options.at,
});

/**
 * Records a *named* failure for one item: a durable `failed` transition, the
 * job report and the structured blocker, in one call.
 *
 * A rejected audio master and a refused import both fail this way, which is why
 * the shape lives here rather than being spelled out twice in the item loop.
 *
 * @returns The failed record (the caller keeps it for its own reporting).
 */
export const failItem = (options: {
  paths: GenerationStorePaths;
  fallback: GenerationJobRecord;
  item: GenerationPlanItem;
  engineCalls: number;
  jobs: GenerationJobRecord[];
  reports: GenerationJobReport[];
  blockers: GenerationPlanBlocker[];
  code: string;
  message: string;
  blockerCode: GenerationPlanBlocker['code'];
  /**
   * The status the job ends in. Defaults to `failed`; a refusal whose billable
   * outcome is unresolved (an unsettled hosted reservation) ends at
   * `reconciliation_required` instead, which no automatic retry may leave.
   */
  status?: 'failed' | 'reconciliation_required';
  /**
   * Push this blocker verbatim instead of the derived one, so a refusal that
   * carries machine-readable detail (`budget`, `unavailability`) keeps it.
   */
  blocker?: GenerationPlanBlocker;
  at: string;
}): GenerationJobRecord => {
  const failed = commitRunnerJob({
    paths: options.paths,
    fallback: options.fallback,
    update: (latest) =>
      applyJobTransition({
        job: latest,
        status: options.status ?? 'failed',
        at: options.at,
        patch: { failure: { code: options.code, message: options.message, at: options.at } },
        note: `${options.blockerCode} (${options.code})`,
      }),
  });
  options.jobs.push(failed);
  options.reports.push(jobReport({ record: failed, engineCalls: options.engineCalls }));
  options.blockers.push(
    options.blocker ?? {
      code: options.blockerCode,
      itemId: options.item.itemId,
      providerProfileId: options.item.providerProfileId,
      message: options.message,
    },
  );
  return failed;
};

/** What the runner should do after a dispatch threw. */
export type DispatchFailureOutcome =
  | {
      readonly kind: 'cancelled';
      readonly record: GenerationJobRecord;
      readonly uncertain: boolean;
    }
  | { readonly kind: 'aborted' }
  | {
      readonly kind: 'failed';
      readonly record: GenerationJobRecord;
      readonly uncertain: boolean;
      readonly message: string;
    };

/**
 * Classifies a thrown dispatch into the record the runner must persist.
 *
 * 🔴 `uncertain` is what keeps the resource lease held and the job at
 * `reconciliation_required`: a request that left the process without a recorded
 * native handle may still be computing (and may already be paid for), so it is
 * never an automatic retry.
 *
 * Extracted from `runner.ts` so the item loop reads as policy — the same reason
 * `failItem` lives here.
 */
export const handleDispatchFailure = (options: {
  paths: GenerationStorePaths;
  error: unknown;
  fallback: GenerationJobRecord;
  activeRecord?: GenerationJobRecord;
  at: string;
}): DispatchFailureOutcome => {
  if (options.error instanceof BatchCancellationSignal) {
    return { kind: 'cancelled', record: options.error.record, uncertain: false };
  }
  if (options.error instanceof BatchAbortSignal) {
    return { kind: 'aborted' };
  }
  const message = options.error instanceof Error ? options.error.message : String(options.error);
  const requestLeftProcess = looksLikeUncertainRequest(message);
  const classified = classifySubmissionFailure({
    requestLeftProcess,
    nativeHandleRecorded: false,
    engineReportsCancel: options.activeRecord?.providerCancelSupported !== false,
    message,
    at: options.at,
  });
  const uncertain = classified.status === 'reconciliation_required';
  try {
    const failed = commitRunnerJob({
      paths: options.paths,
      fallback: options.activeRecord ?? options.fallback,
      update: (latest) =>
        applyJobTransition({
          job: latest,
          status: classified.status,
          at: options.at,
          patch: { failure: classified.failure },
          note: classified.failure?.code ?? 'dispatch failed',
        }),
    });
    return { kind: 'failed', record: failed, uncertain, message };
  } catch (commitError) {
    if (commitError instanceof BatchCancellationSignal) {
      // Cancellation only stopped this runner's wait; the provider may still be
      // computing, so `uncertain` still governs whether the lease is released.
      return { kind: 'cancelled', record: commitError.record, uncertain: requestLeftProcess };
    }
    throw commitError;
  }
};

/**
 * Finishes an audio candidate's master, or records the refusal.
 *
 * The master is finished BEFORE it is staged: a rejected master (clipped,
 * near-silent, wrong rate/channels) must not leave staged bytes behind that
 * read as an accepted cue. Extracted from `runner.ts` so the item loop stays
 * about policy.
 */
export const prepareAudioOrFail = async (options: {
  recipe: AssetRecipe;
  item: GenerationPlanItem;
  paths: GenerationStorePaths;
  fallback: GenerationJobRecord;
  engineCalls: number;
  jobs: GenerationJobRecord[];
  reports: GenerationJobReport[];
  blockers: GenerationPlanBlocker[];
  masterBytes: Uint8Array;
  at: string;
  finisher?: AudioCandidateFinisher;
}): Promise<
  | { readonly ok: true; readonly renditions: readonly AudioRendition[] }
  | { readonly ok: false; readonly record: GenerationJobRecord }
> => {
  if (options.recipe.modality !== 'audio') {
    return { ok: true, renditions: [] };
  }
  const prepared = await prepareAudioCandidate({
    masterBytes: options.masterBytes,
    preparationProfile: options.item.preparationProfile,
    runDir: options.paths.runDir,
    slug: options.fallback.jobId,
    createdAt: options.at,
    ...(options.finisher === undefined ? {} : { finisher: options.finisher }),
  });
  if (prepared.ok) {
    return { ok: true, renditions: prepared.renditions };
  }
  return {
    ok: false,
    record: failItem({
      paths: options.paths,
      fallback: options.fallback,
      item: options.item,
      engineCalls: options.engineCalls,
      jobs: options.jobs,
      reports: options.reports,
      blockers: options.blockers,
      code: prepared.code,
      message: prepared.message,
      blockerCode: 'audio_master_rejected',
      at: options.at,
    }),
  };
};
