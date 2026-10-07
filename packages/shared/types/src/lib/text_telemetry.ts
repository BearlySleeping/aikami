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
 * HOW the logical request was satisfied — the axis that separates a provider
 * bill from everything that is not one.
 *
 * 🔴 This is the distinction a per-attempt event stream cannot make on its
 * own. `onAttempt` fires per DISPATCHED attempt, so a request answered on the
 * device, a request that joined someone else's attempt, and a request that was
 * dropped from the admission queue all produce exactly the same silence. Read
 * as "no attempts", that silence is indistinguishable from "nothing happened",
 * and a cost report built on it under-reports the calls that did happen while
 * also failing to say that three requests cost nothing.
 *
 * The four values are mutually exclusive and exhaustive for a settled request:
 *
 *  - `provider` — a provider attempt was dispatched. `attemptCount` is the real
 *    number of bills, always ≥ 1.
 *  - `local` — answered on-device. Zero provider billing, and NOT zero cost:
 *    the hardware and electricity are real and are not priced here.
 *  - `coalesced` — this caller joined an attempt somebody else started. It cost
 *    nothing, and the attempt it rode on is recorded on the INITIATOR's span.
 *    Counting it again would multiply measured spend by the subscriber count.
 *  - `suppressed` — deliberately never dispatched: dropped from admission,
 *    cut by an exhausted deadline, or abandoned before the local attempt.
 *    Recorded so a budget that saved work is visible as savings rather than as
 *    an absence.
 */
export type TextDispatchKind = 'provider' | 'local' | 'coalesced' | 'suppressed';

/**
 * Which wire shape actually carried a generation.
 *
 * Added because `streamed` alone cannot carry the distinction that matters for
 * a latency claim. A `buffered-json` route has NO first-content time at all —
 * the whole body is awaited before any text exists — so a completion measured
 * on that route must never be presented as a time-to-first-token. Naming the
 * shape makes the difference visible in the record rather than in prose
 * explaining it.
 */
export type TextTransportShape = 'ndjson-stream' | 'sse-stream' | 'buffered-json';

/** Content-free facts observed for one dispatched text attempt. */
export type TextAttemptObservation = {
  kind: 'narrative' | 'structured';
  transport: TextTransportShape;
  outcome?: TextAttemptOutcome;
  firstContentMs?: number;
  totalMs?: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens?: number;
    cachedSource?: TextTelemetrySpan['cachedSource'];
    partial?: boolean;
  };
  doneReason?: string;
  truncated?: boolean;
};

