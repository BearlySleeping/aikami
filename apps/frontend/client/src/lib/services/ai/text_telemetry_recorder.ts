// apps/frontend/client/src/lib/services/ai/text_telemetry_recorder.ts
//
// Projects one completed text call onto a telemetry span (issue #382 P0).
//
// Extracted from the text service so the service stays a routing/deadline
// decision surface and this stays a pure projection. Nothing here touches the
// provider, the clock or the network: it takes what a call already observed and
// decides what to record — including the three distinctions that make the buffer
// trustworthy:
//
//   - TOKEN PROVENANCE. A provider-reported count and a character-count estimate
//     are both useful, but only one of them is a bill. The span records which one
//     it is holding rather than presenting both as the same number.
//   - DEADLINE vs CANCELLATION. A request that ran out of budget and one the
//     user cancelled are different outcomes, and only the first is a budget
//     failure worth counting.
//   - FALLBACK vs DEGRADED. "A local attempt gave way to the configured route and
//     succeeded" is a different fact from "this call failed".

import { estimateTextTokens, type TextTask } from '@aikami/constants';
import { isAiGatewayError } from '@aikami/frontend/ai-gateway';
import type {
  AiModeResolution,
  TextAttemptObservation,
  TextCacheLayer,
  TextDispatchKind,
} from '@aikami/types';
import type { AiRequestDeadline } from './ai_request_deadline.ts';
import { textTelemetryService } from './text_telemetry_service.svelte.ts';

/** Everything a finished call observed, as the recorder needs it. */
export type TextCallObservation = {
  /** `performance.now()` at call start. */
  start: number;
  /** ISO timestamp of call start. */
  startedAt: string;
  /** The routing that served (or refused) the call. */
  resolution?: AiModeResolution;
  /** The task the call declared, when it declared one. */
  task?: TextTask;
  /** Whether tokens were streamed rather than extracted. */
  streamed: boolean;
  /** Time to first streamed token, when observed. */
  ttftMs?: number;
  /** Prompt length in characters — the basis for an ESTIMATED count. */
  promptChars: number;
  /** Completion length in characters — the basis for an ESTIMATED count. */
  completionChars: number;
  /** Whether the call completed without error. */
  ok: boolean;
  /** The error, when `ok` is false. */
  error?: unknown;
  /** A local attempt gave way to the configured gateway route. */
  fallback?: boolean;
  /**
   * Identity of the logical request this call belongs to.
   *
   * A coalescer supplies the SAME id for every subscriber waiting on one
   * dispatch, so their attempt events collapse onto ONE provider bill instead
   * of multiplying measured spend by the number of consumers. This is what
   * makes "one bill, N waiters" expressible at all.
   */
  requestId?: string;
  /** The turn this call is nested under. */
  parentRequestId?: string;
  /** The shared end-to-end budget this call drew from. */
  deadline?: AiRequestDeadline;
  /** Provider-reported usage, when the provider reported it. */
  usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number };
  /** Which cache layer, if any, served or shaped this call. */
  cacheLayer?: TextCacheLayer;
  /**
   * Milliseconds spent waiting for admission to expensive inference, from
   * joining the contention domain's queue to being admitted. Already included
   * in `totalMs`; carried separately so queueing is observable on its own.
   */
  queueMs?: number;
  /**
   * Requests ahead of this one in its contention domain's admission queue at
   * the instant it joined — the entry snapshot, never re-sampled.
   */
  queueDepth?: number;
  /**
   * Per-attempt facts observed by the transport.
   *
   * Filled from `AiTransportAttemptEvent`s, which fire for EVERY dispatched
   * attempt — including empty-body retries, schema-invalid responses and
   * structured fallbacks. The provider billed each of them, so an accounting
   * boundary that only saw the surviving attempt under-reports real spend.
   */
  attempts?: readonly TextAttemptObservation[];
  /**
   * How this logical request was satisfied.
   *
   * The axis that separates a provider bill from a local answer, a shared
   * answer and work that was never sent. Without it, "no attempts recorded"
   * is ambiguous between four different outcomes, and a report built on that
   * ambiguity either over-reports spend or under-reports savings.
   */
  dispatch?: TextDispatchKind;
};

/**
 * Recognizes an exhausted budget even before the deadline timer has had a turn to
 * fire.
 *
 * A caller can hand down a deadline that is ALREADY in the past, in which case no
 * timer has been armed and the abort reason would never be set — leaving a
 * genuine timeout indistinguishable from a caller cancellation.
 */
const deadlineExceeded = (deadline?: AiRequestDeadline): boolean =>
  deadline?.stopReason() === 'deadline' ||
  (deadline?.stopReason() !== 'caller-abort' && deadline?.expired() === true);

/**
 * Normalizes a failure into the code a span carries.
 *
 * A gateway error already carries a code, so it is passed through untouched. A
 * raw error collapses to `cancelled` or `error` — the two states a caller acts
 * on differently, and the only ones the span's vocabulary distinguishes.
 */
const spanErrorCode = (error: unknown, cancelled: boolean): string | undefined => {
  if (error === undefined) {
    return undefined;
  }
  if (isAiGatewayError(error)) {
    return error.code;
  }
  return cancelled ? 'cancelled' : 'error';
};

/** One attempt as the recorder sees it. */
type RecordedAttempt = NonNullable<TextCallObservation['attempts']>[number];

/**
 * Reduces the transport's per-attempt events to the few numbers a span can hold.
 *
 * The full per-attempt list stays on the transport's own event stream; a span is
 * a summary, and a summary that silently dropped the DISCARDED attempts would
 * understate the bill. Every field is optional-by-absence for the same reason
 * the transport's are: a runtime that did not report something is unknown, not
 * zero.
 */
