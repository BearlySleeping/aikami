// apps/frontend/client/src/lib/services/ai/text_telemetry_service.svelte.ts
//
// Rolling critical-path telemetry. One span per LLM call, carrying the resolved
// routing, the deadline it was given, time-to-first-token, total duration, token
// counts WITH their provenance, and the outcome — plus enough request/turn
// identity to stitch a turn's agent calls, retries and fallbacks into one
// traceable line (issue #382 P0).
//
// Discipline this service enforces:
//
//   - Percentiles are published only when the sample count supports them. A
//     p95 over three samples is a lie with two decimal places, so the field is
//     absent instead.
//   - Cache hits are counted BY LAYER. A coalesced in-flight request, a stored
//     exact result and a provider prompt-prefix cache are three different
//     mechanisms with three different economics; merging them into one number
//     would credit a mechanism that saved nothing.
//   - Cost is summed only from priced spans, and any unpriced span makes the
//     total `undefined` rather than quietly under-reporting. A partial sum that
//     looks complete is worse than no sum.
//
// Everything recorded is content-free metadata. Narrative and player content are
// never buffered, and credentials never appear in a span.
//
// Contract: C-507, issue #382 P0

import { isLocalTextRoute, TEXT_PRICING_VERSION, type TextTask } from '@aikami/constants';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import type {
  TextCacheLayer,
  TextLatencyPercentiles,
  TextTelemetryCounters,
  TextTelemetrySpan,
  TextTelemetrySummary,
  TextTelemetryTaskSummary,
} from '@aikami/types';
import { textTelemetryPricing } from './text_telemetry_pricing.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TextTelemetryServiceOptions = BaseFrontendClassOptions;

/** Public surface of the telemetry singleton. */
export type TextTelemetryServiceInterface = BaseFrontendClassInterface & {
  /** Most recent spans, newest first (reactive). */
  readonly spans: ReadonlyArray<TextTelemetrySpan>;
  /** Aggregate stats over the current buffer. */
  readonly summary: TextTelemetrySummary;
  /** Records a completed call. `startedAt` defaults to now when omitted. */
  record(span: Omit<TextTelemetrySpan, 'id' | 'startedAt'> & { startedAt?: string }): void;
  /** Clears the buffer. */
  clear(): void;
};

/** Ring-buffer capacity. */
const MAX_SPANS = 100;

/**
 * Minimum samples before p95/p99 are published.
 *
 * Below this the tail is indistinguishable from noise, and a percentile that
 * cannot be supported is worse than an absent one: it looks like a measurement.
 */
const MIN_PERCENTILE_SAMPLES = 5;

/** Median of a numeric list (0 for an empty list). */
const median = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
};

/**
 * The sample-index percentile, using the nearest-rank method.
 *
 * Nearest-rank is chosen over interpolation because an interpolated p95
 * invents a value no call ever had; nearest-rank always names a real sample.
 */
const percentile = (sorted: number[], fraction: number): number | undefined => {
  if (sorted.length < MIN_PERCENTILE_SAMPLES) {
    return undefined;
  }
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  const value = sorted[index];
  return value === undefined ? undefined : Math.round(value);
};

/** Latency percentiles for one bucket of spans. */
const summarizeLatency = (values: number[]): TextLatencyPercentiles => {
  const sorted = [...values].sort((a, b) => a - b);
  const p50Ms = median(sorted);
  const p95Ms = percentile(sorted, 0.95);
  const p99Ms = percentile(sorted, 0.99);
  return {
    count: sorted.length,
    p50Ms,
    ...(p95Ms === undefined ? {} : { p95Ms }),
    ...(p99Ms === undefined ? {} : { p99Ms }),
  };
};

/**
 * Zeroed cache hit counts, as a mutable accumulator.
 *
 * Keyed wider than {@link TextCacheLayer} on purpose: a provider prompt-prefix
 * cache discounts TOKENS on a call that was made, so it is derived from the
 * provider's own cached-token count rather than from the layer that served the
 * call. Counting it as a layer would credit a mechanism that saved no call.
 */
const emptyCacheHitCounts = (): Record<TextCacheLayer | 'provider-prompt-cache', number> => ({
  none: 0,
  'in-flight-dedup': 0,
  'exact-result': 0,
  'provider-prompt-cache': 0,
});