/** How one dispatched provider attempt ended. */
export type TextAttemptOutcome =
  | 'completed'
  | 'empty'
  | 'invalid'
  | 'unsupported'
  | 'error'
  | 'cancelled'
  | 'timeout';

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
  /**
   * How this logical request was satisfied.
   *
   * Absent only on a span recorded by a caller that predates this field; every
   * span the text service records today carries one. See
   * {@link TextDispatchKind} for why "no attempts" is not a sufficient answer.
   */
  dispatch?: TextDispatchKind;
  /** Whether the call streamed tokens. */
  streamed: boolean;
  /**
   * Which wire shape carried the generation.
   *
   * `buffered-json` means there was no first-content time to measure, and any
   * `ttftMs` alongside it would be meaningless. Recorded explicitly so a
   * reader never has to infer the difference from a single boolean.
   */
  transport?: TextTransportShape;
  /**
   * Milliseconds to the first VISIBLE content fragment.
   *
   * Distinct from `ttftMs`, which is the first frame of any kind. On a
   * reasoning model the first frames carry the thinking channel with an empty
   * content field, so the two can differ by seconds; publishing the frame time
   * as "time to first token" would understate what the player waits by an order
   * of magnitude.
   */
  firstVisibleContentMs?: number;
  /**
   * How many provider attempts this logical call DISPATCHED.
   *
   * Greater than 1 means the provider was billed more than once: an empty-body
   * retry, a structured fallback, a plain-text rescue. Recorded because the
   * spend happened whether or not the caller looked at the discarded output.
   */
  attemptCount?: number;
  /**
   * The token counts do not cover the whole dispatched attempt.
   *
   * Known numbers plus an unknown remainder. Summed into a cost column as if it
   * were complete, this makes a truncated generation look like a cheap one.
   */
  partialUsage?: boolean;
  /**
   * Where the cached-token count came from.
   *
   * `'unknown'` is a recorded value, not an omission: the runtime did not
   * supply the counter. Never inferred from latency.
   */
  cachedSource?: 'provider' | 'unknown';
  /** The provider's own termination reason, e.g. `stop` or `length`. */
  doneReason?: string;
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
  /**
   * How many requests were AHEAD of this one in its contention domain's
   * admission queue at the instant it joined that queue — a snapshot taken on
   * entry, never re-sampled afterwards.
   *
   * The "contention domain" is the resource the effective routing actually
   * resolves to (see `text_request_admission.ts`): a provider + endpoint pair,
   * deliberately NOT including the model, because two models served by the
   * same local runtime compete for the same device.
   *
   * `0` is a real measurement — "this call joined an idle queue" — and is
   * recorded for every call that passed through admission, so `maxQueueDepth`
   * reflects the deepest queue actually observed instead of being
   * structurally pinned at zero. A call that never joined a queue carries no
   * value at all rather than a fabricated one.
   */
  queueDepth?: number;
  /**
   * Milliseconds this call spent WAITING for admission to expensive inference,
   * from joining its contention domain's queue to being admitted.
   *
   * This time is already part of {@link totalMs}: the critical path a player
   * waits on is queue plus execution, and reporting `totalMs` without the
   * queue makes a request that sat in a queue look exactly as fast as one that
   * did not.
   *
   * `0` means "admitted immediately", which is the honest value for
   * interactive work — and is recorded, so that `queueMs > 0` means something.
   *
   * The value is ABSENT only when the call never passed through inference
   * admission at all: a local-first success answered on-device, or a coalesced
   * subscriber that joined an attempt somebody else started. Those calls have
   * no queue of their own to report, and inventing a number for them would be
   * worse than recording nothing.
   */
  queueMs?: number;
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
  /**
   * Provider attempts DISPATCHED across the buffer.
   *
   * Compared against `calls`, this is the retry/fallback rate. It exceeds
   * `calls` whenever a logical request spent more than one provider bill, which
   * is the number a cost investigation needs first.
   *
   * Only `dispatch: 'provider'` spans contribute. A local answer, a coalesced
   * subscriber and a suppressed request all dispatch ZERO provider attempts,
   * and adding a default of one to each of them — the previous behaviour —
   * inflated this figure by exactly the number of requests that cost nothing.
   */
  readonly attempts: number;
  /**
   * Logical requests that were answered by joining someone else's attempt.
   *
   * Their provider spend is already counted on the initiator's span, which is
   * the only way "one bill, N waiters" is expressible as a number.
   */
  readonly coalesced: number;
  /**
   * Requests deliberately never dispatched — dropped from admission, cut by an
   * exhausted deadline, abandoned before the local attempt.
   *
   * A budget's real output. Without this counter, work the deadline and the
   * admission gate avoided is invisible, and "we made no calls" reads as a
   * measurement rather than as the absence of one.
   */
  readonly suppressed: number;
  /** Spans whose token counts do not cover the whole attempt. */
  readonly partialUsage: number;
  /**
   * Calls served by an on-device route.
   *
   * These cost nothing in PROVIDER BILLING, which is a fact about the route and
   * not a claim that the inference was free: the electricity and the hardware
   * are real. Counted separately so a zero-bill route is never read as a
   * saving, and never silently dropped from a cost total.
   */
  readonly localCalls: number;
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
  /**
   * Median time to first VISIBLE content, when any span measured one.
   *
   * Reported separately from `medianTtftMs` and never pooled with it: a
   * thinking model's first frame arrives long before its first word, so
   * averaging the two would produce a number that describes no call anyone made.
   */
  medianFirstVisibleContentMs?: number;
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
  /**
   * USD spent on PROVIDER BILLING only.
   *
   * Excludes on-device inference entirely. It is `undefined` while any span is
   * uncosted, and it is never a claim about total resource cost: local
   * inference has a real electricity and hardware cost that this number does
   * not attempt to estimate, because estimating it would be inventing a dollar
   * figure for something nobody measured.
   */
  providerBillingUsd?: number;
};
