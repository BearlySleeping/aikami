// packages/frontend/ai-gateway/src/lib/sse.ts
//
// Chat-completions SSE stream reader.
//
// The reader's job is not "get the text out". It is to make the difference
// between a COMPLETED generation and an INTERRUPTED one visible, and to release
// every resource it took. Four defects existed at the reviewed baseline
// (issue #382):
//
//   - LOSING TIMERS SURVIVED. Every read raced a `setTimeout` whose rejection
//     was thrown away the moment a chunk won the race. A 30 000-chunk stream
//     left 30 000 live timers holding the process's timer heap.
//   - THE READER WAS NEVER CANCELLED. `releaseLock()` drops the lock; it does
//     not close the socket. An aborted stream kept the provider connection and
//     the generation behind it alive past the caller's deadline.
//   - A STREAM THAT ENDED BY TIMEOUT OR ABORT LOOKED LIKE SUCCESS. A partial
//     answer could be reported as a finished one.
//   - A THROWING `onChunk` WAS REPORTED AS A MALFORMED LINE. The callback and
//     `JSON.parse` shared one `try`, so a consumer bug was diagnosed as a
//     provider protocol fault — and swallowed, so the call continued producing
//     text nobody was listening to.
//
// The completion policy is now explicit and one-directional: this module
// RESOLVES for protocol completion and returns a discriminated outcome for
// everything else. Partial content that already arrived has necessarily been
// delivered through `onChunk` — streaming is streaming — but the CALL fails, so
// no caller can mistake an interrupted generation for a finished one.

import type { AiTextUsage } from './gateway_types.ts';
import { readOpenAiUsage } from './structured.ts';

/**
 * Finite safety limit for a caller that supplies NO deadline.
 *
 * A watchdog, not a logical budget — see `deadline.ts`. Kept at the historical
 * value rather than raised, because a caller with a real budget now passes it.
 */
export const GATEWAY_FETCH_TIMEOUT_MS = 90_000;

/**
 * Headers / first-chunk watchdog.
 *
 * INTENTIONALLY shorter than the total. It is a liveness guard, not a response
 * to a slow generation, and raising it is never the fix for a slow model.
 */
export const GATEWAY_FIRST_CHUNK_TIMEOUT_MS = 15_000;

/**
 * Inter-chunk watchdog, applied only after content has started flowing.
 *
 * Short on purpose: once tokens are moving, a long silence means the stream
 * broke rather than that the model is thinking. It does NOT apply before the
 * first visible chunk — a reasoning model may emit nothing visible for seconds
 * while it thinks, and treating that as a stall would kill correct generations.
 */
export const GATEWAY_IDLE_TIMEOUT_MS = 5_000;

/** How a chat-completions SSE stream ended. */
export type ChatSseOutcome = {
  readonly kind:
    | 'completed'
    | 'closed-early'
    | 'first-chunk-timeout'
    | 'idle-timeout'
    | 'aborted'
    | 'callback-failed';
  /** Visible content characters delivered before the stream ended. */
  readonly contentChars: number;
  /** Content-bearing frames delivered before the stream ended. */
  readonly chunkCount: number;
  /** Provider accounting, when a frame carried it. */
  readonly usage?: AiTextUsage;
  /** Abort reason, when the stream ended because a signal fired. */
  readonly reason?: unknown;
  /** The consumer error, when the stream ended because a callback threw. */
  readonly error?: unknown;
};

/** What `consumeLines` decided about a batch of decoded lines. */
type LineVerdict = 'continue' | 'done' | 'callback-failed';

export type ReadChatSseOptions = {
  body: ReadableStream<Uint8Array>;
  signal: AbortSignal;
  onChunk: (text: string) => void;
  firstChunkTimeoutMs?: number;
  idleTimeoutMs?: number;
  /** Optional debug hook, e.g. ('done', { chunkCount }). */
  onEvent?: (event: string, data?: Record<string, unknown>) => void;
  /**
   * Receives provider-reported token usage when the stream carries it.
   *
   * A trailing accounting frame is PRESERVED: providers put it after the last
   * content frame, and reading only the content frames throws away the
   * provider's own numbers in favour of an estimate.
   */
  onUsage?: (usage: AiTextUsage) => void;
  /**
   * Derives the signal for one read window, so the caller's shared deadline and
   * the phase watchdog both bound a single `reader.read()`.
   *
   * When absent the reader falls back to its own per-read timers, which is the
   * historical behaviour and the reason the losing timers used to leak.
   */
  readWindow?: (requestedMs: number) => { signal: AbortSignal; dispose: () => void };
};

