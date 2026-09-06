// scripts/src/lib/agents/evaluation/runner.ts
//
// C-480: orchestrates preflight, the attempt loop and budget enforcement.
// `plan` mode (the default) never launches a provider attempt and never
// spends — it only resolves the catalogue and reports what would run.
// `paid` mode requires an authorized RunBudget plus explicit task and
// config selection; exhaustion cancels remaining owned attempts and keeps
// whatever attempts already completed (AC-4).

import { runAcceptance } from './acceptance_runner.ts';
import type { RunBudget } from './budget.ts';
import type { EvalProviderAdapter } from './provider.ts';
import { buildReport } from './reporter.ts';
import { computeTaskHashes, getTask, listVisibleTasks } from './task_registry.ts';
import type {
  AttemptResult,
  EvalConfig,
  EvalReport,
  EvalTask,
  RunAuthorization,
  UsageRecord,
} from './types.ts';
import { prepareSandbox } from './worktree_fixture.ts';

export type RunnerOptions = {
  readonly runId: string;
  readonly authorization: RunAuthorization;
  readonly configs: readonly EvalConfig[];
  readonly taskIds?: readonly string[];
  readonly repetitions: number;
  readonly provider: EvalProviderAdapter;
  readonly budget: RunBudget;
  /** Cap on USD spend per single attempt, before the run-wide cap applies. */
  readonly perAttemptCapUsd?: number;
};

const resolveTasks = (taskIds: readonly string[] | undefined): readonly EvalTask[] => {
  if (!taskIds) {
    return listVisibleTasks();
  }
  return taskIds.map((id) => {
    const task = getTask(id);
    if (!task) {
      throw new Error(`Unknown evaluation task id: "${id}"`);
    }
    return task;
  });
};

/**
 * Run one evaluation. In `plan` mode this performs no attempts and spends
 * nothing — the report has zero attempts and exists only to prove
 * task/config resolution succeeded. `paid` mode requires
 * `options.budget.authorized`; every launched attempt is recorded before
 * the loop checks the budget again, so partial results always survive an
 * exhaustion mid-run.
 */
export const runEvaluation = async (options: RunnerOptions): Promise<EvalReport> => {
  const tasks = resolveTasks(options.taskIds);

  if (options.authorization.mode === 'plan') {
    return buildReport({
      runId: options.runId,
      authorization: options.authorization,
      attempts: [],
    });
  }

  if (!options.budget.authorized) {
    throw new Error(
      'Paid evaluation requires an authorized RunBudget with explicit cost/turn/time caps. ' +
        'No caps were supplied — refusing to start rather than defaulting to unlimited spend.',
    );
  }
  if (!(options.authorization.authorizedTasks && options.authorization.authorizedConfigIds)) {
    throw new Error(
      'Paid evaluation requires explicit authorizedTasks and authorizedConfigIds on the RunAuthorization.',
    );
  }

  const authorizedTaskIds = new Set(options.authorization.authorizedTasks);
  const authorizedConfigIds = new Set(options.authorization.authorizedConfigIds);
  const attempts: AttemptResult[] = [];
  const plannedTaskCount = tasks.filter((task) => authorizedTaskIds.has(task.id)).length;
  const plannedConfigCount = options.configs.filter((config) =>
    authorizedConfigIds.has(config.id),
  ).length;
  const plannedAttemptCount = plannedTaskCount * plannedConfigCount * options.repetitions;
  const runWideCostCap = options.budget.caps?.maxCostUsd;
  if (runWideCostCap === undefined) {
    throw new Error('Authorized RunBudget is missing its run-wide cost cap.');
  }
  const perAttemptCapUsd =
    options.perAttemptCapUsd ?? runWideCostCap / Math.max(1, plannedAttemptCount);

  outer: for (const task of tasks) {
    if (!authorizedTaskIds.has(task.id)) {
      continue;
    }
    for (const config of options.configs) {
      if (!authorizedConfigIds.has(config.id)) {
        continue;
      }
      for (let repetition = 1; repetition <= options.repetitions; repetition++) {
        if (!options.budget.canStartAttempt()) {
          options.budget.cancelOwnedWork();
          break outer;
        }

        const attemptStartedAt = Date.now();
        let attempt: AttemptResult;
        try {
          attempt = await runOneAttempt({
            task,
            config,
            repetition,
            provider: options.provider,
            budget: options.budget,
            perAttemptCapUsd,
          });
        } catch (error) {
          attempt = providerErrorAttempt({
            task,
            config,
            repetition,
            elapsedSeconds: (Date.now() - attemptStartedAt) / 1000,
            error,
          });
          attempts.push(attempt);
          options.budget.record({
            usage: attempt.usage,
            elapsedMinutes: attempt.usage.elapsedSeconds / 60,
          });
          options.budget.cancelOwnedWork();
          break outer;
        }
        attempts.push(attempt);

        const elapsedMinutes = attempt.usage.elapsedSeconds / 60;
        options.budget.record({ usage: attempt.usage, elapsedMinutes });
      }
    }
  }

  return buildReport({ runId: options.runId, authorization: options.authorization, attempts });
};