const attemptFacts = (
  attempts: readonly RecordedAttempt[] | undefined,
): Record<string, unknown> => {
  if (attempts === undefined || attempts.length === 0) {
    return {};
  }
  const settled = attempts.filter((attempt) => attempt.outcome !== undefined);
  const firstVisibleContentMs = settled.find(
    (attempt) => attempt.firstContentMs !== undefined,
  )?.firstContentMs;
  const doneReason = [...settled].reverse().find((a) => a.doneReason !== undefined)?.doneReason;
  const cachedKnown = attempts.every((a) => a.usage?.cachedTokens !== undefined);
  return {
    // A `buffered-json` route has no first-content time at all, so naming the
    // shape is what stops a buffered completion from being read as a
    // time-to-first-token.
    ...(attempts[0]?.transport === undefined ? {} : { transport: attempts[0].transport }),
    ...(firstVisibleContentMs === undefined ? {} : { firstVisibleContentMs }),
    attemptCount: Math.max(1, attempts.length),
    ...(attempts.some((a) => a.usage?.partial === true) ? { partialUsage: true } : {}),
    // 'unknown' is recorded when any attempt lacks a cached count,
    // so a runtime that does not supply the counter is distinguishable from one
    // that measured zero.
    cachedSource: cachedKnown ? ('provider' as const) : ('unknown' as const),
    ...(doneReason === undefined ? {} : { doneReason }),
  };
};

/**
 * The fields of a span that describe a SETTLED call rather than its attempts.
 *
 * Split from {@link recordTextCall} because those two groups are edited for
 * different reasons and read for different reasons: the attempt facts change
 * whenever the transport learns a new thing it can report, and the settled
 * fields change whenever the vocabulary of an outcome does. Keeping them apart
 * is what stops a new attempt field from being added in a hurry and landing in
 * the wrong builder.
 */
const settledFields = (observation: TextCallObservation): Record<string, unknown> => {
  const { resolution, streamed, ttftMs, deadline, usage } = observation;
  return {
    provider: resolution?.provider ?? 'unknown',
    model: resolution?.model ?? '',
    mode: resolution?.mode ?? 'unknown',
    streamed,
    ttftMs,
    totalMs: Math.round(performance.now() - observation.start),
    ...tokenFields(observation, usage),
    startedAt: observation.startedAt,
    ok: observation.ok,
    ...identityFields(observation, deadline),
  };
};

/**
 * The token counts, with the provenance that makes them usable.
 *
 * `tokenSource` is the whole point: a character-count estimate and a provider
 * bill are both "tokens", and presenting them as the same number is how a cost
 * estimate becomes a fiction.
 */
const tokenFields = (
  observation: TextCallObservation,
  usage: TextCallObservation['usage'],
): Record<string, unknown> => ({
  promptTokens: usage?.inputTokens ?? estimateTextTokens(observation.promptChars),
  completionTokens: usage?.outputTokens ?? estimateTextTokens(observation.completionChars),
  tokenSource: usage === undefined ? 'estimated' : 'provider',
  ...(usage?.cachedTokens === undefined ? {} : { cachedTokens: usage.cachedTokens }),
});

/** How the request was identified, and how it ended. */
const identityFields = (
  observation: TextCallObservation,
  deadline: TextCallObservation['deadline'],
): Record<string, unknown> => {
  const isAbortError = (observation.error as { name?: string } | undefined)?.name === 'AbortError';
  const errorCode = spanErrorCode(observation.error, isAbortError);
  return {
    ...(observation.task === undefined ? {} : { task: observation.task }),
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(observation.fallback === undefined ? {} : { fallback: observation.fallback }),
    ...(observation.requestId === undefined ? {} : { requestId: observation.requestId }),
    ...(observation.dispatch === undefined ? {} : { dispatch: observation.dispatch }),
    ...(observation.parentRequestId === undefined
      ? {}
      : { parentRequestId: observation.parentRequestId }),
    deadlineExceeded: deadlineExceeded(deadline),
    ...(deadline === undefined ? {} : { deadlineRemainingMs: deadline.remainingMs() }),
    ...(observation.cacheLayer === undefined ? {} : { cacheLayer: observation.cacheLayer }),
    // Queueing is part of the critical path, so it is inside `totalMs` by
    // construction (the span's start is captured before admission). It is
    // recorded again here only so the wait is visible as its own quantity.
    ...(observation.queueMs === undefined ? {} : { queueMs: observation.queueMs }),
    ...(observation.queueDepth === undefined ? {} : { queueDepth: observation.queueDepth }),
  };
};

/**
 * Queue measurements for a span, when the call passed through admission.
 *
 * `0` is a real measurement — "this call joined an idle queue" — and is
 * recorded for every call that did, so `queueMs > 0` means something. ABSENT is
 * reserved for calls that never reached admission at all: a local-first
 * success, or a coalesced subscriber that joined somebody else's attempt.
 */
export const queueSpanFields = (admission?: {
  queueMs: number;
  queueDepth: number;
}): { queueMs?: number; queueDepth?: number } =>
  admission === undefined ? {} : { queueMs: admission.queueMs, queueDepth: admission.queueDepth };

/**
 * Records one finished call.
 *
 * Pure with respect to the call: it reads only what the caller observed, so it
 * cannot introduce latency or a second source of truth about what happened.
 */
export const recordTextCall = (observation: TextCallObservation): void => {
  textTelemetryService.record({
    ...attemptFacts(observation.attempts),
    ...settledFields(observation),
  } as Parameters<typeof textTelemetryService.record>[0]);
};
