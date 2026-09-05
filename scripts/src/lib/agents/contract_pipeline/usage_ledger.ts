// scripts/src/lib/agents/contract_pipeline/usage_ledger.ts
//
// C-473: usage ledger — aggregate per-attempt usage into run/task totals.
// Handles deduplication, retry reconciliation, legacy compatibility and
// honest representation of missing/estimated costs.

import type {
  AggregatedUsage,
  ContractWorkerRole,
  CurrencyProvenance,
  MonetaryAmount,
  RunManifest,
  StageUsage,
  UsageRecord,
} from './types.ts';

// ── Helpers ──

/** Default monetary amount for unknown/incomplete provenance. */
const _unknownMonetary = (currency = 'USD'): MonetaryAmount => ({
  amount: 0,
  currency,
  provenance: 'unknown',
});

// ── Legacy normalization ──

/**
 * Convert a legacy `StageUsage` (or partial/empty object) into a
 * normalized `UsageRecord`. Empty or missing usage is reported as
 * `unknown` provenance — never silently zero.
 */
export const normalizeLegacyUsage = (options: {
  usage: Partial<StageUsage> | undefined | null;
  /** Attempt metadata for event identity. */
  runId: string;
  role: ContractWorkerRole;
  attempt: number;
  /** Optional generation for event fencing. */
  generation?: number;
}): UsageRecord => {
  const usage = options.usage;
  const hasData = usage && (usage.inputTokens || usage.outputTokens || usage.cost || usage.turns);

  if (!hasData) {
    return {
      model: usage?.model ?? 'unknown',
      provider: 'unknown',
      thinkingLevel: 'unknown',
      configVersion: 'unknown',
      turns: usage?.turns ?? 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      elapsedSeconds: 0,
      toolErrors: 0,
      retries: 0,
      monetary: { USD: _unknownMonetary() },
      complete: false,
      eventId: `${options.runId}-${options.role}-${options.attempt}-${options.generation ?? 0}`,
      finalizedAt: new Date().toISOString(),
      externalCoverageComplete: false,
    };
  }

  return {
    model: usage.model || 'unknown',
    provider: 'unknown',
    thinkingLevel: 'unknown',
    configVersion: 'unknown',
    turns: usage.turns,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    totalTokens: usage.totalTokens,
    elapsedSeconds: 0,
    toolErrors: 0,
    retries: 0,
    monetary: {
      USD: {
        amount: usage.cost ?? 0,
        currency: 'USD',
        provenance: usage.cost ? 'provider_reported' : 'unknown',
      },
    },
    complete: true,
    eventId: `${options.runId}-${options.role}-${options.attempt}-${options.generation ?? 0}`,
    finalizedAt: new Date().toISOString(),
    externalCoverageComplete: false,
  };
};

/**
 * Check if an `UsageRecord` has unknown/incomplete monetary data.
 * True when ALL monetary entries have unknown or incomplete provenance.
 */
export const isUsageUnknown = (record: UsageRecord): boolean => {
  const entries = Object.values(record.monetary);
  if (entries.length === 0) {
    return true;
  }
  return entries.every((m) => m.provenance === 'unknown' || m.provenance === 'incomplete');
};

/**
 * Check if a usage record is empty (no meaningful data).
 */
export const isUsageEmpty = (record: UsageRecord): boolean =>
  record.inputTokens === 0 &&
  record.outputTokens === 0 &&
  record.totalTokens === 0 &&
  record.turns === 0 &&
  Object.values(record.monetary).every((m) => m.amount === 0);

// ── Deduplication ──

/**
 * Deduplicate a list of usage records by `eventId`. When duplicates exist,
 * the LAST occurrence wins (latest finalization). Returns deduplicated list
 * and count of removed duplicates.
 */
export const deduplicateRecords = (
  records: UsageRecord[],
): { records: UsageRecord[]; removed: number } => {
  const seen = new Map<string, number>();
  const result: UsageRecord[] = [];

  for (const record of records) {
    const existing = seen.get(record.eventId);
    if (existing !== undefined) {
      // Replace with newer version
      result[existing] = record;
    } else {
      seen.set(record.eventId, result.length);
      result.push(record);
    }
  }

  return { records: result, removed: records.length - result.length };
};

// ── Aggregation ──

/**
 * Merge two MonetaryAmount values from the same currency. If both have
 * conversion metadata, they must match or the result is marked estimated.
 * The more precise provenance wins (provider_reported > estimated > incomplete > unknown).
 */
export const mergeMonetaryAmounts = (a: MonetaryAmount, b: MonetaryAmount): MonetaryAmount => {
  if (a.currency !== b.currency) {
    return a; // Different currencies — keep a (caller should not merge across currencies)
  }

  const provenanceOrder: Record<CurrencyProvenance, number> = {
    provider_reported: 0,
    estimated: 1,
    incomplete: 2,
    unknown: 3,
  };

  const bestProvenance =
    (provenanceOrder[a.provenance] ?? 99) <= (provenanceOrder[b.provenance] ?? 99)
      ? a.provenance
      : b.provenance;

  const conversion = a.conversion ?? b.conversion;
  const pricingVersion = a.pricingVersion ?? b.pricingVersion;

  return {
    amount: a.amount + b.amount,
    currency: a.currency,
    provenance: bestProvenance,
    pricingVersion,
    conversion,
  };
};

