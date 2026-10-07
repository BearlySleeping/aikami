// packages/frontend/ai-gateway/src/lib/ndjson.ts
//
// Bounded reader for Ollama's NATIVE newline-delimited JSON stream.
//
// The native `/api/chat` route is not SSE. `stream:true` returns one JSON object
// per LINE, with no `data:` prefix and no `[DONE]` sentinel; the last line
// carries `done:true`. Measured on Ollama 0.34.3 (see
// `docs/audits/382-native-transport-plan.md`): 312 frames for a 146-character
// answer, headers at 94 ms and first *visible* content at 5 616 ms — because
// the first frames are `{"message":{"role":"assistant","content":"","thinking":"…"}}`.
//
// Three properties this reader exists to guarantee, each of which a naive
// `text.split('\n')` gets wrong:
//
//   1. ONLY `message.content` is delivered. `message.thinking` is a different
//      channel on the same surface. Leaking it would put a model's private
//      reasoning in front of a player; counting it would make a 5.6 s wait
//      look like a 94 ms one. Thinking frames are observed, counted, and
//      discarded — never delivered, never timed as visible content.
//   2. The buffer is BOUNDED. A provider that never emits a newline must not be
//      able to grow the reader's buffer without limit; the reader fails closed
//      with a named error instead.
//   3. EOF before a `done` frame is a PROTOCOL failure, distinct from a clean
//      completion. A truncated stream that is reported as success is how a
//      half-sentence reaches a player as a finished reply.

/** Default cap on unterminated buffered bytes, per stream. */
export const NDJSON_MAX_BUFFER_BYTES = 1_048_576;

/** How a native stream ended. Every non-`completed` value is a FAILURE. */
export type NativeStreamOutcome =
  | { kind: 'completed'; report: NativeStreamReport }
  /** The stream carried an `error` field. */
  | { kind: 'provider-error'; message: string; report: NativeStreamReport }
  /** The socket closed before a `done` frame arrived. */
  | { kind: 'truncated'; report: NativeStreamReport }
  /** No visible content arrived inside the first-content window. */
  | { kind: 'first-content-timeout'; report: NativeStreamReport }
  /** The stream stalled after visible content had started flowing. */
  | { kind: 'idle-timeout'; report: NativeStreamReport }
  /** A line that was not valid JSON. Recorded, not fatal. */
  | { kind: 'malformed-lines'; report: NativeStreamReport }
  /** The unterminated buffer exceeded its cap. */
  | { kind: 'buffer-overflow'; report: NativeStreamReport }
  /** The read was aborted. */
  | { kind: 'aborted'; reason?: unknown; report: NativeStreamReport };

/** What the reader observed about a native stream. */
export type NativeStreamReport = {
  /** Non-empty `message.content` fragments, in order. */
  readonly narrative: string;
  /** Total characters seen in `message.thinking`. Never delivered. */
  readonly thinkingChars: number;
  /** Frames received, including thinking-only and empty ones. */
  readonly frameCount: number;
  /** Frames whose `message.content` was a non-empty string. */
  readonly contentFrameCount: number;
  /** `done_reason` from the terminating frame, when it carried one. */
  readonly doneReason?: string;
  /**
   * The terminating frame, raw.
   *
   * The reader deliberately does NOT interpret accounting counters: token
   * semantics belong to `native_usage.ts`, and a reader that also priced tokens
   * would make the two drift apart. The adapter reads counters off this frame.
   */
  readonly finalFrame?: Record<string, unknown>;
};

/** Which read window the reader is currently inside. */
export type NativeReadPhase = 'first-content' | 'idle';

export type ReadNativeNdjsonOptions = {
  body: ReadableStream<Uint8Array>;
  signal: AbortSignal;
  /** Receives each non-empty `message.content` fragment exactly once. */
  onContent?: (text: string) => void;
  /** Receives each non-empty `message.thinking` fragment. For diagnostics only. */
  onThinking?: (text: string) => void;
  maxBufferBytes?: number;
  /**
   * Derives the signal bounding ONE read, so the caller's shared deadline and
   * the phase watchdog both apply.
   *
   * The phase is chosen by the READER, not the caller, because the distinction
   * carries the meaning: `first-content` is a wait for the model to start
   * talking, while `idle` is a wait for a stream that was already talking to
   * continue. A reasoning model may emit nothing visible for seconds while it
   * thinks, so the idle window is not applied before visible content exists.
   *
   * When absent, the reader has no liveness guard of its own and relies purely
   * on `signal`.
   */
  readWindow?: (phase: NativeReadPhase) => { signal: AbortSignal; dispose: () => void };
};

