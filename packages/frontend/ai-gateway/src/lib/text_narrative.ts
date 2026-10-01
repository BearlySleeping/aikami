// packages/frontend/ai-gateway/src/lib/text_narrative.ts
//
// The plain-narrative generation path.
//
// Its own module because "how a story reaches the player" and "how a JSON
// object is extracted" have opposite transport requirements. Narrative wants
// INCREMENTAL delivery over a bounded stream, because on the measured native
// route a buffered body meant no first-content time existed at all. Structured
// wants a WHOLE body, because the result is parsed as one value and streaming
// it changes no player-visible latency while adding a failure mode on providers
// that reject `stream:true` with a schema constraint.
//
// Both are pure functions over an explicit dependency set rather than closures
// over adapter state: that is what keeps each one readable on its own.
//
// Contract: issue #382

import type { AiChatMessage, AiModeResolution } from '@aikami/types';
import type { GatewayDeadline, GatewayPhaseLimits } from './deadline.ts';
import type { AiAttemptOutcome, AiTextGenerationResult } from './gateway_types.ts';
import { readNativeUsage } from './native_usage.ts';
import { readNativeNdjsonStream } from './ndjson.ts';
import type { ReasoningControl } from './reasoning_control.ts';
import { readChatSseStream } from './sse.ts';
import { buildBody, readJsonCompletion } from './text_body.ts';
import {
  type AttemptDraft,
  type AttemptHook,
  assertNativeOutcome,
  assertSseOutcome,
} from './text_outcome.ts';

/** Everything the narrative path needs from the adapter that owns it. */
export type PlainDeps = {
  phases: GatewayPhaseLimits;
  onEvent?: (event: string, data?: Record<string, unknown>) => void;
  nativeStreamingEnabled: boolean;
  nativeOptionsEnabled: boolean;
  getReasoningControl: (provider: string) => ReasoningControl | undefined;
  now: () => number;
  /** Posts one body with the headers window applied. */
  post: (options: {
    resolution: AiModeResolution;
    body: Record<string, unknown>;
    deadline: GatewayDeadline;
  }) => Promise<Response>;
};

export const generatePlain = async (options2: {
  resolution: AiModeResolution;
  messages: AiChatMessage[];
  deadline: GatewayDeadline;
  deps: PlainDeps;
  onChunk?: (text: string) => void;
  onAttempt?: AttemptHook;
}): Promise<AiTextGenerationResult> => {
  const { resolution, messages, deadline, deps, onChunk, onAttempt } = options2;
  const { phases, onEvent, now } = deps;
  const native = resolution.provider === 'ollama';
  const stream = native ? deps.nativeStreamingEnabled : true;

  let accumulated = '';
  let usage: AiTextGenerationResult['usage'];
  let firstContentMs: number | undefined;
  const startedAt = now();
  const attempt: AttemptDraft = {
    kind: 'narrative',
    transport: narrativeTransport({ native, stream }),
    startedAt,
  };

  const deliver = (text: string): void => {
    // First VISIBLE content. A thinking frame never reaches here, so this
    // cannot be inflated by a model that reasons before it speaks.
    firstContentMs ??= now() - startedAt;
    accumulated += text;
    onChunk?.(text);
  };

  const settle = (outcome: AiAttemptOutcome): AiTextGenerationResult => {
    onAttempt?.({
      ...attempt,
      outcome,
      totalMs: now() - startedAt,
      ...(firstContentMs === undefined ? {} : { firstContentMs }),
      ...(usage === undefined ? {} : { usage }),
      ...(attempt.doneReason === undefined ? {} : { doneReason: attempt.doneReason }),
    });
    return usage === undefined ? { text: accumulated } : { text: accumulated, usage };
  };

  const response = await postNarrative({
    resolution,
    messages,
    stream,
    deadline,
    deps,
    attempt,
    startedAt,
    onAttempt,
  });
  // `postNarrative` guarantees a body, but TypeScript cannot see that through
  // the helper, so it is narrowed here rather than asserted away.
  const body = response.body;
  if (body === null) {
    throw new Error(`No response body from provider "${resolution.provider}"`);
  }

  const recordUsage = (value: AiTextGenerationResult['usage']): void => {
    usage = value;
  };

  if (native && stream) {
    return await readStreamedNative({
      resolution,
      body,
      deadline,
      phases,
      attempt,
      onAttempt,
      now,
      deliver,
      recordUsage,
      settle,
    });
  }

  if (native) {
    return await readBufferedNative({
      response,
      attempt,
      onAttempt,
      now,
      deliver,
      recordUsage,
      settle,
    });
  }

  const sseOutcome = await readChatSseStream({
    body,
    signal: deadline.signal,
    onChunk: deliver,
    firstChunkTimeoutMs: phases.firstContentMs,
    idleTimeoutMs: phases.idleMs,
    ...(onEvent === undefined ? {} : { onEvent }),
    onUsage: (reported) => {
      usage = reported;
    },
    readWindow: (requestedMs) => deadline.phaseWindow(requestedMs),
  });
  assertSseOutcome({ outcome: sseOutcome, resolution, attempt, onAttempt, now });
  return settle(accumulated.length === 0 ? 'empty' : 'completed');
};

