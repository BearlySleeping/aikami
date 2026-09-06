// scripts/src/lib/agents/contract_pipeline/usage_ledger.ts
//
// C-473: usage ledger — aggregate per-attempt usage into run/task totals.
// Handles deduplication, retry reconciliation, legacy compatibility and
// honest representation of missing/estimated costs.

import { existsSync, readFileSync } from 'node:fs';
import type {
  AggregatedUsage,
  ContractWorkerRole,
  CurrencyProvenance,
  MonetaryAmount,
  RunManifest,
  StageUsage,
  UsageRecord,
} from './types.ts';

// ── Active-path collection (C-473 AC-1) ──

/** Shape of one `pi --mode json` assistant-turn event carrying usage. */
type PiUsageEvent = {
  type?: string;
  message?: {
    role?: string;
    model?: string;
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      totalTokens?: number;
      cost?: { total?: number };
    };
  };
};

const emptyStageUsage = (): StageUsage => ({
  model: '',
  turns: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  cost: 0,
});

/**
 * Parse a `pi --mode json` JSONL event stream into a `StageUsage` summary.
 *
 * Shared between the legacy direct-spawn worker path (`worker.ts`) and the
 * active Herdr launch path (`herdr_adapter.ts`), which tees the same worker
 * stdout into a per-attempt log instead of piping it through a child
 * process directly. Tolerant of interleaved non-JSON lines (herdr pane
 * banners, shell echoes) — those are skipped, never thrown on.
 */
export const parseUsageFromJsonlText = (text: string): StageUsage => {
  const usage = emptyStageUsage();
  for (const line of text.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    let event: PiUsageEvent;
    try {
      event = JSON.parse(line) as PiUsageEvent;
    } catch {
      continue;
    }
    if (event.type !== 'message_end' || event.message?.role !== 'assistant') {
      continue;
    }
    const eventUsage = event.message.usage;
    usage.turns += 1;
    usage.model = event.message.model ?? usage.model;
    usage.inputTokens += eventUsage?.input ?? 0;
    usage.outputTokens += eventUsage?.output ?? 0;
    usage.cacheReadTokens += eventUsage?.cacheRead ?? 0;
    usage.cacheWriteTokens += eventUsage?.cacheWrite ?? 0;
    usage.totalTokens = eventUsage?.totalTokens ?? usage.totalTokens;
    usage.cost += eventUsage?.cost?.total ?? 0;
  }
  return usage;
};

/**
 * Read and parse a worker's JSONL usage log from disk.
 * Returns `undefined` (never a zeroed `StageUsage`) when the log is missing
 * — a missing log is unknown coverage, not proof of zero cost. See
 * {@link normalizeLegacyUsage}, which turns `undefined` into an explicit
 * `unknown`-provenance record rather than a silent zero.
 */
export const readUsageLog = (logPath: string): StageUsage | undefined => {
  if (!existsSync(logPath)) {
    return undefined;
  }
  try {
    return parseUsageFromJsonlText(readFileSync(logPath, 'utf-8'));
  } catch {
    return undefined;
  }
};

// ── Helpers ──

/** Default monetary amount for unknown/incomplete provenance. */
const _unknownMonetary = (currency = 'USD'): MonetaryAmount => ({
  amount: 0,
  currency,
  provenance: 'unknown',
});

const PROVENANCE_ORDER = {
  provider_reported: 0,
  estimated: 1,
  incomplete: 2,
  unknown: 3,
} as const satisfies Record<CurrencyProvenance, number>;

const _leastPreciseProvenance = (
  a: CurrencyProvenance,
  b: CurrencyProvenance,
): CurrencyProvenance => ((PROVENANCE_ORDER[a] ?? 99) >= (PROVENANCE_ORDER[b] ?? 99) ? a : b);

const _countFailedAttempts = (manifest: RunManifest): number =>
  manifest.attempts.filter((attempt) => attempt.result?.status === 'failed').length;

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
  const hasData =
    usage &&
    (usage.inputTokens ||
      usage.outputTokens ||
      usage.cacheReadTokens ||
      usage.cacheWriteTokens ||
      usage.totalTokens ||
      usage.cost ||
      usage.turns);

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
    turns: usage.turns ?? 0,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0,
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
 * Merge two MonetaryAmount values from the same currency. The least precise
 * provenance wins so the sum never overstates any contributing amount.
 */