// ---------------------------------------------------------------------------
// Frame accumulation
// ---------------------------------------------------------------------------

/** One decoded frame, plus what the reader learned from it. */
type FrameOutcome = {
  /** The line parsed to a JSON object (a non-object or invalid line does not). */
  readonly record?: Record<string, unknown>;
  /** The line was blank, non-JSON, or not an object. */
  readonly malformed: boolean;
  /** The frame carried an `error` string. */
  readonly error?: string;
  /** Non-empty `message.content`. */
  readonly content: string;
  /** Non-empty `message.thinking`. */
  readonly thinking: string;
  /** The frame was the terminating one. */
  readonly done: boolean;
  /** `done_reason`, when the terminating frame carried one. */
  readonly doneReason?: string;
};

/** Parses one line into a {@link FrameOutcome}. Never throws. */
export const parseNativeFrame = (line: string): FrameOutcome => {
  const blank: FrameOutcome = { malformed: false, content: '', thinking: '', done: false };
  if (line.trim().length === 0) {
    return blank;
  }
  const record = tryParseObject(line);
  if (record === undefined) {
    // A malformed line is recorded and skipped. One bad frame must not discard
    // the narrative frames around it, and it must not be reported as a parse
    // failure of anything else.
    return { ...blank, malformed: true };
  }
  const message = record.message as { content?: unknown; thinking?: unknown } | undefined;
  const content = typeof message?.content === 'string' ? message.content : '';
  const thinking = typeof message?.thinking === 'string' ? message.thinking : '';
  const done = record.done === true;
  return {
    record,
    malformed: false,
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
    content,
    thinking,
    done,
    ...(done && typeof record.done_reason === 'string' ? { doneReason: record.done_reason } : {}),
  };
};

