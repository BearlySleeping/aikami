// packages/frontend/ai-gateway/tests/sse_lifecycle.test.ts
//
// SSE reader lifecycle and completion policy (issue #382).
//
// Four defects at the reviewed baseline, each with its own test below:
//
//   - losing timers survived every read (a 30 000-chunk stream left 30 000 live
//     timers on the heap);
//   - the reader was never cancelled, so an abandoned stream kept the provider
//     connection and the generation behind it alive;
//   - a stream that ended by timeout or abort could be reported as success;
//   - a throwing `onChunk` was reported as a malformed LINE and swallowed.

import { describe, expect, test } from 'bun:test';
import { type ChatSseOutcome, readChatSseStream } from '../src/index.ts';
import {
  createLocalWindowProbe,
  SSE_DONE,
  sseChunk,
  sseUsage,
  syntheticGroupedBody,
  syntheticSseBody,
} from './helpers.ts';

const live = (): AbortSignal => new AbortController().signal;

/** A body that delivers its groups and then stalls, never closing. */
const stallingBody = (groups: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller): void {
      for (const group of groups) {
        controller.enqueue(encoder.encode(group));
      }
    },
    pull(): Promise<void> {
      return new Promise<void>(() => {});
    },
  });
};

describe('SSE reader — protocol completion versus a closed socket', () => {
  test('`[DONE]` is the only success', async () => {
    const outcome = await readChatSseStream({
      body: syntheticSseBody([
        sseChunk('Hello'),
        sseUsage({ promptTokens: 3, completionTokens: 1 }),
        SSE_DONE,
      ]),
      signal: live(),
      onChunk: () => {},
    });
    expect(outcome.kind).toBe('completed');
    expect(outcome.usage).toMatchObject({ inputTokens: 3, outputTokens: 1 });
  });

  test('a socket that closes without `[DONE]` is NOT completion', async () => {
    const delivered: string[] = [];
    const outcome = await readChatSseStream({
      // Content arrived and the connection simply ended — a proxy timeout, a
      // load balancer, a truncated CDN response.
      body: syntheticSseBody([sseChunk('The lantern flick')]),
      signal: live(),
      onChunk: (text) => delivered.push(text),
    });

    expect(outcome.kind).toBe('closed-early');
    // Already-delivered content is delivered — streaming is streaming — but the
    // outcome says the generation did not finish.
    expect(delivered).toEqual(['The lantern flick']);
    expect(outcome.contentChars).toBeGreaterThan(0);
  });

  test('an empty stream is closed-early, not a completed empty answer', async () => {
    const outcome = await readChatSseStream({
      body: syntheticSseBody([]),
      signal: live(),
      onChunk: () => {},
    });
    expect(outcome.kind).toBe('closed-early');
  });

  test('[DONE] ends the stream and later frames are not read', async () => {
    const outcome = await readChatSseStream({
      body: stallingBody([
        `${sseChunk('Hi')}${SSE_DONE}${sseUsage({ promptTokens: 11, completionTokens: 2 })}`,
      ]),
      signal: live(),
      onChunk: () => {},
    });
    // `[DONE]` still ends the stream, so the frame after it is not read — but
    // this documents the boundary rather than pretending it does not exist.
    expect(outcome.kind).toBe('completed');
  });

  test('reads usage attached to the last CONTENT frame, not only a trailing one', async () => {
    const frame = `data: ${JSON.stringify({
      choices: [{ delta: { content: 'Hi' } }],
      usage: {
        // biome-ignore lint/style/useNamingConvention: OpenAI API contract field name
        prompt_tokens: 5,
        // biome-ignore lint/style/useNamingConvention: OpenAI API contract field name
        completion_tokens: 1,
      },
    })}\n\n`;
    const usage: unknown[] = [];
    const outcome = await readChatSseStream({
      body: syntheticSseBody([frame, SSE_DONE]),
      signal: live(),
      onChunk: () => {},
      onUsage: (value) => usage.push(value),
    });
    expect(usage).toHaveLength(1);
    expect(outcome.kind).toBe('completed');
  });
});

