// scripts/src/lib/agents/evaluation/runner.test.ts
//
// C-480: end-to-end with the fake provider. Plan mode never launches an
// attempt or spends; paid mode without authorization/caps refuses to
// start; a full fake run produces a report with repetitions and hashes
// recorded, and budget exhaustion cancels remaining owned attempts while
// keeping partial results.

import { describe, expect, it } from 'bun:test';
import { RunBudget } from './budget.ts';
import { FakeEvalProvider, fakeUsage } from './fake_provider.ts';
import { runEvaluation } from './runner.ts';
import { getTask } from './task_registry.ts';
import type { CatalogueEntry, EvalConfig, RunAuthorization } from './types.ts';

const CATALOGUE: CatalogueEntry = {
  family: 'flash',
  provider: 'deepinfra',
  model: 'deepseek-ai/DeepSeek-V4-Flash',
  available: true,
};

const CONFIG: EvalConfig = {
  id: 'flash-high',
  family: 'flash',
  catalogue: CATALOGUE,
  thinking: 'high',
  cacheCondition: 'cold',
};

const TASK_ID = 'pure_typescript_v1';
const CORRECT_PATCH = {
  'unique_sorted.ts':
    'export const uniqueSorted = (values: number[]): number[] => [...new Set(values)].sort((a, b) => a - b);\n',
};

describe('C-480 runner', () => {
  it('plan mode runs zero attempts and spends nothing', async () => {
    const budget = new RunBudget(undefined);
    const authorization: RunAuthorization = {
      mode: 'plan',
      authorizedAt: new Date().toISOString(),
    };
    const provider = new FakeEvalProvider();

    const report = await runEvaluation({
      runId: 'plan-run',
      authorization,
      configs: [CONFIG],
      repetitions: 3,
      provider,
      budget,
    });

    expect(report.attempts).toHaveLength(0);
    expect(provider.runCalls).toHaveLength(0);
    expect(budget.spentUsd).toBe(0);
  });

  it('paid mode without an authorized budget refuses to start', async () => {
    const budget = new RunBudget(undefined);
    const authorization: RunAuthorization = {
      mode: 'paid',
      authorizedTasks: [TASK_ID],
      authorizedConfigIds: [CONFIG.id],
      authorizedAt: new Date().toISOString(),
    };
    const provider = new FakeEvalProvider();

    await expect(
      runEvaluation({
        runId: 'paid-run',
        authorization,
        configs: [CONFIG],
        taskIds: [TASK_ID],
        repetitions: 1,
        provider,
        budget,
      }),
    ).rejects.toThrow(/authorized RunBudget/);
    expect(provider.runCalls).toHaveLength(0);
  });

  it('paid mode without explicit authorizedTasks/authorizedConfigIds refuses to start', async () => {
    const budget = new RunBudget({ maxCostUsd: 10, maxTurns: 100, maxElapsedMinutes: 60 });
    const authorization: RunAuthorization = {
      mode: 'paid',
      caps: budget.caps,
      authorizedAt: new Date().toISOString(),
    };
    const provider = new FakeEvalProvider();

    await expect(
      runEvaluation({
        runId: 'paid-run-2',
        authorization,
        configs: [CONFIG],
        taskIds: [TASK_ID],
        repetitions: 1,
        provider,
        budget,
      }),
    ).rejects.toThrow(/authorizedTasks/);
  });

  it('a full authorized fake run records repetitions and frozen hashes', async () => {
    const task = getTask(TASK_ID);
    if (!task) {
      throw new Error('fixture task missing');
    }
    const budget = new RunBudget({ maxCostUsd: 100, maxTurns: 1000, maxElapsedMinutes: 600 });
    const authorization: RunAuthorization = {
      mode: 'paid',
      caps: budget.caps,
      authorizedTasks: [TASK_ID],
      authorizedConfigIds: [CONFIG.id],
      authorizedAt: new Date().toISOString(),
    };
    const provider = new FakeEvalProvider();
    const repetitions = 3;
    for (let i = 0; i < repetitions; i++) {
      provider.queue(TASK_ID, { patch: CORRECT_PATCH, usage: fakeUsage() });
    }

    const report = await runEvaluation({
      runId: 'full-run',
      authorization,
      configs: [CONFIG],
      taskIds: [TASK_ID],
      repetitions,
      provider,
      budget,
    });

    expect(report.attempts).toHaveLength(repetitions);
    expect(report.attempts.every((a) => a.outcome === 'accepted')).toBe(true);
    expect(new Set(report.attempts.map((a) => a.hashes.taskHash)).size).toBe(1);
    expect(report.summaries[0]?.sampleSize).toBe(repetitions);
  });

  it('budget exhaustion cancels remaining owned attempts and keeps partial results', async () => {
    const task = getTask(TASK_ID);
    if (!task) {
      throw new Error('fixture task missing');
    }
    // Cap tight enough that the second attempt exhausts the budget.
    const budget = new RunBudget({ maxCostUsd: 0.0015, maxTurns: 1000, maxElapsedMinutes: 600 });
    const authorization: RunAuthorization = {
      mode: 'paid',
      caps: budget.caps,
      authorizedTasks: [TASK_ID],
      authorizedConfigIds: [CONFIG.id],
      authorizedAt: new Date().toISOString(),
    };
    const provider = new FakeEvalProvider();
    const repetitions = 5;
    for (let i = 0; i < repetitions; i++) {
      provider.queue(TASK_ID, {
        patch: CORRECT_PATCH,
        usage: fakeUsage({
          monetary: { USD: { amount: 0.001, currency: 'USD', provenance: 'provider_reported' } },
        }),
      });
    }

    const report = await runEvaluation({
      runId: 'exhaust-run',
      authorization,
      configs: [CONFIG],
      taskIds: [TASK_ID],
      repetitions,
      provider,
      budget,
    });

    expect(report.attempts.length).toBeGreaterThan(0);
    expect(report.attempts.length).toBeLessThan(repetitions);
    expect(budget.exhausted).toBe(true);
  });
});
