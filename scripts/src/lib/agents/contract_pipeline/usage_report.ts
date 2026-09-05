// scripts/src/lib/agents/contract_pipeline/usage_report.ts
//
// C-473: usage report — human-readable CLI summary and machine-readable JSON
// output for pipeline usage and cost. Handles missing/estimated/unknown data
// honestly: never shows absent billing as zero.

import type { AggregatedUsage, CurrencyProvenance, MonetaryAmount, UsageRecord } from './types.ts';

// ── Formatting helpers ──

const PROVENANCE_LABELS = {
  provider_reported: 'provider-reported',
  estimated: 'estimated',
  incomplete: 'incomplete',
  unknown: 'unknown',
} as const satisfies Record<CurrencyProvenance, string>;

/** Presentation options for a human-readable usage report. */
export type UsageReportOptions = { title?: string; verbose?: boolean };

/** Format a number with locale-aware commas. */
const _fmt = (n: number): string => n.toLocaleString();

/** Format a monetary amount with provenance annotation. */
export const formatMonetaryAmount = (amount: MonetaryAmount): string => {
  const provenanceLabel = PROVENANCE_LABELS[amount.provenance] ?? amount.provenance;
  const parts: string[] = [
    `${amount.amount.toFixed(6)} ${amount.currency}`,
    `[${provenanceLabel}]`,
  ];

  if (amount.pricingVersion) {
    parts.push(`(pricing: ${amount.pricingVersion})`);
  }

  if (amount.conversion) {
    parts.push(`(converted @ ${amount.conversion.rate} from ${amount.conversion.source})`);
  }

  return parts.join(' ');
};

/** Format elapsed seconds as a human-readable duration. */
const _formatDuration = (seconds: number): string => {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
};

// ── Report generation ──

/**
 * Format an aggregated usage report as a human-readable string for CLI output.
 * Shows all monetary amounts with provenance. Unknown/incomplete amounts are
 * explicitly marked and never shown as a complete zero.
 */
export const formatUsageReport = (usage: AggregatedUsage, options?: UsageReportOptions): string => {
  const lines: string[] = [];
  const title = options?.title ?? 'Usage Report';

  lines.push('');
  lines.push(`═══ ${title} ═══`);
  lines.push('');

  // Token summary
  lines.push('📊 Tokens:');
  lines.push(`  Input:          ${_fmt(usage.totalInputTokens)}`);
  lines.push(`  Output:         ${_fmt(usage.totalOutputTokens)}`);
  lines.push(`  Cache Read:     ${_fmt(usage.totalCacheReadTokens)}`);
  lines.push(`  Cache Write:    ${_fmt(usage.totalCacheWriteTokens)}`);
  lines.push(`  Total (agg):    ${_fmt(usage.aggregatedTotalTokens)}`);

  // Timing
  lines.push('');
  lines.push('⏱  Time:');
  lines.push(`  Elapsed:        ${_formatDuration(usage.totalElapsedSeconds)}`);

  // Activity
  lines.push('');
  lines.push('🔄 Activity:');
  lines.push(`  Turns:          ${_fmt(usage.totalTurns)}`);
  lines.push(`  Tool Errors:    ${_fmt(usage.totalToolErrors)}`);
  lines.push(`  Retries:        ${_fmt(usage.totalRetries)}`);

  if (usage.models.length > 0) {
    lines.push(`  Models:         ${usage.models.join(', ')}`);
  }
  if (usage.providers.length > 0) {
    lines.push(`  Providers:      ${usage.providers.join(', ')}`);
  }

  // Monetary summary
  lines.push('');
  lines.push('💰 Costs:');
  const currencies = Object.keys(usage.monetary);
  if (currencies.length === 0) {
    lines.push('  (no cost data)');
  } else {
    for (const currency of currencies) {
      const amount = usage.monetary[currency];
      if (amount) {
        lines.push(`  ${formatMonetaryAmount(amount)}`);
      }
    }
  }

  // Converted total (when available)
  if (usage.convertedTotal) {
    lines.push(`  Total (converted): ${formatMonetaryAmount(usage.convertedTotal)}`);
  }

  // Completeness notes
  lines.push('');
  lines.push('📋 Completeness:');

  if (usage.unknownAttempts > 0) {
    lines.push(`  ⚠️  ${usage.unknownAttempts} attempt(s) have unknown/incomplete usage`);
  }

  if (usage.failedAttempts > 0) {
    lines.push(`  ❌ ${usage.failedAttempts} failed attempt(s) included in totals`);
  }

  if (!usage.externalCoverageComplete) {
    lines.push('  ⚠️  External review/vision/delegation usage not fully captured');
  }

  if (usage.convertedTotal) {
    lines.push('  ✅ Cross-currency conversion metadata recorded');
  } else if (currencies.length > 1) {
    lines.push('  ⚠️  Multiple currencies without conversion metadata — totals kept separate');
  }

  lines.push('');
  return lines.join('\n');
};

/**
 * Format a machine-readable JSON report of aggregated usage.
 * Never omits unknown/incomplete fields — they are explicit.
 */
export const formatUsageReportJson = (usage: AggregatedUsage): string => {
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    tokens: {
      input: usage.totalInputTokens,
      output: usage.totalOutputTokens,
      cacheRead: usage.totalCacheReadTokens,
      cacheWrite: usage.totalCacheWriteTokens,
      aggregatedTotal: usage.aggregatedTotalTokens,
    },
    time: {
      elapsedSeconds: usage.totalElapsedSeconds,
    },
    activity: {
      turns: usage.totalTurns,
      toolErrors: usage.totalToolErrors,
      retries: usage.totalRetries,
      models: usage.models,
      providers: usage.providers,
    },
    costs: usage.monetary,
    convertedTotal: usage.convertedTotal ?? null,
    completeness: {
      unknownAttempts: usage.unknownAttempts,
      failedAttempts: usage.failedAttempts,
      externalCoverageComplete: usage.externalCoverageComplete,
    },
  };

  return JSON.stringify(report, undefined, 2);
};

// ── Single-record formatting ──

/**
 * Format a single UsageRecord as a one-line summary (similar to the
 * existing usageSummary in worker.ts but with richer provenance).
 */
export const formatUsageRecord = (record: UsageRecord): string => {
  const parts: string[] = [];

  if (record.turns > 0) {
    parts.push(`${record.turns} turn${record.turns !== 1 ? 's' : ''}`);
  }
  if (record.model && record.model !== 'unknown') {
    parts.push(record.model);
  }
  if (record.inputTokens > 0 || record.outputTokens > 0) {
    parts.push(`${_fmt(record.inputTokens + record.outputTokens)} tokens`);
  }

  for (const amount of Object.values(record.monetary)) {
    parts.push(formatMonetaryAmount(amount));
  }

  if (!record.complete) {
    parts.push('(incomplete)');
  }
  if (!record.externalCoverageComplete) {
    parts.push('(coverage incomplete)');
  }

  // If we have any substantive data (turns, tokens, model, cost), show it.
  // Unknown/incomplete cost entries still constitute activity — they are
  // explicitly reported, not silently zero.
  const hasMonetaryData = Object.values(record.monetary).some(
    (m) => m.amount > 0 || m.provenance === 'unknown' || m.provenance === 'incomplete',
  );
  const hasActivity =
    record.turns > 0 ||
    record.inputTokens > 0 ||
    record.outputTokens > 0 ||
    (record.model !== 'unknown' && record.model !== '') ||
    hasMonetaryData;

  return hasActivity ? parts.join(', ') : 'no model activity';
};
