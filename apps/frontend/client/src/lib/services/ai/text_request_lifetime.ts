// apps/frontend/client/src/lib/services/ai/text_request_lifetime.ts
//
// The LIFETIME of one logical text request: when it starts, when it must stop,
// and how a caller cancels it.
//
// These three questions were answered inside `TextGenerationService`, which
// made the service the only place in the client that could construct a deadline
// or classify a cancellation. That is a poor fit: the deadline module owns the
// concept, the gateway owns the error vocabulary, and a second caller that
// needed a deadline would have had to reimplement the rules — including the one
// that matters most here, that a budget is ADOPTED rather than re-minted.
//
// Extracted so the rules are stated once and can be tested without a service,
// a gateway or a network.
//
// Contract: issue #382 P0 ("one deadline covers each logical request"), #382
// admission ("queueing draws down the same clock").

import { type TextTask, textTaskBudgetMs } from '@aikami/constants';
import { isAiGatewayError } from '@aikami/frontend/ai-gateway';
import {
  type AiRequestDeadline,
  createAiRequestDeadline,
  createUnboundedAiDeadline,
} from './ai_request_deadline.ts';

/**
 * Builds the ONE deadline for a logical request.
 *
 * A caller-supplied `deadlineAt` is adopted VERBATIM, so a combat turn's or a
 * dialogue turn's budget is not silently replaced by a task default — the
 * caller may already have spent part of it. Otherwise the task preset's budget
 * applies, and a task with no budget is deliberately unbounded: background
 * work's deadline is the campaign, not a stopwatch.
 *
 * Admission does NOT appear here, and must not. Admission queues within this
 * clock rather than minting a second one — a request that waited five seconds
 * in a queue has five fewer seconds of budget, which is the entire point of
 * #382 defining the critical path as including queue time.
 */
export const createRequestDeadline = (options: {
  deadlineAt?: number;
  task?: TextTask;
  signal?: AbortSignal;
}): AiRequestDeadline => {
  if (options.deadlineAt !== undefined) {
    const startedAt = Date.now();
    return createAiRequestDeadline({
      startedAt,
      hardDeadlineMs: Math.max(0, options.deadlineAt - startedAt),
      ...(options.signal === undefined ? {} : { callerSignal: options.signal }),
    });
  }
  const budgetMs = textTaskBudgetMs(options.task);
  if (budgetMs === undefined) {
    return createUnboundedAiDeadline(options.signal);
  }
  return createAiRequestDeadline({
    hardDeadlineMs: budgetMs,
    ...(options.signal === undefined ? {} : { callerSignal: options.signal }),
  });
};

/**
 * Whether a request ended because its budget ran out, rather than because
 * someone cancelled it.
 *
 * Recognized even before the deadline timer has had a turn to fire: a caller
 * can hand down a deadline that is already in the past, and then the abort
 * reason is never set — leaving a genuine timeout indistinguishable from a
 * cancellation the user asked for. Those two degrade differently and are
 * counted differently, so conflating them is not a cosmetic bug.
 */
export const isDeadlineExceeded = (deadline?: AiRequestDeadline): boolean =>
  deadline?.stopReason() === 'deadline' ||
  (deadline?.stopReason() !== 'caller-abort' && deadline?.expired() === true);

/**
 * Whether an error represents cancellation, rather than failure.
 *
 * Two spellings, because two layers produce it: a raw `AbortError` from
 * `AbortController`, and a typed `AiGatewayException` carrying the code
 * `'cancelled'`. Callers act on them differently — a cancellation is not
 * logged as an error and not reported to the player as a failure.
 */
export const isRequestCancellation = (error: unknown): boolean => {
  if (isAiGatewayError(error)) {
    return error.code === 'cancelled';
  }
  return (error as Error)?.name === 'AbortError';
};

/**
 * Rethrows a pre-aborted caller's cancellation reason.
 *
 * A call whose signal is already aborted must not reach routing, the admission
 * gate, the local engine or the provider at all — and it must not report a
 * timeout, because nobody waited.
 */
export const throwIfAlreadyAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted !== true) {
    return;
  }
  if (signal.reason !== undefined) {
    throw signal.reason;
  }
  const error = new Error('Aborted');
  error.name = 'AbortError';
  throw error;
};

/**
 * Throws when a shared deadline has already run out.
 *
 * Distinct from a caller abort: an exhausted budget must not buy a provider
 * call, and it must be reported as a timeout rather than a cancellation.
 */
export const throwIfPastDeadline = (deadline: AiRequestDeadline): void => {
  if (deadline.expired()) {
    throw new DOMException('Request deadline exceeded', 'AbortError');
  }
};