export const mergeMonetaryAmounts = (a: MonetaryAmount, b: MonetaryAmount): MonetaryAmount => {
  if (a.currency !== b.currency) {
    return a; // Different currencies — keep a (caller should not merge across currencies)
  }

  const leastPreciseProvenance = _leastPreciseProvenance(a.provenance, b.provenance);

  const conversion = a.conversion ?? b.conversion;
  const pricingVersion = a.pricingVersion ?? b.pricingVersion;

  return {
    amount: a.amount + b.amount,
    currency: a.currency,
    provenance: leastPreciseProvenance,
    pricingVersion,
    conversion,
  };
};

/**
 * Aggregate an array of UsageRecords into a single AggregatedUsage.
 * Deduplicates by eventId first. Unknown attempts are counted separately and
 * never silently absorbed into zero; manifest helpers add explicit failures.
 */
export const aggregateUsage = (records: UsageRecord[]): AggregatedUsage => {
  const { records: deduplicated } = deduplicateRecords(records);

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
  const failedAttempts = 0;
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

    if (isUsageUnknown(record) || !record.complete) {
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
    const allHaveConversion = currencies.every((currency) => {
      const amount = monetary[currency];
      return (
        amount?.conversion !== undefined &&
        amount.conversion.rate > 0 &&
        amount.conversion.source.length > 0 &&
        amount.conversion.timestamp.length > 0
      );
    });

    if (allHaveConversion) {
      const sourceTotal = currencies.reduce(
        (total, currency) => total + (monetary[currency]?.amount ?? 0),
        0,
      );
      const totalAmount = currencies.reduce((total, currency) => {
        const amount = monetary[currency];
        if (!amount?.conversion) {
          return total;
        }
        return total + amount.amount * amount.conversion.rate;
      }, 0);

      if (sourceTotal > 0) {
        const conversionSources = [
          ...new Set(
            currencies
              .map((currency) => monetary[currency]?.conversion?.source)
              .filter((source) => source !== undefined),
          ),
        ];
        const conversionTimestamp = currencies.reduce((latest, currency) => {
          const timestamp = monetary[currency]?.conversion?.timestamp ?? '';
          return timestamp > latest ? timestamp : latest;
        }, '');
        const convertedProvenance = currencies.reduce<CurrencyProvenance>(
          (provenance, currency) =>
            _leastPreciseProvenance(provenance, monetary[currency]?.provenance ?? 'unknown'),
          'estimated',
        );

        convertedTotal = {
          amount: totalAmount,
          currency: 'USD',
          provenance: convertedProvenance,
          conversion: {
            rate: totalAmount / sourceTotal,
            timestamp: conversionTimestamp,
            source: `aggregate-currency-conversion:${conversionSources.join('+')}`,
          },
        };
      }
    }
  } else if (currencies.length === 1) {
    const single = monetary[currencies[0]];
    if (
      single?.conversion &&
      single.amount > 0 &&
      single.conversion.rate > 0 &&
      single.conversion.source.length > 0 &&
      single.conversion.timestamp.length > 0
    ) {
      convertedTotal = {
        ...single,
        amount: single.amount * single.conversion.rate,
        currency: 'USD',
        provenance: _leastPreciseProvenance(single.provenance, 'estimated'),
      };
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

  return {
    ...aggregateUsage(records),
    failedAttempts: _countFailedAttempts(manifest),
  };
};

/**
 * Load and normalize the `usage` map from a legacy manifest.
 * Returns an AggregatedUsage with unknown provenance for missing data.
 */
export const loadLegacyManifestUsage = (manifest: RunManifest): AggregatedUsage => {
  const records: UsageRecord[] = [];
  const usageMapRoles = new Set(Object.keys(manifest.usage));

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
    if (attempt.usage && !usageMapRoles.has(attempt.role)) {
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

  return {
    ...aggregateUsage(records),
    failedAttempts: _countFailedAttempts(manifest),
  };
};