// ---------------------------------------------------------------------------
// Line-level interpretation
// ---------------------------------------------------------------------------

/** What one `data:` payload means. */
type DataLine =
  | { kind: 'skip' }
  | { kind: 'done' }
  | { kind: 'malformed' }
  | { kind: 'frame'; token?: string; usage?: AiTextUsage };

/** Classifies one `data:` payload without touching any consumer callback. */
const classifyDataLine = (data: string): DataLine => {
  if (data === '[DONE]') {
    return { kind: 'done' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    // A malformed FRAME is skipped. It is a provider protocol fault confined to
    // this line; it is not evidence that anything else failed, and it must not
    // be reported as one.
    return { kind: 'malformed' };
  }
  const record = parsed as { choices?: Array<{ delta?: { content?: string } }> };
  const token = record.choices?.[0]?.delta?.content;
  // The content delta and the accounting block are read INDEPENDENTLY: some
  // providers send usage on its own trailing frame, others attach it to the
  // last content frame. Short-circuiting on either would drop the other's half.
  const usage = readOpenAiUsage(record);
  return {
    kind: 'frame',
    ...(token ? { token } : {}),
    ...(usage === undefined ? {} : { usage }),
  };
};

/** Extracts the `data:` payload from a raw line, or `undefined` to skip it. */
const dataPayload = (line: string): string | undefined => {
  const trimmed = line.trim();
  if (trimmed.length === 0 || !trimmed.startsWith('data: ')) {
    return undefined;
  }
  return trimmed.slice(6);
};

/**
 * Running state of one SSE read.
 *
 * A class so the counters, the trailing usage and the consumer-error channel
 * have exactly one owner, and the read loop stays a loop with three exits.
 */
class SseSession {
  private _buffer = '';
  private _chunkCount = 0;
  private _contentChars = 0;
  private _hasReceivedContent = false;
  private _usage: AiTextUsage | undefined;
  private _callbackError: unknown;

  constructor(
    private readonly _options: {
      onChunk: (text: string) => void;
      onEvent?: (event: string, data?: Record<string, unknown>) => void;
      onUsage?: (usage: AiTextUsage) => void;
    },
  ) {}

  get hasReceivedContent(): boolean {
    return this._hasReceivedContent;
  }

  get callbackError(): unknown {
    return this._callbackError;
  }

  /** Builds the final outcome, attaching the trailing usage when there is one. */
  outcome(
    kind: ChatSseOutcome['kind'],
    extra?: { reason?: unknown; error?: unknown },
  ): ChatSseOutcome {
    return {
      kind,
      contentChars: this._contentChars,
      chunkCount: this._chunkCount,
      ...(this._usage === undefined ? {} : { usage: this._usage }),
      ...extra,
    };
  }

  /** Appends decoded bytes, splitting off every complete line. */
  ingest(text: string): void {
    this._buffer += text;
  }

  /**
   * Folds every complete buffered line into the session.
   *
   * Returns `done` on the `[DONE]` sentinel and `callback-failed` when a
   * CONSUMER threw — which is surfaced, never reported as a parse error and
   * swallowed.
   */
  consumeLines(): LineVerdict {
    const parts = this._buffer.split('\n');
    // The final element is an incomplete line (or the empty tail after a
    // newline) and stays buffered for the next read.
    this._buffer = parts.pop() ?? '';
    for (const line of parts) {
      const payload = dataPayload(line);
      if (payload === undefined) {
        continue;
      }
      const verdict = this._applyLine(payload);
      if (verdict !== 'continue') {
        return verdict;
      }
    }
    return 'continue';
  }

  /** Applies one classified line. Returns a verdict the loop can act on. */
  private _applyLine(payload: string): LineVerdict {
    const classified = classifyDataLine(payload);
    switch (classified.kind) {
      case 'skip':
      case 'malformed':
        return 'continue';
      case 'done':
        this._options.onEvent?.('done', { chunkCount: this._chunkCount });
        return 'done';
      case 'frame':
        return this._deliverFrame(classified);
    }
  }

  /** Delivers content and usage for one content frame. */
  private _deliverFrame(frame: { token?: string; usage?: AiTextUsage }): LineVerdict {
    try {
      if (frame.token !== undefined) {
        this._hasReceivedContent = true;
        this._options.onChunk(frame.token);
        this._chunkCount += 1;
        this._contentChars += frame.token.length;
      }
      if (frame.usage !== undefined) {
        this._usage = frame.usage;
        this._options.onUsage?.(frame.usage);
      }
    } catch (error) {
      this._callbackError = error;
      return 'callback-failed';
    }
    return 'continue';
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

/** A window backed by this module's own timer, for callers with no deadline. */
const createLocalWindow = (requestedMs: number): { signal: AbortSignal; dispose: () => void } => {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Stream read exceeded ${requestedMs} ms`));
  }, requestedMs);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
    },
  };
};

/**
 * Reads once, bounded by a window whose timer is disposed on EVERY path —
 * win, loss, throw. That is the specific leak being fixed.
 *
 * RACED, not cancelled. Cancelling the reader when the window expires makes
 * the pending `read()` resolve with `done`, and the caller would report a
 * stalled stream as a socket that closed early. Racing leaves the socket alone;
 * it is released once, at the end of the read, with the real reason intact.
 */
const readChunkWithin = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  readWindow: ReadChatSseOptions['readWindow'],
  requestedMs: number,
): Promise<WindowedRead> => {
  const window = readWindow?.(requestedMs) ?? createLocalWindow(requestedMs);
  if (window.signal.aborted) {
    window.dispose();
    return { kind: 'window-expired' };
  }
  let unlisten: (() => void) | undefined;
  const expired = new Promise<'expired'>((resolve) => {
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
    if (raced === 'expired') {
      return { kind: 'window-expired' };
    }
    // A cancelled read can resolve with a value rather than throwing; an absent
    // value is treated as a close, never as content.
    return raced.done || raced.value === undefined
      ? { kind: 'closed' }
      : { kind: 'chunk', value: raced.value };
  } finally {
    unlisten?.();
    window.dispose();
  }
};

/**
 * The outcome a read settles on, or `undefined` to keep reading.
 *
 * Named rather than inlined because the three ways a stream can stop early are
 * the part of this reader a reviewer most needs to read side by side.
 */
const terminalOutcome = (options: {
  read: WindowedRead;
  session: SseSession;
  signal: AbortSignal;
}): ChatSseOutcome | undefined => {
  const { read, session, signal } = options;
  if (read.kind === 'window-expired') {
    return signal.aborted
      ? session.outcome('aborted', { reason: signal.reason })
      : session.outcome(session.hasReceivedContent ? 'idle-timeout' : 'first-chunk-timeout');
  }
  // A close is only a success if the provider already sent `[DONE]`; anything
  // else is a truncated stream and is reported as one.
  return read.kind === 'closed' ? session.outcome('closed-early') : undefined;
};

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

/**
 * Reads a chat completions SSE response stream.
 *
 * Each line is `data: {"id":"…","choices":[{"delta":{"content":"token"}}]}`.
 * The stream ends with `data: [DONE]`.
 *
 * NEVER THROWS for a stream condition — every outcome above is a value. A throw
 * here cannot distinguish a stalled stream from a caller cancellation from a
 * consumer bug, and each of those needs a different response.
 */
export const readChatSseStream = async (options: ReadChatSseOptions): Promise<ChatSseOutcome> => {
  const {
    body,
    signal,
    onChunk,
    firstChunkTimeoutMs = GATEWAY_FIRST_CHUNK_TIMEOUT_MS,
    idleTimeoutMs = GATEWAY_IDLE_TIMEOUT_MS,
    onEvent,
    onUsage,
    readWindow,
  } = options;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const session = new SseSession({
    onChunk,
    ...(onEvent === undefined ? {} : { onEvent }),
    ...(onUsage === undefined ? {} : { onUsage }),
  });

  try {
    for (;;) {
      if (signal.aborted) {
        return session.outcome('aborted', { reason: signal.reason });
      }
      // The short idle window applies only once content has started flowing.
      const budget = session.hasReceivedContent ? idleTimeoutMs : firstChunkTimeoutMs;
      const read = await readChunkWithin(reader, readWindow, budget);
      const terminal = terminalOutcome({ read, session, signal });
      if (terminal !== undefined) {
        return terminal;
      }
      if (read.kind !== 'chunk') {
        continue;
      }
      session.ingest(decoder.decode(read.value, { stream: true }));
      const verdict = session.consumeLines();
      if (verdict === 'done') {
        return session.outcome('completed');
      }
      if (verdict === 'callback-failed') {
        return session.outcome('callback-failed', { error: session.callbackError });
      }
    }
  } catch (error) {
    if (signal.aborted) {
      return session.outcome('aborted', { reason: signal.reason });
    }
    throw error;
  } finally {
    // Cancels the socket, not just the lock: `releaseLock` alone drops the
    // lock, and an abandoned stream would keep the provider generating behind
    // the request the client already gave up on.
    await reader.cancel().catch(() => {});
    try {
      reader.releaseLock();
    } catch {
      // A lock already released by a cancelled read is not an error here.
    }
  }
};