/** `JSON.parse` narrowed to a plain object, or `undefined`. */
const tryParseObject = (line: string): Record<string, unknown> | undefined => {
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

/**
 * Accumulates frames into the running report.
 *
 * A class rather than a closure so the counter bookkeeping has one owner and
 * the read loop stays a loop.
 */
class NativeFrameAccumulator {
  private _narrative = '';
  private _thinkingChars = 0;
  private _frameCount = 0;
  private _contentFrameCount = 0;
  private _malformedLines = 0;
  private _sawDone = false;
  private _doneReason: string | undefined;
  private _finalFrame: Record<string, unknown> | undefined;
  private _providerError: string | undefined;

  constructor(
    private readonly _onContent: ((text: string) => void) | undefined,
    private readonly _onThinking: ((text: string) => void) | undefined,
  ) {}

  get hasVisibleContent(): boolean {
    return this._contentFrameCount > 0;
  }

  get sawDone(): boolean {
    return this._sawDone;
  }

  get malformedLines(): number {
    return this._malformedLines;
  }

  get providerError(): string | undefined {
    return this._providerError;
  }

  get report(): NativeStreamReport {
    return {
      narrative: this._narrative,
      thinkingChars: this._thinkingChars,
      frameCount: this._frameCount,
      contentFrameCount: this._contentFrameCount,
      ...(this._doneReason === undefined ? {} : { doneReason: this._doneReason }),
      ...(this._finalFrame === undefined ? {} : { finalFrame: this._finalFrame }),
    };
  }

  /**
   * Folds one line in. Returns `true` when it was the terminating frame, which
   * ends the read loop.
   */
  accept(line: string): boolean {
    if (line.trim().length === 0) {
      return false;
    }
    this._frameCount += 1;
    const frame = parseNativeFrame(line);
    if (frame.malformed) {
      this._malformedLines += 1;
      return false;
    }
    this._providerError ??= frame.error;
    // Thinking is measured, then dropped. It is never delivered and never
    // contributes to first-visible-content timing.
    if (frame.thinking.length > 0) {
      this._thinkingChars += frame.thinking.length;
      this._onThinking?.(frame.thinking);
    }
    if (frame.content.length > 0) {
      this._narrative += frame.content;
      this._contentFrameCount += 1;
      this._onContent?.(frame.content);
    }
    if (!frame.done || frame.record === undefined) {
      return false;
    }
    this._sawDone = true;
    this._doneReason = frame.doneReason;
    this._finalFrame = frame.record;
    return true;
  }
}

// ---------------------------------------------------------------------------
// Bounded reads
// ---------------------------------------------------------------------------

/** The result of one bounded read. */
type WindowedRead =
  | { kind: 'chunk'; value: Uint8Array }
  | { kind: 'closed' }
  | { kind: 'window-expired' };

/** Normalizes a raw `ReadableStreamReadResult`. */
const toWindowedRead = (result: { done: boolean; value?: Uint8Array }): WindowedRead =>
  result.done || result.value === undefined
    ? { kind: 'closed' }
    : { kind: 'chunk', value: result.value };

/**
 * Reads once, optionally bounded by a caller-supplied window.
 *
 * RACED, not cancelled. Cancelling the reader when the window expires makes
 * the pending `read()` resolve with `done: true`, which the caller would then
 * report as EOF — so a stalled stream would be recorded as a truncated one and
 * the two would be indistinguishable. Racing leaves the socket alone; it is
 * released once, at the end of the read, with the real reason intact.
 */
const readChunkWithin = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  window: { signal: AbortSignal; dispose: () => void } | undefined,
): Promise<WindowedRead> => {
  if (window === undefined) {
    return toWindowedRead(await reader.read());
  }
  let unlisten: (() => void) | undefined;
  const expired = new Promise<'expired'>((resolve) => {
    if (window.signal.aborted) {
      resolve('expired');
      return;
    }
    const onAbort = (): void => {
      resolve('expired');
    };
    window.signal.addEventListener('abort', onAbort, { once: true });
    unlisten = () => {
      window.signal.removeEventListener('abort', onAbort);
    };
  });
  try {
    const raced = await Promise.race([reader.read(), expired]);
    return raced === 'expired' ? { kind: 'window-expired' } : toWindowedRead(raced);
  } finally {
    unlisten?.();
    window.dispose();
  }
};

/**
 * Whether the read must stop for a reason other than a completed line.
 *
 * Buffer overrun is checked before the abort so an unbounded provider cannot
 * make the reader spin; both produce a NAMED outcome, because "we gave up
 * waiting" and "the provider filled our memory" are different facts.
 */
const overrun = (state: { buffer: string }, signal: AbortSignal, maxBufferBytes: number): boolean =>
  state.buffer.length > maxBufferBytes || signal.aborted;

/** The named outcome matching {@link overrun}. */
const overrunOutcome = (
  accumulator: NativeFrameAccumulator,
  state: { buffer: string },
  signal: AbortSignal,
  maxBufferBytes: number,
): NativeStreamOutcome =>
  state.buffer.length > maxBufferBytes
    ? { kind: 'buffer-overflow', report: accumulator.report }
    : { kind: 'aborted', reason: signal.reason, report: accumulator.report };

/** Drains every complete line the buffer holds. Returns `true` on `done`. */
const drainLines = (accumulator: NativeFrameAccumulator, state: { buffer: string }): boolean => {
  let newlineAt = state.buffer.indexOf('\n');
  while (newlineAt >= 0) {
    const line = state.buffer.slice(0, newlineAt);
    state.buffer = state.buffer.slice(newlineAt + 1);
    if (accumulator.accept(line)) {
      return true;
    }
    newlineAt = state.buffer.indexOf('\n');
  }
  return false;
};

/**
 * Resolves a finished stream into its outcome.
 *
 * Split out so the read loop has no branching of its own: the ordering matters
 * and reads better as a named decision. An error frame is checked BEFORE
 * truncation because Ollama's error frames routinely omit `done`, and calling
 * one a broken connection would send the caller down the wrong path.
 */