const providerErrorAttempt = (options: {
  task: EvalTask;
  config: EvalConfig;
  repetition: number;
  elapsedSeconds: number;
  error: unknown;
}): AttemptResult => {
  const usage: UsageRecord = {
    model: options.config.catalogue.model,
    provider: options.config.catalogue.provider,
    thinkingLevel: options.config.thinking,
    configVersion: '1',
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    elapsedSeconds: options.elapsedSeconds,
    toolErrors: 1,
    retries: 0,
    monetary: { USD: { amount: 0, currency: 'USD', provenance: 'unknown' } },
    complete: false,
    eventId: `${options.task.id}-${options.config.id}-${Date.now()}-provider-error`,
    finalizedAt: new Date().toISOString(),
    externalCoverageComplete: false,
  };
  return {
    taskId: options.task.id,
    configId: options.config.id,
    repetition: options.repetition,
    outcome: 'error',
    firstPass: false,
    retries: 0,
    toolFailures: 1,
    usage,
    hashes: computeTaskHashes({ task: options.task, config: options.config }),
    diagnostics: `Provider attempt rejected: ${options.error instanceof Error ? options.error.message : String(options.error)}`,
  };
};

const runOneAttempt = async (options: {
  task: EvalTask;
  config: EvalConfig;
  repetition: number;
  provider: EvalProviderAdapter;
  budget: RunBudget;
  perAttemptCapUsd: number;
}): Promise<AttemptResult> => {
  const sandbox = await prepareSandbox(options.task);
  const hashes = computeTaskHashes({ task: options.task, config: options.config });

  try {
    const result = await options.provider.runAttempt({
      task: options.task,
      config: options.config,
      sandboxPath: sandbox.path,
      budgetEnv: options.budget.authorized
        ? options.budget.attemptEnv(options.perAttemptCapUsd)
        : undefined,
    });

    if (result.crashed) {
      return {
        taskId: options.task.id,
        configId: options.config.id,
        repetition: options.repetition,
        outcome: 'error',
        firstPass: false,
        retries: result.retries,
        toolFailures: result.toolFailures,
        usage: result.usage,
        hashes,
        diagnostics: result.diagnostics,
      };
    }

    const acceptance = await runAcceptance({ task: options.task, sandboxPath: sandbox.path });
    return {
      taskId: options.task.id,
      configId: options.config.id,
      repetition: options.repetition,
      outcome: acceptance.accepted ? 'accepted' : 'rejected',
      firstPass: acceptance.accepted && result.retries === 0,
      retries: result.retries,
      toolFailures: result.toolFailures,
      usage: result.usage,
      hashes,
      diagnostics: acceptance.diagnostics,
    };
  } finally {
    await sandbox.cleanup();
  }
};
