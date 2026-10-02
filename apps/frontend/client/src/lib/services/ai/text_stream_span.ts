// apps/frontend/client/src/lib/services/ai/text_stream_span.ts
//
// One STREAMED text call: the provider dispatch, and the span that records it.
// (issue #382)
//
// WHY THESE TWO LIVE TOGETHER, AND NOT WITH THE SERVICE
//
// They are the same decision seen from two sides. The dispatch decides which
// route, which budget and which identity the call travels with; the span
// decides what that call cost. Splitting them across a file boundary is fine;
// splitting them ACROSS each other is not, because every field the span reports
// — first-content time, character count, attempts — is something the dispatch
// observed on the way past. Keeping them adjacent is what stops a new field
// being measured at one and forgotten at the other, which is how a stream's
// first-content time went unrecorded while its total was not.
//
// THREE THINGS THIS MODULE OWNS, AND WHY EACH MATTERED
//
//   1. The ROUTE SNAPSHOT and the ABSOLUTE DEADLINE. Both were omitted from the
//      gateway call, so the adapter re-resolved the route (a settings change
//      between admission and dispatch could move the call to a different
//      connection) and installed its own shorter watchdog over the top of the
//      caller's budget. A dialogue turn with thirty seconds of its own budget
//      left was being cut at ninety.
//   2. The attempt sink. Every DISPATCHED attempt — including the ones that
//      threw — is billable, and a span that only carried attempts on success
//      under-reports every retry and every cancellation.
//   3. The SUPPRESSED/PROVIDER distinction. A stream that never reached the
//      provider is not a failed stream; it is a budget working, and the two are
//      counted separately because they call for opposite responses.

import type { TextTask } from '@aikami/constants';
import type { AiModeResolution, TextAttemptObservation } from '@aikami/types';
import type { TextChatMessage } from '$types';
import type { AiRequestDeadline } from './ai_request_deadline.ts';
import type { TextAttemptSink } from './text_attempt_projection.ts';
import type { TextAdmissionLease } from './text_request_admission.ts';
import { isDeadlineExceeded, isRequestCancellation } from './text_request_lifetime.ts';
import { recordTextCall, type TextCallObservation } from './text_telemetry_recorder.ts';

/** Provider-reported usage, or nothing. Never a locally invented figure. */
export type StreamUsage = { inputTokens: number; outputTokens: number; cachedTokens?: number };

/** The provider call, injected so this module owns no transport. */
export type StreamGatewayCall = (input: {
  messages: TextChatMessage[];
  onChunk: (text: string) => void;
  model: string | undefined;
  endpoint: string | undefined;
  task: TextTask | undefined;
  /** The caller's absolute end-to-end instant, forwarded unchanged. */
  deadlineAt: number | undefined;
  /** The route this call was admitted under, dispatched verbatim. */
  route: AiModeResolution;
  requestId: string;
  onAttempt: (event: Parameters<TextAttemptSink['record']>[0]) => void;
  signal: AbortSignal;
  onResolve: (resolution: AiModeResolution) => void;
}) => Promise<{ usage?: StreamUsage }>;

/** What the caller asks the transport for, before the transport knows anything. */
export type StreamRequest = {
  messages: TextChatMessage[];
  model: string | undefined;
  endpoint: string | undefined;
  task: TextTask | undefined;
  /** The route this call was admitted under. Not re-resolved downstream. */
  route: AiModeResolution;
  onChunk: (text: string) => void;
  /** Fires once, on the first fragment of any kind. */
  onFirstContent: () => void;
  /** Adds to the completion character count. */
  onCharacters: (count: number) => void;
};

/** The state one streaming call accumulates while it runs. */
export type StreamObservation = {
  start: number;
  startedAt: string;
  resolution: AiModeResolution | undefined;
  task: TextTask | undefined;
  /** Time to the first fragment, set once by the chunk sink. */
  ttftMs: number | undefined;
  promptChars: number;
  completionChars: number;
  deadline: AiRequestDeadline;
  lease: TextAdmissionLease | undefined;
  requestId: string;
  attempts: TextAttemptSink;
  /** Set once the gateway has resolved a route on the way to an adapter. */
  dispatched: boolean;
};

/** Dispatches one streamed call and records its span. */
export type StreamSpan = {
  /**
   * The provider call, on the route it was admitted under and inside the
   * caller's absolute budget. Reports the caller's own usage, and nothing else.
   */
  dispatch(options: {
    request: StreamRequest;
    observation: StreamObservation;
    signal: AbortSignal;
  }): Promise<StreamUsage | undefined>;
  /** Records a stream that completed. */
  recordSuccess(observation: StreamObservation, usage: StreamUsage | undefined): void;
  /** Records a stream that failed. */
  recordFailure(observation: StreamObservation, error: unknown): void;
};