const resolveOutcome = (accumulator: NativeFrameAccumulator): NativeStreamOutcome => {
  if (!accumulator.sawDone) {
    return accumulator.providerError === undefined
      ? { kind: 'truncated', report: accumulator.report }
      : { kind: 'provider-error', message: accumulator.providerError, report: accumulator.report };
  }
  if (accumulator.providerError !== undefined) {
    return {
      kind: 'provider-error',
      message: accumulator.providerError,
      report: accumulator.report,
    };
  }
  if (accumulator.malformedLines > 0) {
    return { kind: 'malformed-lines', report: accumulator.report };
  }
  return { kind: 'completed', report: accumulator.report };
};

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

/**
 * Pumps a native stream to its `done` frame.
 *
 * Owns the read loop so the reader above is only preamble and teardown. Every
 * exit from the loop is a NAMED outcome — there is no fallthrough and no way to
 * mistake an interruption for a completion.
 */
const pumpNativeStream = async (options: {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  decoder: TextDecoder;
  accumulator: NativeFrameAccumulator;
  state: { buffer: string };
  signal: AbortSignal;
  maxBufferBytes: number;
  readWindow?: ReadNativeNdjsonOptions['readWindow'];
}): Promise<NativeStreamOutcome> => {
  const { reader, decoder, accumulator, state, signal, maxBufferBytes, readWindow } = options;
  for (;;) {
    const read = await readChunkWithin(
      reader,
      readWindow?.(accumulator.hasVisibleContent ? 'idle' : 'first-content'),
    );
    if (read.kind === 'window-expired') {
      return {
        kind: accumulator.hasVisibleContent ? 'idle-timeout' : 'first-content-timeout',
        report: accumulator.report,
      };
    }
    if (read.kind === 'closed') {
      return finishStream(accumulator, state);
    }
    state.buffer += decoder.decode(read.value, { stream: true });
    if (drainLines(accumulator, state)) {
      return resolveOutcome(accumulator);
    }
    if (overrun(state, signal, maxBufferBytes)) {
      return overrunOutcome(accumulator, state, signal, maxBufferBytes);
    }
  }
};

/**
 * A stream that ends on a line boundary with no trailing newline still has a
 * final record — dropping it would lose the `done` frame and the accounting
 * that usually rides on it.
 */
const finishStream = (
  accumulator: NativeFrameAccumulator,
  state: { buffer: string },
): NativeStreamOutcome => {
  if (state.buffer.length > 0) {
    accumulator.accept(state.buffer);
    state.buffer = '';
  }
  return resolveOutcome(accumulator);
};

/**
 * Reads Ollama's native NDJSON chat stream to its `done` frame.
 *
 * Never throws for a protocol problem: a malformed line, a truncated stream and
 * a provider `error` frame are all OUTCOMES, because the caller has to be able
 * to tell "the provider said no" from "the connection broke" from "we gave up
 * waiting", and a thrown `Error` flattens all three into one.
 */
export const readNativeNdjsonStream = async (
  options: ReadNativeNdjsonOptions,
): Promise<NativeStreamOutcome> => {
  const { body, signal, onContent, onThinking, maxBufferBytes = NDJSON_MAX_BUFFER_BYTES } = options;
  const reader = body.getReader();
  const accumulator = new NativeFrameAccumulator(onContent, onThinking);
  const aborted = (): NativeStreamOutcome => ({
    kind: 'aborted',
    reason: signal.reason,
    report: accumulator.report,
  });

  try {
    return signal.aborted
      ? aborted()
      : await pumpNativeStream({
          reader,
          decoder: new TextDecoder(),
          accumulator,
          state: { buffer: '' },
          signal,
          maxBufferBytes,
          ...(options.readWindow === undefined ? {} : { readWindow: options.readWindow }),
        });
  } catch (error) {
    if (signal.aborted) {
      return aborted();
    }
    throw error;
  } finally {
    // Cancelling the reader, not just releasing the lock: a reader still holding
    // the underlying socket keeps the connection — and the generation behind it
    // — alive past the request.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
};