/**
 * The wire shape one narrative call will use.
 *
 * Named because the choice is the one thing a reader must not have to derive:
 * a `buffered-json` attempt has NO first-content measurement, and mislabelling
 * one as streamed is the exact error this whole lane exists to stop.
 */
const narrativeTransport = (options: {
  native: boolean;
  stream: boolean;
}): 'ndjson-stream' | 'buffered-json' | 'sse-stream' => {
  if (!options.native) {
    return 'sse-stream';
  }
  return options.stream ? 'ndjson-stream' : 'buffered-json';
};

/**
 * The streamed native narrative path.
 *
 * Counters live on the TERMINATING frame, and an interrupted stream's counters
 * are partial — so the outcome is asserted BEFORE the numbers are read, and the
 * same `settle` that emits the attempt event carries them.
 */
const readStreamedNative = async (options2: {
  resolution: AiModeResolution;
  body: ReadableStream<Uint8Array>;
  deadline: GatewayDeadline;
  phases: GatewayPhaseLimits;
  attempt: AttemptDraft;
  onAttempt?: AttemptHook;
  now: () => number;
  deliver: (text: string) => void;
  recordUsage: (value: AiTextGenerationResult['usage']) => void;
  settle: (outcome: AiAttemptOutcome) => AiTextGenerationResult;
}): Promise<AiTextGenerationResult> => {
  const {
    resolution,
    body,
    deadline,
    phases,
    attempt,
    onAttempt,
    now,
    deliver,
    recordUsage,
    settle,
  } = options2;
  const outcome = await readNativeNdjsonStream({
    body,
    signal: deadline.signal,
    onContent: deliver,
    readWindow: (phase) =>
      deadline.phaseWindow(phase === 'first-content' ? phases.firstContentMs : phases.idleMs),
  });
  if (outcome.report.doneReason !== undefined) {
    attempt.doneReason = outcome.report.doneReason;
  }
  assertNativeOutcome({ outcome, resolution, deadline, attempt, onAttempt, now });
  recordUsage(
    outcome.report.finalFrame === undefined
      ? undefined
      : readNativeUsage(outcome.report.finalFrame, { partial: outcome.kind !== 'completed' }),
  );
  return settle(outcome.report.narrative.length === 0 ? 'empty' : 'completed');
};

/** Dispatches the narrative request and validates that a readable body came back. */
const postNarrative = async (options2: {
  resolution: AiModeResolution;
  messages: AiChatMessage[];
  stream: boolean;
  deadline: GatewayDeadline;
  deps: PlainDeps;
  attempt: AttemptDraft;
  startedAt: number;
  onAttempt?: AttemptHook;
}): Promise<Response> => {
  const { resolution, messages, stream, deadline, deps, attempt, startedAt, onAttempt } = options2;
  const { onEvent, now, post } = deps;
  const fail = (message: string): never => {
    onEvent?.('fetch-failed', { status: 0 });
    onAttempt?.({ ...attempt, outcome: 'error', totalMs: now() - startedAt });
    throw new Error(message);
  };
  const response = await post({
    resolution,
    body: buildBody({
      resolution,
      messages,
      requestUsage: true,
      stream,
      nativeOptionsEnabled: deps.nativeOptionsEnabled,
      getReasoningControl: deps.getReasoningControl,
      ...(onEvent === undefined ? {} : { onEvent }),
    }),
    deadline,
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    onEvent?.('fetch-failed', { status: response.status });
    onAttempt?.({ ...attempt, outcome: 'error', totalMs: now() - startedAt });
    throw new Error(`Provider HTTP ${response.status}: ${errorText}`);
  }
  onEvent?.('fetch-ok', { status: response.status, stream });
  return response.body ? response : fail(`No response body from provider "${resolution.provider}"`);
};

/**
 * The buffered native narrative path.
 *
 * Kept so the before/after comparison in the #382 report could be produced on
 * ONE build rather than two — comparing two commits would also compare two
 * provider states. Never chosen by default.
 */
const readBufferedNative = async (options2: {
  response: Response;
  attempt: AttemptDraft;
  onAttempt?: AttemptHook;
  now: () => number;
  deliver: (text: string) => void;
  recordUsage: (value: AiTextGenerationResult['usage']) => void;
  settle: (outcome: AiAttemptOutcome) => AiTextGenerationResult;
}): Promise<AiTextGenerationResult> => {
  const { response, attempt, onAttempt, now, deliver, recordUsage, settle } = options2;
  const read = await readJsonCompletion(response);
  if (read.kind === 'aborted') {
    throw read.error;
  }
  if (read.kind === 'non-json') {
    onAttempt?.({ ...attempt, outcome: 'error', totalMs: now() - attempt.startedAt });
    throw new Error('Provider returned a non-JSON body on a buffered native request');
  }
  recordUsage(read.usage);
  if (read.text.length > 0) {
    deliver(read.text);
  }
  return settle(read.text.length === 0 ? 'empty' : 'completed');
};
