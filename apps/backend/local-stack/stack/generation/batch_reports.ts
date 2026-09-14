// apps/backend/local-stack/stack/generation/batch_reports.ts
//
// C-519: the read-only and terminal operations on a run — `--status`,
// `--cancel` and `--reconcile`.
//
// They are separated from the orchestrator because they are a different kind
// of operation: they read or settle durable state and never dispatch a
// generation. The honesty rules live here too — a cancellation is a *request*
// until the provider confirms it, and reconciliation is always explicit.
//
// Contract: C-519 Durable asset jobs and batch execution

import { GENERATION_BATCH_EXIT_CODES } from '@aikami/constants';
import { applyJobTransition, resolveCancellation } from '@aikami/local-ai';
import type {
  GenerationBatchReport,
  GenerationJobRecord,
  GenerationJobReport,
  GenerationPlanBlocker,
  GenerationPlanItem,
} from '@aikami/types';
import { jobReport } from './job_reports.ts';
import {
  findJobByRequestKey,
  type GenerationStorePaths,
  listLiveLeases,
  listParsedJobs,
  updateRunRecord,
  withJobRecordLock,
  writeJobRecord,
} from './job_store.ts';
import type { BatchExecutionResult } from './runner.ts';

/** Reads the durable state of a run without dispatching anything. */
export const readBatchStatus = (options: {
  paths: GenerationStorePaths;
  itemIds?: readonly string[];
  configuredEngineUrl?: string;
}): BatchExecutionResult => {
  const jobs = listParsedJobs(options.paths);
  const selected =
    options.itemIds === undefined || options.itemIds.length === 0
      ? jobs
      : jobs.filter((job) => options.itemIds?.includes(job.itemId));
  return {
    jobs: selected.map((record) => jobReport({ record, engineCalls: 0 })),
    engineRequests: 0,
    blockers: [],
    activeLeases: listLiveLeases(options.paths),
    exitCode: GENERATION_BATCH_EXIT_CODES.OK,
  };
};

/**
 * Records a cancellation *request* for the run's unfinished jobs.
 *
 * Nothing here claims compute stopped: `confirmed` stays false until the
 * provider acknowledges it, and a job whose engine reports
 * `capabilities.cancel === false` is reported as polling-stopped only. The
 * lease is deliberately left in place for the same reason.
 */
export const cancelBatch = (options: {
  paths: GenerationStorePaths;
  itemIds?: readonly string[];
  now?: () => Date;
}): BatchExecutionResult => {
  const clock = options.now ?? (() => new Date());
  const at = clock().toISOString();
  const jobs = listParsedJobs(options.paths);
  const reports: GenerationJobReport[] = [];

  for (const job of jobs) {
    if (
      options.itemIds !== undefined &&
      options.itemIds.length > 0 &&
      !options.itemIds.includes(job.itemId)
    ) {
      continue;
    }
    const settled = withJobRecordLock({ paths: options.paths, jobId: job.jobId }, (current) => {
      const latest = current ?? job;
      const cancellable =
        latest.status === 'queued' ||
        latest.status === 'planned' ||
        latest.status === 'running' ||
        latest.status === 'preparing' ||
        latest.status === 'reconciliation_required' ||
        latest.status === 'failed' ||
        latest.status === 'interrupted';
      if (!cancellable) {
        return latest;
      }
      const cancellation = resolveCancellation({
        engineReportsCancel: latest.providerCancelSupported === true,
        requestedAt: at,
        providerAcknowledged: false,
      });
      const cancelled = applyJobTransition({
        job: latest,
        status: 'cancelled',
        at,
        patch: { cancellation },
        note: 'cancellation requested',
      });
      writeJobRecord(options.paths, cancelled);
      return cancelled;
    });
    reports.push(jobReport({ record: settled, engineCalls: 0 }));
  }

  updateRunRecord(options.paths, { status: 'cancelled', updatedAt: at });

  return {
    jobs: reports,
    engineRequests: 0,
    blockers: [],
    // The lease is not released on a request: only a confirmed provider
    // completion (or an explicit reconciliation) frees the resource.
    activeLeases: listLiveLeases(options.paths),
    exitCode: GENERATION_BATCH_EXIT_CODES.OK,
  };
};

/** Reconciles a job whose native handle was never recorded. */
export const reconcileJob = (options: {
  paths: GenerationStorePaths;
  itemId?: string;
  resolution: 'provider-completed' | 'provider-cancelled' | 'no-provider-work';
  now?: () => Date;
}): BatchExecutionResult => {
  const clock = options.now ?? (() => new Date());
  const at = clock().toISOString();
  const jobs = listParsedJobs(options.paths);
  const reports: GenerationJobReport[] = [];
  const blockers: GenerationPlanBlocker[] = [];

  for (const job of jobs) {
    if (job.status !== 'reconciliation_required') {
      continue;
    }
    if (options.itemId !== undefined && job.itemId !== options.itemId) {
      continue;
    }
    const reconciled = withJobRecordLock({ paths: options.paths, jobId: job.jobId }, (current) => {
      const latest = current ?? job;
      if (latest.status !== 'reconciliation_required') {
        return undefined;
      }
      if (options.resolution === 'no-provider-work') {
        const requeued = applyJobTransition({
          job: latest,
          status: 'queued',
          at,
          patch: { failure: undefined },
          note: 'reconciled: the provider performed no work',
        });
        writeJobRecord(options.paths, requeued);
        return requeued;
      }
      const cancelled = applyJobTransition({
        job: latest,
        status: 'cancelled',
        at,
        patch: {
          cancellation: {
            requested: true,
            requestedAt: at,
            confirmed: options.resolution === 'provider-cancelled',
            confirmedAt: options.resolution === 'provider-cancelled' ? at : undefined,
            ...(options.resolution === 'provider-cancelled'
              ? {}
              : {
                  reason: 'Reconciled: the provider completed the work; no bytes were recovered.',
                }),
          },
        },
        note: `reconciled: ${options.resolution}`,
      });
      writeJobRecord(options.paths, cancelled);
      return cancelled;
    });
    if (reconciled !== undefined) {
      reports.push(jobReport({ record: reconciled, engineCalls: 0 }));
    }
  }

  if (reports.length === 0) {
    blockers.push({
      code: 'job_reconciliation_required',
      message:
        options.itemId === undefined
          ? 'No job in this run is in reconciliation_required.'
          : `Job "${options.itemId}" is not in reconciliation_required.`,
    });
  }

  return {
    jobs: reports,
    engineRequests: 0,
    blockers,
    activeLeases: listLiveLeases(options.paths),
    exitCode: 0,
  };
};

/** Convenience: the durable job for an item, if the run has one. */
export const findJobForItem = (
  paths: GenerationStorePaths,
  item: GenerationPlanItem,
): GenerationJobRecord | undefined =>
  findJobByRequestKey(paths, item.requestKey) ??
  listParsedJobs(paths).find((job) => job.effectiveSpecHash === item.effectiveSpecHash);

/** Which report kind each mode produces. */
const REPORT_KIND_BY_MODE: Readonly<
  Record<'plan' | 'run' | 'resume' | 'status' | 'cancel', GenerationBatchReport['kind']>
> = {
  plan: 'generation-plan',
  run: 'generation-run',
  resume: 'generation-resume',
  status: 'generation-status',
  cancel: 'generation-cancel',
};

/** The report `kind` for an execution result. */
export const reportKindForMode = (
  mode: 'plan' | 'run' | 'resume' | 'status' | 'cancel',
): GenerationBatchReport['kind'] => REPORT_KIND_BY_MODE[mode];