/** An all-zero counter block, used for an empty buffer. */
const emptyCounters = (): TextTelemetryCounters => ({
  calls: 0,
  errors: 0,
  deadlineExceeded: 0,
  cancelled: 0,
  fallbacks: 0,
  attempts: 0,
  partialUsage: 0,
  localCalls: 0,
  cacheHits: emptyCacheHitCounts(),
  maxQueueDepth: 0,
});

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class TextTelemetryService
  extends BaseFrontendClass<TextTelemetryServiceOptions>
  implements TextTelemetryServiceInterface
{
  private _spans = $state<TextTelemetrySpan[]>([]);
  private _nextId = 1;
  get spans(): ReadonlyArray<TextTelemetrySpan> {
    return this._spans;
  }

  get summary(): TextTelemetrySummary {
    const spans = this._spans;
    if (spans.length === 0) {
      return {
        count: 0,
        medianTotalMs: 0,
        totalTokens: 0,
        errorCount: 0,
        byTask: [],
        latency: summarizeLatency([]),
        counters: emptyCounters(),
        unpricedCount: 0,
        pricingVersion: TEXT_PRICING_VERSION,
      };
    }
    return {
      count: spans.length,
      medianTotalMs: median(spans.map((span) => span.totalMs)),
      totalTokens: spans.reduce((sum, span) => sum + span.promptTokens + span.completionTokens, 0),
      errorCount: spans.filter((span) => !span.ok).length,
      byTask: this._summarizeByTask(spans),
      latency: summarizeLatency(spans.map((span) => span.totalMs)),
      counters: this._count(spans),
      ...this._cost(spans),
    };
  }

  /** Groups spans by task and computes per-task latency stats, most frequent first. */
  private _summarizeByTask(spans: ReadonlyArray<TextTelemetrySpan>): TextTelemetryTaskSummary[] {
    const buckets = new Map<TextTask | 'untasked', TextTelemetrySpan[]>();
    for (const span of spans) {
      const key = span.task ?? 'untasked';
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.push(span);
      } else {
        buckets.set(key, [span]);
      }
    }

    return [...buckets.entries()]
      .map(([task, bucket]): TextTelemetryTaskSummary => {
        const ttfts = bucket
          .map((span) => span.ttftMs)
          .filter((value): value is number => value !== undefined);
        const medianTtftMs = ttfts.length > 0 ? median(ttfts) : undefined;
        // Pooled separately from `ttftMs` on purpose. On a reasoning model the
        // first frame carries the thinking channel, so the first WORD arrives
        // seconds later; averaging the two would describe no real call.
        const firstVisible = bucket
          .map((span) => span.firstVisibleContentMs)
          .filter((value): value is number => value !== undefined);
        const medianFirstVisibleContentMs =
          firstVisible.length > 0 ? median(firstVisible) : undefined;
        return {
          task,
          count: bucket.length,
          medianTotalMs: median(bucket.map((span) => span.totalMs)),
          ...(medianTtftMs === undefined ? {} : { medianTtftMs }),
          ...(medianFirstVisibleContentMs === undefined ? {} : { medianFirstVisibleContentMs }),
          errorCount: bucket.filter((span) => !span.ok).length,
          latency: summarizeLatency(bucket.map((span) => span.totalMs)),
        };
      })
      .sort((a, b) => b.count - a.count);
  }

  /** Call volume, failure mix, cache hits by layer, and queue contention. */
  private _count(spans: ReadonlyArray<TextTelemetrySpan>): TextTelemetryCounters {
    const cacheHits: Record<TextCacheLayer | 'provider-prompt-cache', number> =
      emptyCacheHitCounts();
    let maxQueueDepth = 0;
    for (const span of spans) {
      cacheHits[(span.cacheLayer ?? 'none') as TextCacheLayer] += 1;
      maxQueueDepth = Math.max(maxQueueDepth, span.queueDepth ?? 0);
    }
    return {
      calls: spans.length,
      errors: spans.filter((span) => !span.ok).length,
      deadlineExceeded: spans.filter((span) => span.deadlineExceeded === true).length,
      cancelled: spans.filter((span) => span.errorCode === 'cancelled').length,
      fallbacks: spans.filter((span) => span.fallback === true).length,
      // A span that recorded no attempt count dispatched exactly one attempt,
      // which is the overwhelmingly common case and must not read as zero.
      attempts: spans.reduce((sum, span) => sum + (span.attemptCount ?? 1), 0),
      partialUsage: spans.filter((span) => span.partialUsage === true).length,
      localCalls: spans.filter((span) => isLocalTextRoute(span.provider)).length,
      cacheHits,
      maxQueueDepth,
    };
  }

  /**
   * Sums priced spans, and refuses to publish a total that is silently missing
   * an unpriced one. Partial sums that look complete are the failure mode this
   * guards: a reader cannot tell "cheap" from "not measured".
   */
  private _cost(spans: ReadonlyArray<TextTelemetrySpan>): {
    estimatedCostUsd?: number;
    providerBillingUsd?: number;
    unpricedCount: number;
    pricingVersion?: string;
  } {
    let total = 0;
    let unpricedCount = 0;
    for (const span of spans) {
      const estimate = textTelemetryPricing.estimate({
        provider: span.provider,
        model: span.model,
        inputTokens: span.promptTokens,
        outputTokens: span.completionTokens,
        ...(span.cachedTokens === undefined ? {} : { cachedTokens: span.cachedTokens }),
      });
      if (estimate.usd === undefined) {
        unpricedCount += 1;
        continue;
      }
      total += estimate.usd;
    }
    return {
      ...(unpricedCount === 0 ? { estimatedCostUsd: total } : {}),
      // PROVIDER BILLING only, on purpose. A local route contributes a real
      // zero here and its electricity and hardware cost is NOT thereby zero —
      // it is simply not something anybody measured, and inventing a dollar
      // figure for it would be a fabrication wearing a currency symbol.
      ...(unpricedCount === 0 ? { providerBillingUsd: total } : {}),
      unpricedCount,
      ...(unpricedCount === 0 ? { pricingVersion: TEXT_PRICING_VERSION } : {}),
    };
  }

  record(span: Omit<TextTelemetrySpan, 'id' | 'startedAt'> & { startedAt?: string }): void {
    const entry: TextTelemetrySpan = {
      ...span,
      id: this._nextId++,
      startedAt: span.startedAt ?? new Date().toISOString(),
    };
    this._spans = [entry, ...this._spans].slice(0, MAX_SPANS);
  }

  clear(): void {
    this._spans = [];
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const textTelemetryService: TextTelemetryServiceInterface = TextTelemetryService.create({
  className: 'TextTelemetryService',
});
