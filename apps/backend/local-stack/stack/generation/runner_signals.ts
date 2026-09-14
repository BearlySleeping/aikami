// apps/backend/local-stack/stack/generation/runner_signals.ts
//
// C-519: the two control-flow signals the runner throws. They live in their own
// module so `runner.ts` and `runner_reports.ts` can both name them without an
// import cycle.
//
// Contract: C-519 Durable asset jobs and batch execution

import type { GenerationJobRecord } from '@aikami/types';

/** Internal: a simulated mid-run kill, swallowed by the abort handler. */
export class BatchAbortSignal extends Error {}

/** Internal: cancellation won the job lock before a runner transition. */
export class BatchCancellationSignal extends Error {
  readonly record: GenerationJobRecord;

  constructor(record: GenerationJobRecord) {
    super(`Job ${record.jobId} was cancelled`);
    this.record = record;
  }
}
