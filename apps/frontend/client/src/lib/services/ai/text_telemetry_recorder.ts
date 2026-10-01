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
import type { AiModeResolution, TextCacheLayer } from '@aikami/types';
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
  /** Identity of the logical request this call belongs to. */
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

/**
 * Records one finished call.
 *
 * Pure with respect to the call: it reads only what the caller observed, so it
 * cannot introduce latency or a second source of truth about what happened.
 */
export const recordTextCall = (observation: TextCallObservation): void => {
  const { resolution, task, streamed, ttftMs, deadline, usage, queueMs, queueDepth } = observation;
  // A raw `AbortError` from a caller is a cancellation; an `AiGatewayException`
  // carries its own code and does not need classifying.
  const isAbortError = (observation.error as { name?: string } | undefined)?.name === 'AbortError';
  const errorCode = spanErrorCode(observation.error, isAbortError);

  textTelemetryService.record({
    task,
    provider: resolution?.provider ?? 'unknown',
    model: resolution?.model ?? '',
    mode: resolution?.mode ?? 'unknown',
    streamed,
    ttftMs,
    totalMs: Math.round(performance.now() - observation.start),
    promptTokens: usage?.inputTokens ?? estimateTextTokens(observation.promptChars),
    completionTokens: usage?.outputTokens ?? estimateTextTokens(observation.completionChars),
    // The provenance of the two counts above travels with them. Presenting an
    // estimate as a provider figure is how a cost estimate becomes a fiction.
    tokenSource: usage === undefined ? 'estimated' : 'provider',
    ...(usage?.cachedTokens === undefined ? {} : { cachedTokens: usage.cachedTokens }),
    startedAt: observation.startedAt,
    ok: observation.ok,
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(observation.fallback === undefined ? {} : { fallback: observation.fallback }),
    ...(observation.requestId === undefined ? {} : { requestId: observation.requestId }),
    ...(observation.parentRequestId === undefined
      ? {}
      : { parentRequestId: observation.parentRequestId }),
    deadlineExceeded: deadlineExceeded(deadline),
    ...(deadline === undefined ? {} : { deadlineRemainingMs: deadline.remainingMs() }),
    ...(observation.cacheLayer === undefined ? {} : { cacheLayer: observation.cacheLayer }),
    // Queueing is part of the critical path, so it is inside `totalMs` by
    // construction (the span's start is captured before admission). It is
    // recorded again here only so the wait is visible as its own quantity.
    ...(queueMs === undefined ? {} : { queueMs }),
    ...(queueDepth === undefined ? {} : { queueDepth }),
  });
};
