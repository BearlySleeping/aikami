// apps/frontend/client/src/lib/services/worldgen/world_gen_stage_runner.ts
//
// G01 — the stage pipeline: what runs, when, how often, and what it is
// allowed to write.
//
// Split out of `world_gen_draft_service.svelte.ts` so the RUN (identity,
// cancellation, deadlines, acceptance, persistence) reads as one thing and the
// PIPELINE reads as another. The split is not cosmetic: every rule in here is
// about the graph and the clock, and every rule in the service is about the
// draft's identity on the device. Mixing them is what produced a 950-line
// module whose hardest function was also its least readable.
//
// No imports from the service. This module knows a `StageRunnerPort` and a run's
// data; it does not know what a draft row is.

import { schemaCheck, type WorldGenDraftInput, type WorldGenDraftStage } from '@aikami/schemas';
import type { WorldGenDraftTextCapabilities } from './types/world_gen_draft_service.types.ts';
import { absorbStage, type WorldGenDraftAccumulator } from './world_gen_draft_builder.ts';
import {
  readyStages,
  stageFingerprint,
  WORLD_GEN_STAGE_LABELS,
  type WorldGenStageContext,
} from './world_gen_stage_graph.ts';
import {
  assembleWorldGenStagePrompt,
  WORLD_GEN_DRAFT_SYSTEM_PROMPT,
  WORLD_GEN_STAGE_SCHEMAS,
} from './world_gen_stage_prompts.ts';

/** The stages a run produces, in dependency order. */
const STAGES: readonly WorldGenDraftStage[] = [
  'setting',
  'cast',
  'places',
  'hudWidgets',
  'arcs',
] as const;

/** A stage failure worth naming to the user. */
export type StageFailure = { stage: WorldGenDraftStage; message: string };

/**
 * One run's data, as the pipeline sees it.
 *
 * Deliberately NOT the service's live run object. The service holds exactly one
 * of these per run and hands it in; the pipeline never reaches back into the
 * service to ask "am I still the current run?" — it asks the port, which is the
 * single place that answer is defined.
 */
export type PipelineRun = {
  readonly runId: string;
  readonly controller: AbortController;
  readonly deadlineAt: number;
  /** The draft this run is filling, stage by stage. */
  readonly accumulator: WorldGenDraftAccumulator;
  /** Stage → fingerprint recorded when that stage succeeded in THIS run. */
  readonly checkpoints: Map<WorldGenDraftStage, string>;
  /** Stage → attempts spent in THIS run. */
  readonly attempts: Map<WorldGenDraftStage, number>;
};

