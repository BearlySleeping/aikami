// packages/shared/types/src/lib/text_telemetry.ts
//
// Shared telemetry contracts for the rolling LLM call buffer and diagnostics.
//
// The span records the whole critical path of ONE logical request — routing,
// queueing, generation, parsing, application — plus the identity needed to
// stitch a turn's agent calls, retries and fallbacks back together (issue
// #382 P0). Everything here is content-free metadata: no prompt text, no
// completion text, no credentials. Narrative content is never recorded, because
// a diagnostics buffer that can hold a player's own words must be opted into
// explicitly and is not.
//
// Token counts carry their provenance. `tokenSource: 'provider'` means the
// provider's own accounting, which is what gets billed; `'estimated'` means a
// character-count approximation, which is a budgeting aid and nothing more.
// Presenting the two as the same number is how a cost estimate becomes a
// fiction.

import type { TextTask } from '@aikami/constants';

/** Where a span's token counts came from. */
export type TextTokenSource = 'provider' | 'estimated';

/**
 * Why a cache answered, or which layer was consulted.
 *
 * The layers are kept distinct on purpose: a local response-cache hit is NOT a
 * provider prompt-cache hit, and a prompt-prefix cache saves tokens while an
 * exact result cache saves a whole call. Reporting them as one "cache hit"
 * would credit a mechanism that saved nothing.
 */
export type TextCacheLayer =
  /** Nothing was cached; the call reached a provider. */
  | 'none'
  /** An in-flight identical request was coalesced onto this one. */
  | 'in-flight-dedup'
  /** A previously stored exact result for the same key was replayed. */
  | 'exact-result';

/** One recorded LLM call. */
export type TextTelemetrySpan = {
  /** Monotonic id, unique within a session. */
  id: number;
  /** Task type, when the call declared one. */
  task?: TextTask;
  /** Resolved provider registry id (e.g. 'openrouter', 'llamacpp'). */
  provider: string;
  /** Resolved model id. */
  model: string;
  /** Resolved adapter mode. */
  mode: string;
  /** Whether the call streamed tokens. */
  streamed: boolean;
  /** Time to first streamed token, when observed. */
  ttftMs?: number;
  /** Total wall-clock duration. */
  totalMs: number;
  /** Prompt tokens — provider-reported or estimated, per `tokenSource`. */
  promptTokens: number;
  /** Completion tokens — provider-reported or estimated, per `tokenSource`. */
  completionTokens: number;
  /** Which of the two counts above these numbers are. */
  tokenSource: TextTokenSource;
  /** Provider-reported cached prompt tokens, when it reported any. */
  cachedTokens?: number;
  /** ISO timestamp of call start. */
  startedAt: string;
  /** Whether the call completed without error. */
  ok: boolean;
  /**
   * A local attempt gave way to the configured gateway route.
   *
   * Distinct from `errorCode: 'fallback'`, which means the whole call degraded.
   * This one records that a genuine second route was tried and succeeded.
   */
  fallback?: boolean;
  /** Normalized error code when `ok` is false. */
  errorCode?: string;
  /**
   * Identity of the logical request this call belongs to. Every retry, local
   * attempt and fallback attempt of one request shares it, which is what makes
   * a turn a single line in the trace rather than N unrelated spans.
   */
  requestId?: string;
  /** The turn this call is nested under, when it is a child call. */
  parentRequestId?: string;
  /** Whether the shared end-to-end deadline expired before this call finished. */
  deadlineExceeded?: boolean;
  /** Milliseconds left on the shared deadline when the call settled. */
  deadlineRemainingMs?: number;
  /** Which cache layer, if any, served or shaped this call. */
  cacheLayer?: TextCacheLayer;
  /** How many calls were already queued locally when this one was submitted. */
  queueDepth?: number;
};

/** Latency percentiles, only present where the sample count supports them. */
export type TextLatencyPercentiles = {
  /** Sample count the percentiles were computed from. */
  readonly count: number;
  /** Median total duration in ms. */
  readonly p50Ms: number;
  /** 95th percentile in ms; `undefined` below the minimum sample count. */
  readonly p95Ms?: number;
  /** 99th percentile in ms; `undefined` below the minimum sample count. */
  readonly p99Ms?: number;
};

/** Counters over the current buffer — call volume and failure mix. */
export type TextTelemetryCounters = {
  /** Spans in the buffer. */
  readonly calls: number;
  /** Spans that did not complete successfully. */
  readonly errors: number;
  /** Spans that ended because the shared deadline expired. */
  readonly deadlineExceeded: number;
  /** Spans aborted by the caller or by `cancelAll`. */
  readonly cancelled: number;
  /** Calls that fell back to a different route than the one attempted first. */
  readonly fallbacks: number;
  /** Calls served from a cache, split BY LAYER. */
  readonly cacheHits: Readonly<Record<TextCacheLayer | 'provider-prompt-cache', number>>;
  /** Deepest local queue observed, for contention measurement. */
  readonly maxQueueDepth: number;
};

/** Per-task aggregate, so call-2 (`envelope`) latency is measurable alone. */
export type TextTelemetryTaskSummary = {
  /** Task id, or 'untasked' when a call declared none. */
  task: TextTask | 'untasked';
  /** Number of spans for this task. */
  count: number;
  /** Median total duration in ms. */
  medianTotalMs: number;
  /** Median time-to-first-token in ms, when any span measured one. */
  medianTtftMs?: number;
  /** Count of failed spans for this task. */
  errorCount: number;
  /** Latency percentiles for this task. */
  latency: TextLatencyPercentiles;
};

/** Aggregate stats for the activity view. */
export type TextTelemetrySummary = {
  /** Number of spans in the buffer. */
  count: number;
  /** Median total duration in ms. */
  medianTotalMs: number;
  /** Total tokens across provider calls, excluding coalesced subscribers. */
  totalTokens: number;
  /** Count of failed spans. */
  errorCount: number;
  /** Per-task breakdown, most frequent first. */
  byTask: readonly TextTelemetryTaskSummary[];
  /** Latency percentiles over the whole buffer. */
  latency: TextLatencyPercentiles;
  /** Call volume and failure mix. */
  counters: TextTelemetryCounters;
  /** Sum of known costs in USD; `undefined` while any span is uncosted. */
  estimatedCostUsd?: number;
  /** Spans whose cost could not be priced from the versioned table. */
  unpricedCount: number;
  /** Price table version the cost figures came from. */
  pricingVersion?: string;
};
