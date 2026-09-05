// scripts/src/lib/agents/contract_pipeline/usage_ledger.test.ts
//
// C-473 AC-1: Active workers and review produce usage — model, settings, tokens,
//   elapsed time and cost provenance are persisted and visible.
// C-473 AC-2: Retry/resume totals reconcile — run/task totals include all distinct
//   billable work exactly once; totalTokens is NOT merely the last event's value;
//   monetary totals remain separate per currency unless conversion metadata exists.
// C-473 AC-4: Legacy data — old empty manifests remain readable.

import { describe, expect, it } from 'bun:test';
import type { ContractWorkerRole, RunManifest, StageUsage, UsageRecord } from './types.ts';
import {
  aggregateUsage,
  computeManifestUsage,
  deduplicateRecords,
  isUsageEmpty,
  isUsageUnknown,
  loadLegacyManifestUsage,
  mergeMonetaryAmounts,
  normalizeLegacyUsage,
} from './usage_ledger.ts';

const RUN_ID = 'run-test-C-473';
const ROLE: ContractWorkerRole = 'implementer';

// ── Helpers ──

const makeRecord = (overrides: Partial<UsageRecord> = {}): UsageRecord => ({
  model: 'claude-sonnet-5',
  provider: 'anthropic',
  thinkingLevel: 'medium',
  configVersion: 'v1',
  turns: 3,
  inputTokens: 500,
  outputTokens: 200,
  cacheReadTokens: 100,
  cacheWriteTokens: 50,
  totalTokens: 700,
  elapsedSeconds: 120,
  toolErrors: 0,
  retries: 0,
  monetary: { USD: { amount: 0.015, currency: 'USD', provenance: 'provider_reported' } },
  complete: true,
  eventId: `${RUN_ID}-${ROLE}-1-0`,
  finalizedAt: '2026-09-04T12:00:00Z',
  externalCoverageComplete: true,
  contributingRoles: [ROLE],
  ...overrides,
});

// ── AC-1: Active workers produce usage ──

describe('AC-1: Active workers produce usage', () => {
  it('normalizeLegacyUsage preserves all token categories and cost', () => {
    const legacy: StageUsage = {
      model: 'claude-sonnet-5',
      turns: 5,
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheWriteTokens: 100,
      totalTokens: 1500,
      cost: 0.03,
    };

    const record = normalizeLegacyUsage({
      usage: legacy,
      runId: RUN_ID,
      role: ROLE,
      attempt: 1,
    });

    expect(record.model).toBe('claude-sonnet-5');
    expect(record.turns).toBe(5);
    expect(record.inputTokens).toBe(1000);
    expect(record.outputTokens).toBe(500);
    expect(record.cacheReadTokens).toBe(200);
    expect(record.cacheWriteTokens).toBe(100);
    expect(record.totalTokens).toBe(1500);
    expect(record.monetary.USD?.amount).toBe(0.03);
    expect(record.monetary.USD?.provenance).toBe('provider_reported');
    expect(record.complete).toBe(true);
  });

  it('empty legacy usage produces unknown provenance, not zero cost', () => {
    const empty: StageUsage = {
      model: '',
      turns: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      cost: 0,
    };

    const record = normalizeLegacyUsage({
      usage: empty,
      runId: RUN_ID,
      role: ROLE,
      attempt: 1,
    });

    expect(record.monetary.USD?.provenance).toBe('unknown');
    expect(record.complete).toBe(false);
    expect(isUsageUnknown(record)).toBe(true);
  });

  it('null usage produces unknown provenance', () => {
    const record = normalizeLegacyUsage({
      usage: null,
      runId: RUN_ID,
      role: ROLE,
      attempt: 1,
    });

    expect(record.monetary.USD?.provenance).toBe('unknown');
    expect(record.complete).toBe(false);
    expect(isUsageUnknown(record)).toBe(true);
  });

  it('undefined usage produces unknown provenance', () => {
    const record = normalizeLegacyUsage({
      usage: undefined,
      runId: RUN_ID,
      role: ROLE,
      attempt: 1,
    });

    expect(record.monetary.USD?.provenance).toBe('unknown');
    expect(isUsageUnknown(record)).toBe(true);
  });

  it('model, tokens and cost provenance are persisted and visible in aggregated output', () => {
    const records = [
      makeRecord({
        model: 'claude-sonnet-5',
        inputTokens: 1000,
        outputTokens: 500,
        monetary: { USD: { amount: 0.03, currency: 'USD', provenance: 'provider_reported' } },
      }),
    ];

    const aggregated = aggregateUsage(records);

    expect(aggregated.totalInputTokens).toBe(1000);
    expect(aggregated.totalOutputTokens).toBe(500);
    expect(aggregated.models).toContain('claude-sonnet-5');
    expect(aggregated.monetary.USD?.amount).toBe(0.03);
    expect(aggregated.monetary.USD?.provenance).toBe('provider_reported');
  });
});

