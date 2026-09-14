// apps/backend/local-stack/stack/generation/runner_reports.ts
//
// C-519/C-521: the durable job-record and report plumbing the runner uses on
// every item — committing a transition under the job lock, deriving a run's
// committed progress, shaping a job report and a candidate record, and reading
// a run's status from its jobs.
//
// Extracted from `runner.ts` so the item loop stays about *policy* (claim,
// dispatch, prepare, record) rather than about writes.
//
// Contract: C-519 Durable asset jobs and batch execution;
//           C-521 Music and SFX generation with audio preparation

import {
  applyJobTransition,
} from '@aikami/local-ai';
import type {
  AudioRendition,
  CandidateRecord,
  GeneratedAsset,
  GenerationJobRecord,
  GenerationJobReport,
  GenerationPlanBlocker,
  GenerationPlanItem,
  GenerationRunRecord,
} from '@aikami/types';
import { GENERATION_PROVIDER_PROFILES } from '@aikami/constants';
import { writeJobRecord, withJobRecordLock, type GenerationStorePaths } from './job_store.ts';
import { BatchCancellationSignal } from './runner_signals.ts';

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

/** The `GenerationJobReport` for a job record. */
export const jobReport = (options: {
  record: GenerationJobRecord;
  engineCalls: number;
  resolvedToJobId?: string;
  /** C-521: the audio rendition set, so the transcript carries the lineage. */
  audioRenditions?: readonly AudioRendition[];
}): GenerationJobReport => ({
  jobId: options.record.jobId,
  itemId: options.record.itemId,
  status: options.record.status,
  engineCalls: options.engineCalls,
  ...(options.audioRenditions === undefined
    ? {}
    : { audioRenditions: [...options.audioRenditions] }),
  ...(options.resolvedToJobId === undefined ? {} : { resolvedToJobId: options.resolvedToJobId }),
  ...(options.record.candidateId === undefined ? {} : { candidateId: options.record.candidateId }),
  ...(options.record.preparedHash === undefined
    ? {}
    : { preparedHash: options.record.preparedHash }),
  ...(options.record.stagedPath === undefined ? {} : { stagedPath: options.record.stagedPath }),
  ...(options.record.cancellation === undefined
    ? {}
    : { cancellation: options.record.cancellation }),
  ...(options.record.failure === undefined ? {} : { failure: options.record.failure }),
});

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
  at: string;
}): GenerationJobRecord => {
  const failed = commitRunnerJob({
    paths: options.paths,
    fallback: options.fallback,
    update: (latest) =>
      applyJobTransition({
        job: latest,
        status: 'failed',
        at: options.at,
        patch: { failure: { code: options.code, message: options.message, at: options.at } },
        note: `${options.blockerCode} (${options.code})`,
      }),
  });
  options.jobs.push(failed);
  options.reports.push(jobReport({ record: failed, engineCalls: options.engineCalls }));
  options.blockers.push({
    code: options.blockerCode,
    itemId: options.item.itemId,
    providerProfileId: options.item.providerProfileId,
    message: options.message,
  });
  return failed;
};
