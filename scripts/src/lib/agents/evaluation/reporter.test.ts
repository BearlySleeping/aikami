// scripts/src/lib/agents/evaluation/reporter.test.ts
//
// C-480 AC-3: metrics include the whole cost of acceptance — exact expected
// totals, a zero-acceptance group is never represented as a cheap success,
// missing billing is explicit, and every average sits beside its sample
// size and outcome counts.

import { describe, expect, it } from 'bun:test';
import { buildReport, MIN_REPETITIONS_FOR_CONFIDENCE } from './reporter.ts';
import type { AttemptResult, RunAuthorization, UsageRecord } from './types.ts';

const AUTH = {
  mode: 'plan',
  authorizedAt: new Date().toISOString(),
} as const satisfies RunAuthorization;

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
  elapsedSeconds: 10,
  toolErrors: 0,
  retries: 0,
  monetary: { USD: { amount: 1, currency: 'USD', provenance: 'provider_reported' } },
  complete: true,
  eventId: `evt-${Math.random()}`,
  finalizedAt: new Date().toISOString(),
  externalCoverageComplete: true,
  ...overrides,
});

const attempt = (overrides: Partial<AttemptResult> = {}): AttemptResult => ({
  taskId: 't1',
  configId: 'flash-high',
  repetition: 1,
  outcome: 'accepted',
  firstPass: true,
  retries: 0,
  toolFailures: 0,
  usage: usage(),
  hashes: { taskHash: 'h', baseHash: 'h', acceptanceHash: 'h', configHash: 'h' },
  diagnostics: '',
  ...overrides,
});

describe('AC-3: whole cost of acceptance', () => {
  it('computes exact totals for a group with mixed outcomes', () => {
    const attempts = [
      attempt({
        repetition: 1,
        outcome: 'accepted',
        usage: usage({
          monetary: { USD: { amount: 1, currency: 'USD', provenance: 'provider_reported' } },
        }),
      }),
      attempt({
        repetition: 2,
        outcome: 'rejected',
        usage: usage({
          monetary: { USD: { amount: 0.5, currency: 'USD', provenance: 'provider_reported' } },
        }),
      }),
      attempt({
        repetition: 3,
        outcome: 'accepted',
        usage: usage({
          monetary: { USD: { amount: 1.5, currency: 'USD', provenance: 'provider_reported' } },
        }),
      }),
    ];
    const report = buildReport({ runId: 'r1', authorization: AUTH, attempts });
    const summary = report.summaries[0];
    if (!summary) {
      throw new Error('expected one summary group');
    }
    expect(summary.sampleSize).toBe(3);
    expect(summary.acceptedCount).toBe(2);
    // Failed attempts contribute cost: (1 + 0.5 + 1.5) / 2 accepted = 1.5
    expect(summary.costPerAcceptedTaskUsd).toBeCloseTo(1.5, 6);
    expect(summary.acceptanceRate).toBeCloseTo(2 / 3, 6);
  });

  it('a zero-acceptance group reports costPerAcceptedTaskUsd as null, never as a cheap success', () => {
    const attempts = [
      attempt({
        outcome: 'rejected',
        usage: usage({
          monetary: { USD: { amount: 2, currency: 'USD', provenance: 'provider_reported' } },
        }),
      }),
    ];
    const report = buildReport({ runId: 'r2', authorization: AUTH, attempts });
    expect(report.summaries[0]?.costPerAcceptedTaskUsd).toBeNull();
    expect(report.summaries[0]?.acceptedCount).toBe(0);
  });

  it('missing billing is counted explicitly and excluded from the USD total', () => {
    const attempts = [
      attempt({
        outcome: 'accepted',
        usage: usage({ monetary: { USD: { amount: 0, currency: 'USD', provenance: 'unknown' } } }),
      }),
      attempt({
        repetition: 2,
        outcome: 'accepted',
        usage: usage({
          monetary: { USD: { amount: 1, currency: 'USD', provenance: 'provider_reported' } },
        }),
      }),
    ];
    const report = buildReport({ runId: 'r3', authorization: AUTH, attempts });
    const summary = report.summaries[0];
    expect(summary?.unknownBillingCount).toBe(1);
    // Only the known $1 counts toward the 2 accepted attempts' shared cost.
    expect(summary?.costPerAcceptedTaskUsd).toBeCloseTo(0.5, 6);
  });

  it('counts an attempt when any monetary currency has incomplete provenance', () => {
    const report = buildReport({
      runId: 'r3-mixed-currency',
      authorization: AUTH,
      attempts: [
        attempt({
          usage: usage({
            monetary: {
              USD: { amount: 1, currency: 'USD', provenance: 'provider_reported' },
              EUR: { amount: 0, currency: 'EUR', provenance: 'incomplete' },
            },
          }),
        }),
      ],
    });
    expect(report.summaries[0]?.unknownBillingCount).toBe(1);
  });

  it('marks a group inconclusive below the minimum repetition count and conclusive at/above it', () => {
    const few = buildReport({
      runId: 'r4',
      authorization: AUTH,
      attempts: [attempt()],
    });
    expect(few.summaries[0]?.inconclusive).toBe(true);

    const enough = buildReport({
      runId: 'r5',
      authorization: AUTH,
      attempts: Array.from({ length: MIN_REPETITIONS_FOR_CONFIDENCE }, (_, i) =>
        attempt({ repetition: i + 1 }),
      ),
    });
    expect(enough.summaries[0]?.inconclusive).toBe(false);
    expect(enough.summaries[0]?.sampleSize).toBe(MIN_REPETITIONS_FOR_CONFIDENCE);
  });

  it('separates groups by both task and config', () => {
    const attempts = [
      attempt({ taskId: 't1', configId: 'flash-high' }),
      attempt({ taskId: 't1', configId: 'sonnet-high' }),
      attempt({ taskId: 't2', configId: 'flash-high' }),
    ];
    const report = buildReport({ runId: 'r6', authorization: AUTH, attempts });
    expect(report.summaries).toHaveLength(3);
  });

  it('aggregatedUsage reflects the whole run, not just accepted attempts', () => {
    const attempts = [
      attempt({ outcome: 'accepted', usage: usage({ turns: 2 }) }),
      attempt({ repetition: 2, outcome: 'rejected', usage: usage({ turns: 3 }) }),
    ];
    const report = buildReport({ runId: 'r7', authorization: AUTH, attempts });
    expect(report.aggregatedUsage.totalTurns).toBe(5);
  });
});