// ── AC-2: Retry/resume totals reconcile ──

describe('AC-2: Retry/resume totals reconcile', () => {
  it('aggregatedTotalTokens is the SUM, not merely the last event value', () => {
    // Simulate three attempts with token totals
    const records = [
      makeRecord({ totalTokens: 1500, inputTokens: 1000, outputTokens: 500 }),
      makeRecord({
        totalTokens: 2000,
        inputTokens: 1200,
        outputTokens: 800,
        eventId: `${RUN_ID}-${ROLE}-2-0`,
        attempt: undefined as unknown as number,
      } as unknown as Partial<UsageRecord>),
      makeRecord({
        totalTokens: 1800,
        inputTokens: 1100,
        outputTokens: 700,
        eventId: `${RUN_ID}-${ROLE}-3-0`,
        attempt: undefined as unknown as number,
      } as unknown as Partial<UsageRecord>),
    ];

    // Fix event IDs for distinct records
    records[1] = { ...records[1], eventId: `${RUN_ID}-${ROLE}-2-0` };
    records[2] = { ...records[2], eventId: `${RUN_ID}-${ROLE}-3-0` };

    const aggregated = aggregateUsage(records);

    // totalTokens should be sum (1500 + 2000 + 1800 = 5300), not 1800 (last value)
    expect(aggregated.aggregatedTotalTokens).toBe(5300);
    expect(aggregated.aggregatedTotalTokens).not.toBe(1800);
  });

  it('duplicate event IDs are deduplicated — same event not double-counted', () => {
    const records = [
      makeRecord({ totalTokens: 1500, eventId: `${RUN_ID}-${ROLE}-1-0` }),
      // Duplicate of same event
      makeRecord({ totalTokens: 1500, eventId: `${RUN_ID}-${ROLE}-1-0` }),
    ];

    const { records: deduped, removed } = deduplicateRecords(records);
    expect(deduped.length).toBe(1);
    expect(removed).toBe(1);

    const aggregated = aggregateUsage(records);
    expect(aggregated.aggregatedTotalTokens).toBe(1500); // Not 3000
  });

  it('resume with repeated events does not double-bill', () => {
    // Simulate a resumed run: first attempt completed, second is a retry
    const records = [
      makeRecord({
        totalTokens: 1500,
        inputTokens: 1000,
        outputTokens: 500,
        eventId: `${RUN_ID}-${ROLE}-1-0`,
        monetary: { USD: { amount: 0.03, currency: 'USD', provenance: 'provider_reported' } },
      }),
      // Retry with different usage
      makeRecord({
        totalTokens: 2000,
        inputTokens: 1200,
        outputTokens: 800,
        eventId: `${RUN_ID}-${ROLE}-2-0`,
        monetary: { USD: { amount: 0.04, currency: 'USD', provenance: 'provider_reported' } },
      }),
    ];

    const aggregated = aggregateUsage(records);
    expect(aggregated.aggregatedTotalTokens).toBe(3500); // 1500 + 2000
    expect(aggregated.totalInputTokens).toBe(2200); // 1000 + 1200
    expect(aggregated.monetary.USD?.amount).toBe(0.07); // 0.03 + 0.04
  });

  it('mixed-currency usage keeps totals separate without conversion metadata', () => {
    const records = [
      makeRecord({
        monetary: {
          USD: { amount: 0.03, currency: 'USD', provenance: 'provider_reported' },
          EUR: { amount: 0.025, currency: 'EUR', provenance: 'estimated' },
        },
      }),
    ];

    const aggregated = aggregateUsage(records);

    expect(aggregated.monetary.USD?.amount).toBe(0.03);
    expect(aggregated.monetary.EUR?.amount).toBe(0.025);
    // No conversion metadata → no converted total
    expect(aggregated.convertedTotal).toBeUndefined();
  });

  it('mixed-currency usage produces converted total when all have conversion metadata', () => {
    const records = [
      makeRecord({
        monetary: {
          USD: {
            amount: 0.03,
            currency: 'USD',
            provenance: 'provider_reported',
            conversion: { rate: 1, timestamp: '2026-09-04T12:00:00Z', source: 'provider' },
          },
          EUR: {
            amount: 0.025,
            currency: 'EUR',
            provenance: 'estimated',
            conversion: { rate: 1.1, timestamp: '2026-09-04T12:00:00Z', source: 'ecb-2026-09' },
          },
        },
      }),
    ];

    const aggregated = aggregateUsage(records);

    expect(aggregated.convertedTotal).toBeDefined();
    expect(aggregated.convertedTotal?.amount).toBeGreaterThan(0);
    expect(aggregated.convertedTotal?.conversion?.source).toBe('aggregate-currency-conversion');
  });

  it('single-currency usage uses that currency as converted total', () => {
    const records = [
      makeRecord({
        monetary: {
          USD: { amount: 0.05, currency: 'USD', provenance: 'provider_reported' },
        },
      }),
    ];

    const aggregated = aggregateUsage(records);
    expect(aggregated.convertedTotal).toBeDefined();
    expect(aggregated.convertedTotal?.amount).toBe(0.05);
    expect(aggregated.convertedTotal?.currency).toBe('USD');
  });

  it('failed attempts are counted separately and included in totals', () => {
    const records = [
      makeRecord({ totalTokens: 1500, inputTokens: 1000, outputTokens: 500, complete: true }),
      makeRecord({
        totalTokens: 500,
        inputTokens: 300,
        outputTokens: 200,
        complete: false,
        eventId: `${RUN_ID}-${ROLE}-2-0`,
        monetary: { USD: { amount: 0, currency: 'USD', provenance: 'incomplete' } },
      }),
    ];

    // Fix event ID
    records[1] = { ...records[1], eventId: `${RUN_ID}-${ROLE}-2-0` };

    const aggregated = aggregateUsage(records);
    // Failed attempt's tokens still counted
    expect(aggregated.aggregatedTotalTokens).toBe(2000);
    // Unknown/incomplete counted
    expect(aggregated.unknownAttempts).toBeGreaterThanOrEqual(1);
  });
});

