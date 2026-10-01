// packages/frontend/ai-gateway/src/lib/text_outcome.ts
//
// Turning a transport result into a typed gateway error — or into success.
//
// Split out of `text_adapter_openai_compatible.ts` because the DECISION here is
// the interesting part and it was buried in the middle of request dispatch.
//
// The decision this module exists to get right: a generation either COMPLETED
// or it did not, and every way of not completing is a different fact with a
// different response. Conflating them is how a half-sentence reaches a player
// as a finished reply, and how a user navigating away is reported as a slow
// provider.
//
//   completed          the provider sent its own completion signal
//   closed / truncated the socket ended first — the content is partial
//   first_content      nothing visible arrived inside the headers window
//   idle               the stream stalled after content had been flowing
//   total_budget       the caller's end-to-end budget is gone
//   cancelled          the user (or `cancelAll`) stopped waiting
//
// Text already delivered through `onChunk` cannot be recalled — streaming is
// streaming — but the CALL fails, so no caller can record an interrupted
// generation as a finished one.

import type { AiModeResolution } from '@aikami/types';
import { describeTimeout, type GatewayDeadline, type GatewayTimeoutKind } from './deadline.ts';
import { createAiGatewayError } from './errors.ts';
import type { AiAttemptOutcome, AiTextUsage, AiTransportShape } from './gateway_types.ts';
import type { NativeStreamOutcome } from './ndjson.ts';
import type { ChatSseOutcome } from './sse.ts';

/** The attempt fields the adapter builds up before it knows the outcome. */
export type AttemptDraft = {
  kind: 'narrative' | 'structured';
  transport: AiTransportShape;
  startedAt: number;
  doneReason?: string;
};

/** What an adapter reports, before the gateway stamps identity onto it. */
export type AttemptFacts = {
  kind: 'narrative' | 'structured';
  transport: AiTransportShape;
  startedAt: number;
  outcome?: AiAttemptOutcome;
  firstContentMs?: number;
  totalMs?: number;
  usage?: AiTextUsage;
  doneReason?: string;
  truncated?: boolean;
};

/** Hook the adapter calls once per settled attempt. */
export type AttemptHook = (event: AttemptFacts) => void;

/** The typed cancellation every abort path raises. */
export const cancelledError = (resolution: AiModeResolution): Error =>
  createAiGatewayError({
    code: 'cancelled',
    capability: 'text',
    mode: resolution.mode,
    provider: resolution.provider,
    message: 'Aborted',
  });

/**
 * The failure raised when a phase watchdog or the total budget fires.
 *
 * The normalized vocabulary has a single `timeout` code, so the KIND travels in
 * a field and in the message. A caller has to be able to tell "my budget is
 * gone" (degrade now, do not retry) from "the provider went quiet" (the budget
 * may still have room) from "the user left" (not a fault at all), and a single
 * undifferentiated code cannot carry that.
 */
export const timeoutError = (options: {
  kind: GatewayTimeoutKind;
  resolution: AiModeResolution;
  elapsedMs?: number;
}): Error =>
  createAiGatewayError({
    code: 'timeout',
    capability: 'text',
    mode: options.resolution.mode,
    provider: options.resolution.provider,
    timeoutKind: options.kind,
    message: describeTimeout({
      kind: options.kind,
      mode: options.resolution.mode,
      provider: options.resolution.provider,
      ...(options.elapsedMs === undefined ? {} : { elapsedMs: options.elapsedMs }),
    }),
  });

/** A signal that fires when EITHER input fires. */
export const abortOnEither = (a: AbortSignal, b: AbortSignal): AbortSignal => {
  if (a.aborted) {
    return a;
  }
  if (b.aborted) {
    return b;
  }
  const controller = new AbortController();
  const onA = (): void => {
    controller.abort(a.reason);
  };
  const onB = (): void => {
    controller.abort(b.reason);
  };
  a.addEventListener('abort', onA, { once: true });
  b.addEventListener('abort', onB, { once: true });
  return controller.signal;
};

/**
 * Classifies a fetch rejection against the shared deadline.
 *
 * An aborted HTTP request is NOT evidence that the provider stopped working —
 * the runtime may still be generating behind the socket, and on a local one it
 * usually is. It is only evidence that THIS client stopped waiting, so it is
 * reported as what it is rather than as a provider fault.
 */