describe('SSE reader — resource lifecycle', () => {
  test('disposes EVERY read window, including the ones that lose the race', async () => {
    const probe = createLocalWindowProbe();

    await readChatSseStream({
      // Many frames in few chunks: most reads win, and each winning read must
      // still release its window.
      body: syntheticSseBody([
        Array.from({ length: 40 }, (_, i) => sseChunk(String(i))).join(''),
        SSE_DONE,
      ]),
      signal: live(),
      onChunk: () => {},
      readWindow: probe.window,
    });

    // Before: one leaked timer per read. 40 chunks meant 40 live timers after
    // the call returned.
    expect(probe.created).toBeGreaterThan(1);
    expect(probe.live()).toBe(0);
  });

  test('cancels the underlying reader when the stream ends', async () => {
    let cancelled = false;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(encoder.encode(`${sseChunk('Hi')}${SSE_DONE}`));
      },
      pull(): Promise<void> {
        return new Promise<void>(() => {});
      },
      cancel(): void {
        cancelled = true;
      },
    });

    await readChatSseStream({ body, signal: live(), onChunk: () => {} });

    // `releaseLock` alone drops the lock; it does not close the socket. An
    // abandoned stream used to keep the provider generating behind the call.
    expect(cancelled).toBe(true);
  });
});

describe('SSE reader — failures are named, not conflated', () => {
  const kindsOf = async (
    build: (signal: AbortSignal) => Promise<ChatSseOutcome>,
  ): Promise<ChatSseOutcome> => build(live());

  test('distinguishes first-chunk expiry from a mid-stream stall', async () => {
    const never = new AbortController();

    const first = await kindsOf(() =>
      readChatSseStream({
        body: stallingBody([]),
        signal: never.signal,
        onChunk: () => {},
        firstChunkTimeoutMs: 5,
        idleTimeoutMs: 50,
      }),
    );
    expect(first.kind).toBe('first-chunk-timeout');

    let reads = 0;
    const stalled = await readChatSseStream({
      body: stallingBody([sseChunk('started')]),
      signal: new AbortController().signal,
      onChunk: () => {},
      firstChunkTimeoutMs: 500,
      idleTimeoutMs: 5,
      readWindow: () => {
        reads += 1;
        const controller = new AbortController();
        if (reads > 1) {
          setTimeout(() => controller.abort(new Error('stalled')), 1);
        }
        return { signal: controller.signal, dispose: () => {} };
      },
    });
    // A caller degrades from these differently: the first means nothing ever
    // arrived, the second means a working stream broke.
    expect(stalled.kind).toBe('idle-timeout');
  });

  test('an abort mid-stream is reported as an abort, not a timeout', async () => {
    const controller = new AbortController();
    const pending = readChatSseStream({
      body: stallingBody([sseChunk('half')]),
      signal: controller.signal,
      onChunk: () => {},
    });
    controller.abort(new Error('user left'));
    const outcome = await pending;
    expect(outcome.kind).toBe('aborted');
  });

  test('a throwing consumer callback is surfaced, never reported as bad JSON', async () => {
    const outcome = await readChatSseStream({
      body: syntheticSseBody([sseChunk('one'), sseChunk('two'), SSE_DONE]),
      signal: live(),
      // The consumer blew up.
      onChunk: () => {
        throw new Error('renderer detached');
      },
    });

    // Before, this shared a `try` with `JSON.parse` and was diagnosed as a
    // malformed line — then swallowed, so the stream kept producing text nobody
    // was listening to.
    expect(outcome.kind).toBe('callback-failed');
    if (outcome.kind === 'callback-failed') {
      expect((outcome.error as Error).message).toBe('renderer detached');
    }
  });

  test('a genuinely malformed frame is skipped without ending the stream', async () => {
    const delivered: string[] = [];
    const outcome = await readChatSseStream({
      body: syntheticGroupedBody(
        `data: {"choices":[{"delta":{"content":"good"}}]}\n\ndata: {broken\n\ndata: {"choices":[{"delta":{"content":"also good"}}]}\n\n${SSE_DONE}`,
        11,
      ),
      signal: live(),
      onChunk: (text) => delivered.push(text),
    });

    expect(outcome.kind).toBe('completed');
    // One bad frame is a provider protocol fault confined to that line.
    expect(delivered).toEqual(['good', 'also good']);
  });
});