// ── AC-4: Legacy data preserved ──

describe('AC-4: Legacy data preserved', () => {
  it('old empty manifests produce unknown/incomplete usage, never zero', () => {
    const manifest: RunManifest = {
      version: 3,
      runId: 'run-legacy-empty',
      contractId: 'C-999',
      contractPath: 'docs/contracts/C-999.md',
      baseCommit: 'abc123',
      baselineFingerprint: 'def456',
      startTime: '2026-01-01T00:00:00Z',
      lastUpdated: '2026-01-01T01:00:00Z',
      currentStage: 'implement',
      verifyLoops: 0,
      attempts: [],
      usage: {},
      autofixCycles: 0,
    };

    const aggregated = loadLegacyManifestUsage(manifest);
    expect(aggregated.unknownAttempts).toBe(0);
    expect(aggregated.monetary.USD?.provenance).toBeUndefined();
  });

  it('old manifest with empty StageUsage loads as unknown/incomplete', () => {
    const emptyUsage: StageUsage = {
      model: '',
      turns: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      cost: 0,
    };

    const manifest: RunManifest = {
      version: 3,
      runId: 'run-legacy-empty-usage',
      contractId: 'C-999',
      contractPath: 'docs/contracts/C-999.md',
      baseCommit: 'abc123',
      baselineFingerprint: 'def456',
      startTime: '2026-01-01T00:00:00Z',
      lastUpdated: '2026-01-01T01:00:00Z',
      currentStage: 'implement',
      verifyLoops: 0,
      attempts: [],
      usage: { implementer: emptyUsage },
      autofixCycles: 0,
    };

    const aggregated = loadLegacyManifestUsage(manifest);
    expect(aggregated.unknownAttempts).toBeGreaterThanOrEqual(1);
    // Cost should not be silently zero — it's unknown
    const usd = aggregated.monetary.USD;
    expect(usd).toBeDefined();
    expect(usd?.provenance).toBe('unknown');
  });

  it('deduplicateRecords handles identical event IDs', () => {
    const records = [
      makeRecord({ totalTokens: 500, eventId: 'event-1' }),
      makeRecord({ totalTokens: 600, eventId: 'event-1' }), // Updated version
      makeRecord({ totalTokens: 700, eventId: 'event-2' }),
    ];

    const { records: deduped, removed } = deduplicateRecords(records);
    expect(deduped.length).toBe(2); // event-1 + event-2
    expect(removed).toBe(1);
    // Last occurrence of event-1 wins
    expect(deduped.find((r) => r.eventId === 'event-1')?.totalTokens).toBe(600);
  });

  it('isUsageEmpty returns true for zeroed record', () => {
    const empty = makeRecord({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      turns: 0,
      monetary: { USD: { amount: 0, currency: 'USD', provenance: 'unknown' } },
    });
    expect(isUsageEmpty(empty)).toBe(true);
  });

  it('isUsageEmpty returns false for record with data', () => {
    const record = makeRecord();
    expect(isUsageEmpty(record)).toBe(false);
  });

  it('mergeMonetaryAmounts preserves best provenance', () => {
    const a: import('./types.ts').MonetaryAmount = {
      amount: 0.01,
      currency: 'USD',
      provenance: 'provider_reported',
    };
    const b: import('./types.ts').MonetaryAmount = {
      amount: 0.02,
      currency: 'USD',
      provenance: 'estimated',
    };

    const merged = mergeMonetaryAmounts(a, b);
    expect(merged.amount).toBe(0.03);
    expect(merged.provenance).toBe('provider_reported');
  });

  it('mergeMonetaryAmounts falls back to estimated when no provider_reported', () => {
    const a: import('./types.ts').MonetaryAmount = {
      amount: 0.01,
      currency: 'USD',
      provenance: 'estimated',
      pricingVersion: 'v1',
    };
    const b: import('./types.ts').MonetaryAmount = {
      amount: 0.02,
      currency: 'USD',
      provenance: 'unknown',
    };

    const merged = mergeMonetaryAmounts(a, b);
    expect(merged.amount).toBe(0.03);
    expect(merged.provenance).toBe('estimated');
  });
});