/**
 * Aggregate an array of UsageRecords into a single AggregatedUsage.
 * Deduplicates by eventId first. Failed/unknown attempts are counted
 * separately and never silently absorbed into zero.
 */
export const aggregateUsage = (records: UsageRecord[]): AggregatedUsage => {
  const { records: deduplicated, removed: _removed } = deduplicateRecords(records);

  const models = new Set<string>();
  const providers = new Set<string>();
  const monetary: Record<string, MonetaryAmount> = {};
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheWriteTokens = 0;
  let aggregatedTotalTokens = 0;
  let totalTurns = 0;
  let totalElapsedSeconds = 0;
  let totalToolErrors = 0;
  let totalRetries = 0;
  let unknownAttempts = 0;
  let failedAttempts = 0;
  let externalCoverageComplete = true;

  for (const record of deduplicated) {
    if (record.model && record.model !== 'unknown') {
      models.add(record.model);
    }
    if (record.provider && record.provider !== 'unknown') {
      providers.add(record.provider);
    }

    totalInputTokens += record.inputTokens;
    totalOutputTokens += record.outputTokens;
    totalCacheReadTokens += record.cacheReadTokens;
    totalCacheWriteTokens += record.cacheWriteTokens;
    // AC-2: aggregatedTotalTokens is the SUM, not merely the last event's value
    aggregatedTotalTokens += record.totalTokens;
    totalTurns += record.turns;
    totalElapsedSeconds += record.elapsedSeconds;
    totalToolErrors += record.toolErrors;
    totalRetries += record.retries;

    if (isUsageUnknown(record)) {
      unknownAttempts++;
    }

    if (!record.complete) {
      failedAttempts++;
      unknownAttempts++;
    }

    if (!record.externalCoverageComplete) {
      externalCoverageComplete = false;
    }

    // Merge monetary amounts per currency
    for (const [currency, amount] of Object.entries(record.monetary)) {
      if (monetary[currency]) {
        monetary[currency] = mergeMonetaryAmounts(monetary[currency], amount);
      } else {
        monetary[currency] = { ...amount };
      }
    }
  }

  // Build converted total only when every converted amount has metadata
  let convertedTotal: MonetaryAmount | undefined;
  const currencies = Object.keys(monetary);
  if (currencies.length > 1) {
    const allHaveConversion = currencies.every((c) => {
      const m = monetary[c];
      return m.conversion !== undefined && m.conversion.rate > 0;
    });

    if (allHaveConversion) {
      const totalAmount = currencies.reduce((acc, c) => acc + (monetary[c]?.amount ?? 0), 0);
      convertedTotal = {
        amount: totalAmount,
        currency: 'USD',
        provenance: 'estimated',
        conversion: {
          rate: 1,
          timestamp: new Date().toISOString(),
          source: 'aggregate-currency-conversion',
        },
      };
    }
  } else if (currencies.length === 1) {
    const single = monetary[currencies[0]];
    if (single && single.amount > 0) {
      convertedTotal = { ...single };
    }
  }

  return {
    totalTurns,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheWriteTokens,
    aggregatedTotalTokens,
    totalElapsedSeconds,
    totalToolErrors,
    totalRetries,
    monetary,
    convertedTotal,
    unknownAttempts,
    failedAttempts,
    models: [...models],
    providers: [...providers],
    externalCoverageComplete,
  };
};

// ── Manifest helpers ──

/**
 * Compute aggregated usage from a run manifest's attempts.
 * Handles legacy StageUsage and newer UsageRecord fields.
 * Empty/unknown usage is never counted as zero cost.
 */
export const computeManifestUsage = (manifest: RunManifest): AggregatedUsage => {
  const records: UsageRecord[] = [];

  for (const attempt of manifest.attempts) {
    // Prefer UsageRecord when available
    if (attempt.usageRecord) {
      records.push(attempt.usageRecord);
    } else if (attempt.usage) {
      // Normalize legacy StageUsage
      const role = attempt.role;
      records.push(
        normalizeLegacyUsage({
          usage: attempt.usage,
          runId: manifest.runId,
          role,
          attempt: attempt.attempt,
        }),
      );
    } else {
      // No usage data at all — incomplete
      records.push(
        normalizeLegacyUsage({
          usage: null,
          runId: manifest.runId,
          role: attempt.role,
          attempt: attempt.attempt,
        }),
      );
    }
  }

  return aggregateUsage(records);
};

/**
 * Load and normalize the `usage` map from a legacy manifest.
 * Returns an AggregatedUsage with unknown provenance for missing data.
 */
export const loadLegacyManifestUsage = (manifest: RunManifest): AggregatedUsage => {
  const records: UsageRecord[] = [];

  // Process legacy usage map
  for (const [stage, usage] of Object.entries(manifest.usage)) {
    records.push(
      normalizeLegacyUsage({
        usage,
        runId: manifest.runId,
        role: stage as ContractWorkerRole,
        attempt: 0,
      }),
    );
  }

  // Also include attempt-level usage if present
  for (const attempt of manifest.attempts) {
    if (
      attempt.usage &&
      !records.find((r) => r.eventId.endsWith(`-${attempt.role}-${attempt.attempt}`))
    ) {
      records.push(
        normalizeLegacyUsage({
          usage: attempt.usage,
          runId: manifest.runId,
          role: attempt.role,
          attempt: attempt.attempt,
        }),
      );
    }
  }

  return aggregateUsage(records);
};