/**
 * Drops the keys whose value is `undefined`.
 *
 * A named helper rather than a dozen `...(x === undefined ? {} : { x })`
 * spreads: the span is a plain record that is serialised and diffed, so an
 * absent key and an explicit `undefined` are the same thing there, and the
 * object is built once with whatever is actually known.
 */
const optional = <T extends object>(fields: T): Partial<T> => {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      out[key as keyof T] = value as T[keyof T];
    }
  }
  return out;
};

/**
 * The fields every stream span carries, whatever the outcome.
 *
 * One builder rather than two literals: the shapes differ in four fields, and
 * spelling out the other twenty each time is how a field ends up recorded on
 * the success path and missing from the failure one.
 */
const base = (observation: StreamObservation): Omit<TextCallObservation, 'ok' | 'error'> => ({
  start: observation.start,
  startedAt: observation.startedAt,
  resolution: observation.resolution,
  streamed: true,
  ttftMs: observation.ttftMs,
  promptChars: observation.promptChars,
  completionChars: observation.completionChars,
  deadline: observation.deadline,
  requestId: observation.requestId,
  ...optional({ task: observation.task }),
  // Interactive work is admitted immediately, so a zero here is a real
  // measurement rather than an absence, which is what makes `queueMs > 0` mean
  // something. A stream that never reached admission carries no value at all.
  ...optional(
    observation.lease === undefined
      ? {}
      : { queueMs: observation.lease.queueMs, queueDepth: observation.lease.queueDepth },
  ),
});

/** The attempts a span should carry, or nothing when none were dispatched. */
const recordedAttempts = (
  attempts: TextAttemptSink,
): { attempts?: readonly TextAttemptObservation[] } =>
  attempts.attempts.length === 0 ? {} : { attempts: attempts.snapshot() };

/**
 * Whether a failed stream should be SWALLOWED rather than rethrown.
 *
 * A cancellation the user asked for is not an error and is not reported as
 * one. A budget that ran out is a timeout the caller must hear about, and it
 * arrives on the same signal — the two are separated here, once, rather than at
 * every call site that has to make the same distinction.
 */
export const isSwallowedStreamFailure = (error: unknown, deadline: AiRequestDeadline): boolean =>
  isRequestCancellation(error) && !isDeadlineExceeded(deadline);

export const createStreamSpan = (options: {
  generate: StreamGatewayCall;
  /** Publishes a resolved route to the diagnostics surface. */
  exposeRouting: (resolution: AiModeResolution) => void;
}): StreamSpan => {
  const { generate, exposeRouting } = options;

  return {
    async dispatch({
      request,
      observation,
      signal,
    }: {
      request: StreamRequest;
      observation: StreamObservation;
      signal: AbortSignal;
    }): Promise<StreamUsage | undefined> {
      const { deadline, attempts } = observation;
      const result = await generate({
        messages: request.messages,
        onChunk: (chunk) => {
          request.onFirstContent();
          request.onCharacters(chunk.length);
          request.onChunk(chunk);
        },
        model: request.model,
        endpoint: request.endpoint,
        task: request.task,
        // ONE clock, carried as an absolute instant. A DURATION here would be a
        // budget the transport has to restart, and restarting it is what put a
        // 90 s watchdog on top of a 120 s dialogue turn.
        deadlineAt: Number.isFinite(deadline.deadlineAt) ? deadline.deadlineAt : undefined,
        // The route this call was admitted against, dispatched verbatim.
        route: request.route,
        requestId: observation.requestId,
        onAttempt: attempts.record,
        signal: AbortSignal.any([signal, deadline.signal]),
        onResolve: (resolved) => {
          observation.resolution = resolved;
          exposeRouting(resolved);
        },
      });
      return result.usage;
    },

    recordSuccess(observation: StreamObservation, usage: StreamUsage | undefined): void {
      recordTextCall({
        ...base(observation),
        ok: true,
        dispatch: 'provider',
        ...recordedAttempts(observation.attempts),
        ...optional(usage === undefined ? {} : { usage }),
      });
    },

    recordFailure(observation: StreamObservation, error: unknown): void {
      recordTextCall({
        ...base(observation),
        ok: false,
        error,
        // A stream that never reached the provider is SUPPRESSED work, not a
        // failure: one is a budget working, the other is something breaking,
        // and they call for opposite responses.
        dispatch:
          observation.dispatched || observation.attempts.attempts.length > 0
            ? 'provider'
            : 'suppressed',
        ...recordedAttempts(observation.attempts),
      });
    },
  };
};