/** What the pipeline needs from the service. Every method is a decision. */
export type StageRunnerPort = {
  readonly text: WorldGenDraftTextCapabilities;
  /** Total attempts per invalidated stage, including the first. */
  readonly maxAttempts: number;
  /** Whole-run budget, used only to phrase the overrun message. */
  readonly budgetMs: number;
  /** The wizard answers this run is a function of. */
  readonly input: WorldGenDraftInput;
  /** Whether the pipeline's run is still the live one (I4). */
  ownsRun(runId: string): boolean;
  /** Publishes per-round progress for the UI readout. */
  publishProgress(
    completed: readonly WorldGenDraftStage[],
    failures: readonly StageFailure[],
  ): void;
  debug(event: string, data?: Record<string, unknown>): void;
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Drives the stage graph to completion for one run.
 *
 * @throws When the run's shared deadline expires before the graph settles. The
 * deadline is checked HERE as well as being forwarded to the provider:
 * forwarding alone is not a bound, because a provider that ignores
 * `deadlineAt` would otherwise let the orchestration keep issuing retries long
 * after the budget was spent.
 */
export const runPipeline = async (port: StageRunnerPort, run: PipelineRun): Promise<void> => {
  const { signal } = run.controller;
  const completed = new Set<WorldGenDraftStage>(
    STAGES.filter((stage) => run.checkpoints.has(stage)),
  );
  const failures: StageFailure[] = [];

  while (!signal.aborted) {
    assertBudgetLeft(port, run);
    const pending = pendingStages(port, run, completed);
    if (pending.length === 0) {
      return;
    }
    const before = completed.size;

    // Every sibling promise must settle before the next round is issued. A
    // fast failure that starts a retry while siblings are still in flight
    // multiplies provider requests for the same run.
    const settled = await Promise.allSettled(
      pending.map((stage) => attemptStage(port, run, stage)),
    );

    if (signal.aborted) {
      return;
    }
    assertBudgetLeft(port, run);

    settled.forEach((result, index) => {
      const stage = pending[index] as WorldGenDraftStage;
      if (result.status === 'fulfilled') {
        completed.add(stage);
      } else {
        failures.push({ stage, message: describeFailure(result.reason) });
      }
    });
    port.publishProgress([...completed], [...failures]);

    // A round that completed nothing has exhausted the attempt budget of every
    // stage it touched; re-issuing would loop forever against a provider that
    // is down rather than failing.
    if (completed.size === before) {
      return;
    }
  }
};

/** The stages this run still owes, in execution order. */
const pendingStages = (
  port: StageRunnerPort,
  run: PipelineRun,
  completed: ReadonlySet<WorldGenDraftStage>,
): WorldGenDraftStage[] => {
  const context = stageContext(port.input, run.accumulator);
  return readyStages(completed, run.controller.signal.aborted).filter(
    (stage) =>
      run.checkpoints.get(stage) !== stageFingerprint(stage, context) &&
      // A stage that has spent its attempt budget is not re-issued; letting the
      // outer loop pick it up again would turn "3 attempts" into an unbounded
      // request stream against a provider that is down.
      (run.attempts.get(stage) ?? 0) < port.maxAttempts,
  );
};

/** Throws when the run's shared deadline has passed. */
const assertBudgetLeft = (port: StageRunnerPort, run: PipelineRun): void => {
  if (Date.now() < run.deadlineAt) {
    return;
  }
  throw new Error(
    `World generation exceeded its ${Math.round(port.budgetMs / 1000)}s budget before every stage completed.`,
  );
};

/** The resolved context a stage may read. */
export const stageContext = (
  input: WorldGenDraftInput,
  accumulator: WorldGenDraftAccumulator,
): WorldGenStageContext => ({ input, setting: accumulator.setting, cast: accumulator.cast });

// ---------------------------------------------------------------------------
// One stage
// ---------------------------------------------------------------------------

/**
 * Runs one stage, honouring its attempt budget.
 *
 * The retry lives HERE, inside the stage, rather than in a loop that re-issues
 * the whole pipeline. That is what makes "a succeeded stage is never re-issued
 * because a sibling failed" structural rather than a convention.
 */
const attemptStage = async (
  port: StageRunnerPort,
  run: PipelineRun,
  stage: WorldGenDraftStage,
): Promise<void> => {
  for (;;) {
    assertAttemptAllowed(port, run, stage);
    const attempt = claimAttempt(run, stage);
    try {
      const raw = await requestStage(port, run, stage, attempt);
      absorbStageResult(port, run, stage, raw);
      return;
    } catch (error) {
      // An abort is terminal — retrying after the user navigated away is how a
      // wizard spends provider budget nobody is waiting for. An exhausted
      // attempt budget is the other terminal case.
      if (run.controller.signal.aborted || attempt >= port.maxAttempts) {
        throw error;
      }
      port.debug('attemptStage:retry', { stage, attempt, runId: run.runId });
    }
  }
};

/**
 * The pre-attempt gate: not aborted, budget not spent, run still ours.
 *
 * Reading the attempt count below is itself a shared mutation and it happens
 * after the PREVIOUS attempt's `await`, so it is guarded here rather than
 * assumed safe.
 */
const assertAttemptAllowed = (
  port: StageRunnerPort,
  run: PipelineRun,
  stage: WorldGenDraftStage,
): void => {
  const { signal } = run.controller;
  if (signal.aborted || !port.ownsRun(run.runId)) {
    throw new DOMException('Aborted', 'AbortError');
  }
  if (Date.now() >= run.deadlineAt) {
    throw new Error(
      `World generation exceeded its ${Math.round(port.budgetMs / 1000)}s budget before the ${
        WORLD_GEN_STAGE_LABELS[stage]
      } stage completed.`,
    );
  }
  void port;
};

/** Claims the next attempt number for a stage. */
const claimAttempt = (run: PipelineRun, stage: WorldGenDraftStage): number => {
  const attempt = (run.attempts.get(stage) ?? 0) + 1;
  run.attempts.set(stage, attempt);
  return attempt;
};

/** Issues one structured request for one stage. */
const requestStage = async (
  port: StageRunnerPort,
  run: PipelineRun,
  stage: WorldGenDraftStage,
  attempt: number,
): Promise<unknown> => {
  const deadline = new AbortController();
  const timer = setTimeout(
    () =>
      deadline.abort(new DOMException('World generation exceeded its run budget.', 'TimeoutError')),
    Math.max(0, run.deadlineAt - Date.now()),
  );
  const signal = AbortSignal.any([run.controller.signal, deadline.signal]);
  try {
    return await settleOrAbort(
      port.text.extractStructure({
        schema: WORLD_GEN_STAGE_SCHEMAS[stage],
        schemaName: `WorldGenDraft_${stage}`,
        prompt: assembleWorldGenStagePrompt(stage, stageContext(port.input, run.accumulator)),
        systemPrompt: WORLD_GEN_DRAFT_SYSTEM_PROMPT,
        signal,
        // I2 — every stage of one run carries the same absolute deadline.
        deadlineAt: run.deadlineAt,
        task: WORLD_GEN_DRAFT_TASK,
        // One logical request per (run, stage, attempt): a retried stage is still
        // one request, and diagnostics need to name which one.
        requestId: `${run.runId}:${stage}:${attempt}`,
        scope: `worldgen:${run.runId}`,
      }),
      signal,
    );
  } finally {
    clearTimeout(timer);
  }
};

/** Bounds waiting even when a provider ignores cancellation or its deadline. */
const settleOrAbort = async (request: Promise<unknown>, signal: AbortSignal): Promise<unknown> => {
  if (signal.aborted) {
    throw signal.reason;
  }
  let onAbort = (): void => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([request, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
};

/**
 * Folds a stage's payload in — the identity boundary.
 *
 * A cancel followed by a NEW generate retires this run. Absorbing now would
 * splice the old run's payload into the new run's accumulator, and recording
 * the checkpoint would make the new run believe it already has this stage. The
 * caller's outer check cannot help here: it runs after `runPipeline` returns,
 * long after this write.
 */
const absorbStageResult = (
  port: StageRunnerPort,
  run: PipelineRun,
  stage: WorldGenDraftStage,
  raw: unknown,
): void => {
  if (!port.ownsRun(run.runId)) {
    port.debug('attemptStage:stale-result-dropped', { stage, runId: run.runId });
    throw new DOMException('Aborted', 'AbortError');
  }
  assertAttemptAllowed(port, run, stage);
  if (!schemaCheck(WORLD_GEN_STAGE_SCHEMAS[stage], raw)) {
    throw new Error(
      `The ${WORLD_GEN_STAGE_LABELS[stage]} response does not match its bounded schema.`,
    );
  }
  absorbStage(run.accumulator, stage, raw);
  run.checkpoints.set(stage, stageFingerprint(stage, stageContext(port.input, run.accumulator)));
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** The existing background text task world generation runs under. */
const WORLD_GEN_DRAFT_TASK = 'agent-world' as const;

/** Renders a stage failure as a sentence the UI can show. */
const describeFailure = (reason: unknown): string =>
  reason instanceof Error ? reason.message : 'Stage failed for no stated reason.';