export const classifyFetchRejection = (options: {
  error: unknown;
  resolution: AiModeResolution;
  deadline: GatewayDeadline;
  phase: { endedBy: () => 'phase' | 'total_budget' | undefined };
}): unknown => {
  const { error, resolution, deadline, phase } = options;
  if (deadline.stopReason() === 'caller-abort') {
    return cancelledError(resolution);
  }
  if (deadline.stopReason() === 'total_budget' || phase.endedBy() === 'total_budget') {
    return timeoutError({ kind: 'total_budget', resolution });
  }
  if (phase.endedBy() === 'phase') {
    // Headers never arrived, so no visible content ever could.
    return timeoutError({ kind: 'first_content', resolution });
  }
  return error;
};

/** Reports an interrupted attempt before its call fails. */
const reportInterrupted = (options: {
  attempt: AttemptDraft;
  onAttempt: AttemptHook | undefined;
  now: () => number;
}): void => {
  options.onAttempt?.({
    ...options.attempt,
    outcome: 'error',
    totalMs: options.now() - options.attempt.startedAt,
    truncated: true,
  });
};

/** A stream that ended without the provider's completion signal. */
const truncatedError = (resolution: AiModeResolution, message: string): Error =>
  createAiGatewayError({
    code: 'invalid_response',
    capability: 'text',
    mode: resolution.mode,
    provider: resolution.provider,
    message,
  });

/** Every native-stream kind, and what it means for the call. */
const NATIVE_DISPOSITIONS: Record<
  NativeStreamOutcome['kind'],
  (options: {
    outcome: Extract<NativeStreamOutcome, { kind: NativeStreamOutcome['kind'] }>;
    resolution: AiModeResolution;
    deadline: GatewayDeadline;
    attempt: AttemptDraft;
    onAttempt?: AttemptHook;
    now: () => number;
  }) => void
> = {
  completed: () => {},
  // A malformed line was recorded and skipped; the stream still completed.
  'malformed-lines': () => {},
  aborted: ({ resolution, deadline }) => {
    throw deadline.stopReason() === 'caller-abort'
      ? cancelledError(resolution)
      : timeoutError({ kind: 'total_budget', resolution });
  },
  'first-content-timeout': ({ resolution }) => {
    throw timeoutError({ kind: 'first_content', resolution });
  },
  'idle-timeout': ({ resolution }) => {
    throw timeoutError({ kind: 'idle', resolution });
  },
  'provider-error': ({ outcome }) => {
    if (outcome.kind !== 'provider-error') {
      return;
    }
    throw new Error(`Provider error frame: ${outcome.message}`);
  },
  truncated: ({ resolution, attempt, onAttempt, now }) => {
    reportInterrupted({ attempt, onAttempt, now });
    throw truncatedError(resolution, 'Stream ended before the provider signalled completion');
  },
  'buffer-overflow': ({ resolution }) => {
    throw truncatedError(resolution, 'Native stream exceeded its bounded buffer');
  },
};

/** Every SSE kind, and what it means for the call. */
const SSE_DISPOSITIONS: Record<
  ChatSseOutcome['kind'],
  (options: {
    outcome: ChatSseOutcome;
    resolution: AiModeResolution;
    attempt: AttemptDraft;
    onAttempt?: AttemptHook;
    now: () => number;
  }) => void
> = {
  completed: () => {},
  aborted: ({ resolution }) => {
    throw cancelledError(resolution);
  },
  'first-chunk-timeout': ({ resolution }) => {
    throw timeoutError({ kind: 'first_content', resolution });
  },
  'idle-timeout': ({ resolution }) => {
    throw timeoutError({ kind: 'idle', resolution });
  },
  'closed-early': ({ resolution, attempt, onAttempt, now }) => {
    reportInterrupted({ attempt, onAttempt, now });
    throw truncatedError(resolution, 'Stream closed before the provider signalled completion');
  },
  'callback-failed': ({ outcome }) => {
    // A consumer bug, surfaced as itself. Reporting it as a protocol fault
    // would send the reader looking in the wrong place.
    throw outcome.error;
  },
};

/**
 * Throws unless the native stream reached its completion signal.
 *
 * The partial-content policy lives here and is deliberately one-directional: a
 * stream that ended by abort, watchdog or a missing completion frame is a
 * FAILURE.
 */
export const assertNativeOutcome = (options: {
  outcome: NativeStreamOutcome;
  resolution: AiModeResolution;
  deadline: GatewayDeadline;
  attempt: AttemptDraft;
  onAttempt?: AttemptHook;
  now: () => number;
}): void => {
  NATIVE_DISPOSITIONS[options.outcome.kind](options as never);
};

/** The same completion policy, applied to the OpenAI-compatible SSE route. */
export const assertSseOutcome = (options: {
  outcome: ChatSseOutcome;
  resolution: AiModeResolution;
  attempt: AttemptDraft;
  onAttempt?: AttemptHook;
  now: () => number;
}): void => {
  SSE_DISPOSITIONS[options.outcome.kind](options);
};
