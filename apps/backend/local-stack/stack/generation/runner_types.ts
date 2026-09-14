// apps/backend/local-stack/stack/generation/runner_types.ts
//
// C-519/C-521: the durable runner's public option and result types.
//
// They live apart from `runner.ts` so the orchestration loop keeps a single
// responsibility and stays inside the source-size ceiling, and so the CLI and
// the terminal operations can name the runner's contract without importing its
// implementation.
//
// Contract: C-519 Durable asset jobs and batch execution;
//           C-521 Music and SFX generation with audio preparation

import type {
  GenerationJobRecord,
  GenerationJobReport,
  GenerationLease,
  GenerationPlan,
  GenerationPlanBlocker,
} from '@aikami/types';
import type { AudioCandidateFinisher } from './audio_preparation.ts';
import type { GenerationStorePaths } from './job_store.ts';
import type { BatchMediaValidationRecord, BatchPreparationHook } from './preparation.ts';
import type { BatchEngineFactory } from './runner_engine.ts';
import type { StagingWriteName } from './staging.ts';

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
  /** C-521: root an owned/licensed import locator must stay inside. */
  readonly audioImportRoot?: string;
  /**
   * C-521: the audio finisher. Defaults to the real host finisher (ffmpeg →
   * decoded-PCM measurement → rendition record). Injected by tests so the
   * success path can be asserted without an encoder.
   */
  readonly audioFinisher?: AudioCandidateFinisher;
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
