// scripts/src/lib/agents/contract_pipeline/usage_report.test.ts
//
// C-473 AC-3: Missing and external costs are honest — unknown/incomplete portions
//   are explicit and never shown as a complete zero; estimates carry pricing version.
// C-473 AC-4: Privacy — secrets/prompt bodies do not enter the usage ledger.

import { describe, expect, it } from 'bun:test';
import type { AggregatedUsage, UsageRecord } from './types.ts';
import {
  formatMonetaryAmount,
  formatUsageRecord,
  formatUsageReport,
  formatUsageReportJson,
} from './usage_report.ts';

// ── Fixtures ──

const sampleAggregated: AggregatedUsage = {
  totalTurns: 15,
  totalInputTokens: 5000,
  totalOutputTokens: 2500,
  totalCacheReadTokens: 500,
  totalCacheWriteTokens: 200,
  aggregatedTotalTokens: 7500,
  totalElapsedSeconds: 360,
  totalToolErrors: 2,
  totalRetries: 1,
  monetary: {
    USD: { amount: 0.15, currency: 'USD', provenance: 'provider_reported' },
    EUR: {
      amount: 0.05,
      currency: 'EUR',
      provenance: 'estimated',
      pricingVersion: 'claude-sonnet-5-2026-09',
    },
  },
  unknownAttempts: 0,
  failedAttempts: 0,
  models: ['claude-sonnet-5'],
  providers: ['anthropic'],
  externalCoverageComplete: true,
};

const aggregatedWithUnknown: AggregatedUsage = {
  ...sampleAggregated,
  monetary: {
    USD: { amount: 0, currency: 'USD', provenance: 'unknown' },
  },
  unknownAttempts: 2,
  models: [],
  providers: [],
};

const aggregatedWithIncomplete: AggregatedUsage = {
  ...sampleAggregated,
  monetary: {
    USD: { amount: 0.05, currency: 'USD', provenance: 'incomplete' },
  },
  externalCoverageComplete: false,
};

// ── AC-3: Missing and external costs are honest ──

describe('AC-3: Missing and external costs are honest', () => {
  it('formatUsageReport shows unknown provenance explicitly', () => {
    const report = formatUsageReport(aggregatedWithUnknown);

    // Should mention unknown
    expect(report).toContain('unknown');
    // Should NOT show a zero as if cost was zero
    expect(report).not.toContain('$0.00');
    // Should note unknown attempts
    expect(report).toContain('2 attempt(s) have unknown/incomplete usage');
  });

  it('formatUsageReport shows incomplete coverage explicitly', () => {
    const report = formatUsageReport(aggregatedWithIncomplete);

    expect(report).toContain('incomplete');
    expect(report).toContain('External review/vision/delegation usage not fully captured');
  });

  it('formatUsageReport shows estimated cost with pricing version', () => {
    const report = formatUsageReport(sampleAggregated);

    expect(report).toContain('estimated');
    expect(report).toContain('claude-sonnet-5-2026-09');
    expect(report).toContain('provider-reported');
  });

  it('formatUsageReport shows multiple currencies without conversion', () => {
    const report = formatUsageReport(sampleAggregated);

    expect(report).toContain('USD');
    expect(report).toContain('EUR');
    expect(report).toContain('Multiple currencies without conversion metadata');
  });

  it('formatUsageReport shows converted total when available', () => {
    const aggregatedWithConversion: AggregatedUsage = {
      ...sampleAggregated,
      monetary: {
        USD: { amount: 0.15, currency: 'USD', provenance: 'provider_reported' },
      },
      convertedTotal: {
        amount: 0.15,
        currency: 'USD',
        provenance: 'provider_reported',
      },
    };

    const report = formatUsageReport(aggregatedWithConversion);
    expect(report).toContain('Total (converted)');
    expect(report).toContain('0.15');
  });

  it('formatUsageReport includes failed attempts in totals', () => {
    const aggregatedWithFailures: AggregatedUsage = {
      ...sampleAggregated,
      failedAttempts: 3,
    };

    const report = formatUsageReport(aggregatedWithFailures);
    expect(report).toContain('3 failed attempt(s)');
  });

  it('formatUsageReportJson includes completeness information', () => {
    const json = formatUsageReportJson(aggregatedWithUnknown);
    const parsed = JSON.parse(json);

    expect(parsed.completeness.unknownAttempts).toBe(2);
    expect(parsed.costs.USD.provenance).toBe('unknown');
    expect(parsed.completeness.externalCoverageComplete).toBe(true);
  });

  it('formatUsageReportJson includes converted total or null', () => {
    const json = formatUsageReportJson(sampleAggregated);
    const parsed = JSON.parse(json);

    expect(parsed.convertedTotal).toBeNull();
  });

  it('formatUsageReportJson has correct structure', () => {
    const json = formatUsageReportJson(sampleAggregated);
    const parsed = JSON.parse(json);

    expect(parsed.version).toBe(1);
    expect(parsed.tokens.input).toBe(5000);
    expect(parsed.tokens.output).toBe(2500);
    expect(parsed.tokens.aggregatedTotal).toBe(7500);
    expect(parsed.activity.turns).toBe(15);
    expect(parsed.activity.models).toContain('claude-sonnet-5');
    expect(parsed.costs.USD.amount).toBe(0.15);
  });
});

