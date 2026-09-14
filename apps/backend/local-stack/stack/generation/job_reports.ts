// apps/backend/local-stack/stack/generation/job_reports.ts
//
// C-519: the projection from a durable `GenerationJobRecord` to the report the
// CLI prints.
//
// It lives on its own so the orchestrator, the terminal operations and the
// tests all share one projection — a second copy would let the printed report
// drift from the persisted job.
//
// Contract: C-519 Durable asset jobs and batch execution

import type { AudioRendition, GenerationJobRecord, GenerationJobReport } from '@aikami/types';

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