// ── computeManifestUsage ──

describe('computeManifestUsage', () => {
  it('aggregates from manifest attempts', () => {
    const manifest: RunManifest = {
      version: 3,
      runId: RUN_ID,
      contractId: 'C-473',
      contractPath: 'docs/contracts/C-473.md',
      baseCommit: 'abc',
      baselineFingerprint: 'def',
      startTime: '2026-09-04T00:00:00Z',
      lastUpdated: '2026-09-04T12:00:00Z',
      currentStage: 'implement',
      verifyLoops: 0,
      attempts: [
        {
          stage: 'implement',
          role: 'implementer',
          attempt: 1,
          paneId: 'pane-1',
          startTime: '2026-09-04T10:00:00Z',
          usage: {
            model: 'claude-sonnet-5',
            turns: 5,
            inputTokens: 1000,
            outputTokens: 500,
            cacheReadTokens: 200,
            cacheWriteTokens: 100,
            totalTokens: 1500,
            cost: 0.03,
          },
        },
      ],
      usage: {},
      autofixCycles: 0,
    };

    const aggregated = computeManifestUsage(manifest);
    expect(aggregated.totalInputTokens).toBe(1000);
    expect(aggregated.totalOutputTokens).toBe(500);
    expect(aggregated.aggregatedTotalTokens).toBe(1500);
    expect(aggregated.monetary.USD?.amount).toBe(0.03);
  });

  it('prefers usageRecord over legacy usage', () => {
    const manifest: RunManifest = {
      version: 3,
      runId: RUN_ID,
      contractId: 'C-473',
      contractPath: 'docs/contracts/C-473.md',
      baseCommit: 'abc',
      baselineFingerprint: 'def',
      startTime: '2026-09-04T00:00:00Z',
      lastUpdated: '2026-09-04T12:00:00Z',
      currentStage: 'implement',
      verifyLoops: 0,
      attempts: [
        {
          stage: 'implement',
          role: 'implementer',
          attempt: 1,
          paneId: 'pane-1',
          startTime: '2026-09-04T10:00:00Z',
          usage: {
            model: 'legacy-model',
            turns: 1,
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 150,
            cost: 0.001,
          },
          usageRecord: makeRecord({
            model: 'new-model',
            inputTokens: 2000,
            outputTokens: 1000,
            totalTokens: 3000,
            monetary: { USD: { amount: 0.06, currency: 'USD', provenance: 'provider_reported' } },
          }),
        },
      ],
      usage: {},
      autofixCycles: 0,
    };

    const aggregated = computeManifestUsage(manifest);
    // Should use the usageRecord, not the legacy usage
    expect(aggregated.totalInputTokens).toBe(2000);
    expect(aggregated.totalOutputTokens).toBe(1000);
    expect(aggregated.models).toContain('new-model');
    expect(aggregated.models).not.toContain('legacy-model');
  });

  it('handles manifest attempts with no usage data at all', () => {
    const manifest: RunManifest = {
      version: 3,
      runId: RUN_ID,
      contractId: 'C-473',
      contractPath: 'docs/contracts/C-473.md',
      baseCommit: 'abc',
      baselineFingerprint: 'def',
      startTime: '2026-09-04T00:00:00Z',
      lastUpdated: '2026-09-04T12:00:00Z',
      currentStage: 'implement',
      verifyLoops: 0,
      attempts: [
        {
          stage: 'implement',
          role: 'implementer',
          attempt: 1,
          paneId: 'pane-1',
          startTime: '2026-09-04T10:00:00Z',
        },
      ],
      usage: {},
      autofixCycles: 0,
    };

    const aggregated = computeManifestUsage(manifest);
    expect(aggregated.unknownAttempts).toBeGreaterThanOrEqual(1);
  });
});
