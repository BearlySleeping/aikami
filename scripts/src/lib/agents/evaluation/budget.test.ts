// scripts/src/lib/agents/evaluation/budget.test.ts
//
// C-480 AC-4: paid work requires explicit bounded authorization. No caps
// defaults to unlimited never happens; exhaustion cancels owned work and
// preserves partial results; unknown billing blocks further paid attempts
// under a cap that can't be enforced.

import { describe, expect, it } from 'bun:test';
import { RunBudget } from './budget.ts';
import type { UsageRecord } from './types.ts';

const usage = (overrides: Partial<UsageRecord> = {}): UsageRecord => ({
  model: 'm',
  provider: 'p',
  thinkingLevel: 'high',
  configVersion: '1',
  turns: 1,
  inputTokens: 10,
  outputTokens: 10,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 20,
  elapsedSeconds: 1,
  toolErrors: 0,
  retries: 0,
  monetary: { USD: { amount: 1, currency: 'USD', provenance: 'provider_reported' } },
  complete: true,
  eventId: `evt-${Math.random()}`,
  finalizedAt: new Date().toISOString(),
  externalCoverageComplete: true,
  ...overrides,
});

describe('AC-4: budget authorization', () => {
  it('an unauthorized budget (no caps) cannot start any attempt', () => {
    const budget = new RunBudget(undefined);
    expect(budget.authorized).toBe(false);
    expect(budget.canStartAttempt()).toBe(false);
  });

  it('record() without caps throws rather than silently accepting unlimited spend', () => {
    const budget = new RunBudget(undefined);
    expect(() => budget.record({ usage: usage(), elapsedMinutes: 1 })).toThrow();
  });

  it('authorized budget allows attempts until a cap is exhausted', () => {
    const budget = new RunBudget({ maxCostUsd: 3, maxTurns: 100, maxElapsedMinutes: 60 });
    expect(budget.canStartAttempt()).toBe(true);

    budget.record({
      usage: usage({
        monetary: { USD: { amount: 1, currency: 'USD', provenance: 'provider_reported' } },
      }),
      elapsedMinutes: 1,
    });
    expect(budget.canStartAttempt()).toBe(true);

    budget.record({
      usage: usage({
        monetary: { USD: { amount: 2, currency: 'USD', provenance: 'provider_reported' } },
      }),
      elapsedMinutes: 1,
    });
    expect(budget.exhausted).toBe(true);
    expect(budget.exhaustedReason).toBe('cost');
    expect(budget.canStartAttempt()).toBe(false);
  });

  it('cancelOwnedWork stops further attempts but does not erase spentUsd already recorded', () => {
    const budget = new RunBudget({ maxCostUsd: 100, maxTurns: 100, maxElapsedMinutes: 60 });
    budget.record({ usage: usage(), elapsedMinutes: 1 });
    const spentBefore = budget.spentUsd;
    budget.cancelOwnedWork();
    expect(budget.canStartAttempt()).toBe(false);
    expect(budget.spentUsd).toBe(spentBefore);
  });

  it('unknown/incomplete billing exhausts the budget rather than counting as zero spend', () => {
    const budget = new RunBudget({ maxCostUsd: 100, maxTurns: 100, maxElapsedMinutes: 60 });
    budget.record({
      usage: usage({ monetary: { USD: { amount: 0, currency: 'USD', provenance: 'unknown' } } }),
      elapsedMinutes: 1,
    });
    expect(budget.exhausted).toBe(true);
    expect(budget.exhaustedReason).toBe('unknown_billing');
  });

  it('turns and elapsed-minutes caps exhaust the budget independently of cost', () => {
    const turnsBudget = new RunBudget({ maxCostUsd: 100, maxTurns: 2, maxElapsedMinutes: 60 });
    turnsBudget.record({ usage: usage({ turns: 2, monetary: {} }), elapsedMinutes: 1 });
    expect(turnsBudget.exhaustedReason).toBe('turns');

    const timeBudget = new RunBudget({ maxCostUsd: 100, maxTurns: 100, maxElapsedMinutes: 10 });
    timeBudget.record({ usage: usage({ monetary: {} }), elapsedMinutes: 15 });
    expect(timeBudget.exhaustedReason).toBe('elapsed_minutes');
  });

  it('attemptEnv sets PI_SOFT_SPEND/PI_HARD_SPEND/PI_MAX_TURNS/PI_MAX_RUN_MINUTES', () => {
    const budget = new RunBudget({ maxCostUsd: 5, maxTurns: 50, maxElapsedMinutes: 30 });
    const env = budget.attemptEnv(2);
    expect(env.PI_SOFT_SPEND).toBe('2.00');
    expect(env.PI_HARD_SPEND).toBe('3.00');
    expect(env.PI_MAX_TURNS).toBe('50');
    expect(env.PI_MAX_RUN_MINUTES).toBe('30');
  });
});