// ── Formatting helpers ──

describe('formatMonetaryAmount', () => {
  it('formats provider-reported amount', () => {
    const result = formatMonetaryAmount({
      amount: 0.015,
      currency: 'USD',
      provenance: 'provider_reported',
    });
    expect(result).toContain('0.015');
    expect(result).toContain('USD');
    expect(result).toContain('provider-reported');
  });

  it('formats estimated amount with pricing version', () => {
    const result = formatMonetaryAmount({
      amount: 0.02,
      currency: 'EUR',
      provenance: 'estimated',
      pricingVersion: 'claude-sonnet-5-2026-09',
    });
    expect(result).toContain('estimated');
    expect(result).toContain('pricing: claude-sonnet-5-2026-09');
  });

  it('formats amount with conversion metadata', () => {
    const result = formatMonetaryAmount({
      amount: 0.03,
      currency: 'USD',
      provenance: 'estimated',
      conversion: {
        rate: 1.1,
        timestamp: '2026-09-04T12:00:00Z',
        source: 'ecb-rate-2026-09-04',
      },
    });
    expect(result).toContain('converted');
    expect(result).toContain('1.1');
    expect(result).toContain('ecb-rate-2026-09-04');
  });
});

describe('formatUsageRecord', () => {
  it('formats a complete record', () => {
    const record: UsageRecord = {
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
      eventId: 'evt-1',
      finalizedAt: '2026-09-04T12:00:00Z',
      externalCoverageComplete: true,
    };

    const result = formatUsageRecord(record);
    expect(result).toContain('3 turns');
    expect(result).toContain('claude-sonnet-5');
    expect(result).toContain('700 tokens');
    expect(result).toContain('0.015');
  });

  it('formats unknown cost record', () => {
    const record: UsageRecord = {
      model: 'unknown',
      provider: 'unknown',
      thinkingLevel: 'unknown',
      configVersion: 'unknown',
      turns: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      elapsedSeconds: 0,
      toolErrors: 0,
      retries: 0,
      monetary: { USD: { amount: 0, currency: 'USD', provenance: 'unknown' } },
      complete: false,
      eventId: 'evt-unknown',
      finalizedAt: '2026-09-04T12:00:00Z',
      externalCoverageComplete: false,
    };

    const result = formatUsageRecord(record);
    expect(result).toContain('cost: unknown');
    expect(result).toContain('incomplete');
    expect(result).toContain('coverage incomplete');
  });

  it('returns no model activity for empty record', () => {
    const record: UsageRecord = {
      model: 'unknown',
      provider: 'unknown',
      thinkingLevel: 'unknown',
      configVersion: 'unknown',
      turns: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      elapsedSeconds: 0,
      toolErrors: 0,
      retries: 0,
      monetary: {},
      complete: false,
      eventId: 'evt-empty',
      finalizedAt: '2026-09-04T12:00:00Z',
      externalCoverageComplete: false,
    };

    const result = formatUsageRecord(record);
    expect(result).toBe('no model activity');
  });
});

// ── AC-4: Privacy preserved ──

describe('AC-4: Privacy preserved', () => {
  it('UsageRecord never stores prompt bodies or secrets', () => {
    const record: UsageRecord = {
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
      eventId: 'evt-1',
      finalizedAt: '2026-09-04T12:00:00Z',
      externalCoverageComplete: true,
    };

    // Verify the record shape has no field for prompts, secrets, or API keys.
    // Token-related fields (inputTokens, outputTokens, etc.) are legitimate
    // usage metrics — not sensitive credentials.
    const keys = Object.keys(record) as (keyof UsageRecord)[];
    const sensitivePatterns = ['prompt', 'secret', 'apikey', 'password', 'credential'];
    const allowedTokenFields = [
      'inputtokens',
      'outputtokens',
      'totaltokens',
      'cachereadtokens',
      'cachewritetokens',
    ];
    for (const key of keys) {
      const keyLower = key.toLowerCase();
      if (allowedTokenFields.includes(keyLower)) {
        continue;
      }
      for (const pattern of sensitivePatterns) {
        expect(keyLower).not.toContain(pattern);
      }
    }
  });

  it('formatUsageReport does not expose internal details', () => {
    const report = formatUsageReport(sampleAggregated);
    // Should not contain sensitive patterns
    expect(report).not.toContain('apiKey');
    expect(report).not.toContain('secret');
    expect(report).not.toContain('password');
  });

  it('formatUsageReportJson does not expose internal details', () => {
    const json = formatUsageReportJson(sampleAggregated);
    expect(json).not.toContain('apiKey');
    expect(json).not.toContain('secret');
    expect(json).not.toContain('password');
  });
});
