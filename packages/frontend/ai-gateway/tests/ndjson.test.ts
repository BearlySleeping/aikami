// packages/frontend/ai-gateway/tests/ndjson.test.ts
//
// Bounded native NDJSON reader — the transport that replaced a whole-body await
// on Ollama's `/api/chat` (issue #382).
//
// The cases here are the ones a `text.split('\n')` gets wrong and that a real
// provider produced during the pre-change probe: frames split mid-UTF-8,
// mid-JSON, several frames per chunk, a final line with no newline, thinking
// frames arriving before any content, and a stream that ends without its `done`
// frame. The measured runtime put 312 frames into a 146-character answer, and
// its first frames carried `thinking` with an EMPTY `content`.

import { describe, expect, test } from 'bun:test';
import { readNativeNdjsonStream } from '../src/index.ts';
import { NATIVE_DONE, ndjsonFrame, syntheticGroupedBody } from './helpers.ts';

/** A signal that never fires, for the non-abort cases. */
const live = (): AbortSignal => new AbortController().signal;

/** Reads a payload delivered in fixed byte groups, collecting delivered content. */
const read = async (
  payload: string,
  options?: { grouping?: number; signal?: AbortSignal; maxBufferBytes?: number },
) => {
  const delivered: string[] = [];
  const thinking: string[] = [];
  const outcome = await readNativeNdjsonStream({
    body: syntheticGroupedBody(payload, options?.grouping),
    signal: options?.signal ?? live(),
    onContent: (text) => delivered.push(text),
    onThinking: (text) => thinking.push(text),
    ...(options?.maxBufferBytes === undefined ? {} : { maxBufferBytes: options.maxBufferBytes }),
  });
  return { outcome, delivered, thinking };
};

describe('native NDJSON reader — framing', () => {
  test('reassembles a frame split mid-JSON across byte groups', async () => {
    const payload = `${ndjsonFrame({ content: 'Hello' })}${NATIVE_DONE()}`;
    // One byte at a time is the worst possible boundary: every split lands
    // inside a token, and inside the JSON object.
    const { outcome, delivered } = await read(payload, { grouping: 1 });

    expect(outcome.kind).toBe('completed');
    expect(delivered).toEqual(['Hello']);
    expect(outcome.report.narrative).toBe('Hello');
  });

  test('reassembles a frame split inside a multi-byte UTF-8 character', async () => {
    // "ä" is two bytes, "🜁" is four. A decoder that is not in streaming mode
    // replaces a partial sequence with U+FFFD, which is silent corruption.
    const payload = `${ndjsonFrame({ content: 'Grüße 🜁 done' })}${NATIVE_DONE()}`;
    const { outcome, delivered } = await read(payload, { grouping: 3 });

    expect(outcome.kind).toBe('completed');
    expect(delivered).toEqual(['Grüße 🜁 done']);
    expect(outcome.report.narrative).toBe('Grüße 🜁 done');
  });

  test('handles several frames arriving in a single chunk', async () => {
    const payload = [
      ndjsonFrame({ content: 'a' }),
      ndjsonFrame({ content: 'b' }),
      ndjsonFrame({ content: 'c' }),
      NATIVE_DONE(),
    ].join('');
    // One chunk carrying everything: no read boundary falls on a newline.
    const { outcome, delivered } = await read(payload);

    expect(outcome.kind).toBe('completed');
    expect(delivered).toEqual(['a', 'b', 'c']);
  });

  test('delivers a final line that carries no trailing newline', async () => {
    // The `done` frame is the one that usually carries the accounting counters.
    // Dropping it because it lacked a newline would throw the provider's own
    // token counts away in favour of an estimate.
    const payload = `${ndjsonFrame({ content: 'Hi' })}${NATIVE_DONE({
      usage: { promptTokens: 10, evalTokens: 2 },
    })}`.replace(/\n$/, '');
    const { outcome } = await read(payload);

    expect(outcome.kind).toBe('completed');
    expect(outcome.report.doneReason).toBe('stop');
    expect(outcome.report.finalFrame).toBeDefined();
  });

  test('empty content frames are observed but never delivered', async () => {
    const payload = [
      ndjsonFrame({ content: '' }),
      ndjsonFrame({ content: '' }),
      ndjsonFrame({ content: 'real' }),
      NATIVE_DONE(),
    ].join('');
    const { outcome, delivered } = await read(payload);

    expect(outcome.kind).toBe('completed');
    // Zero-length fragments would make a consumer repaint an empty string for
    // every frame; 312 of them is a real cost on a chat surface.
    expect(delivered).toEqual(['real']);
    expect(outcome.report.contentFrameCount).toBe(1);
  });

  test('the accumulated narrative EQUALS the concatenation of delivered fragments', async () => {
    const fragments = ['The ', 'lantern ', 'flickers.'];
    const payload = [...fragments.map((c) => ndjsonFrame({ content: c })), NATIVE_DONE()].join('');
    const { outcome, delivered } = await read(payload, { grouping: 7 });

    expect(outcome.kind).toBe('completed');
    expect(outcome.report.narrative).toBe(delivered.join(''));
    expect(delivered).toEqual(fragments);
  });
});

describe('native NDJSON reader — thinking is not narrative', () => {
  test('delivers ONLY message.content and never the thinking channel', async () => {
    // Exactly the measured shape: content empty, thinking populated, for many
    // frames before the first visible character.
    const frames = [
      ...Array.from({ length: 8 }, (_, i) => ndjsonFrame({ content: '', thinking: `step ${i} ` })),
      ndjsonFrame({ content: 'The', thinking: 'now I answer. ' }),
      ndjsonFrame({ content: ' answer.' }),
      NATIVE_DONE(),
    ];
    const { outcome, delivered, thinking } = await read(frames.join(''));

    expect(outcome.kind).toBe('completed');
    // A model's private reasoning must never reach narrative rendering.
    expect(delivered).toEqual(['The', ' answer.']);
    expect(delivered.join('')).not.toContain('step 0');
    expect(thinking.join('')).toContain('step 0');
    // Measured for diagnostics, and reported, but not delivered.
    expect(outcome.report.thinkingChars).toBeGreaterThan(0);
  });

  test('reports zero thinking when the channel is absent', async () => {
    const { outcome } = await read(`${ndjsonFrame({ content: 'plain' })}${NATIVE_DONE()}`);
    expect(outcome.report.thinkingChars).toBe(0);
  });
});

describe('native NDJSON reader — failure modes', () => {
  test('records a malformed line without discarding the frames around it', async () => {
    const payload = [
      ndjsonFrame({ content: 'good' }),
      // A real malformed line is still newline-terminated — the provider's
      // framing is intact even when one record is not valid JSON.
      '{not json at all\n',
      ndjsonFrame({ content: 'also good' }),
      NATIVE_DONE(),
    ].join('');
    const { outcome, delivered } = await read(payload);

    // One bad frame is a provider protocol fault confined to that line. It is
    // reported, not thrown, and it does not swallow the narrative.
    expect(outcome.kind).toBe('malformed-lines');
    expect(delivered).toEqual(['good', 'also good']);
  });

  test('treats a non-object JSON line as malformed', async () => {
    const payload = ['[1,2,3]', '"a string"', `${ndjsonFrame({ content: 'x' })}${NATIVE_DONE()}`]
      .join('\n')
      .concat('\n');
    const { outcome } = await read(payload);
    expect(outcome.kind).toBe('malformed-lines');
  });

  test('surfaces a provider error frame as a provider error', async () => {
    const payload = `${JSON.stringify({ error: 'model requires more system memory' })}\n`;
    const { outcome } = await read(payload);

    // Distinct from a truncated stream: the provider ANSWERED, and said no.
    expect(outcome.kind).toBe('provider-error');
    if (outcome.kind === 'provider-error') {
      expect(outcome.message).toBe('model requires more system memory');
    }
  });

  test('reports EOF before a done frame as TRUNCATED, not as success', async () => {
    // Content arrived and the socket simply ended. Reporting this as a
    // completed generation is how a half-sentence becomes a finished reply.
    const payload = `${ndjsonFrame({ content: 'The lantern flick' })}`;
    const { outcome, delivered } = await read(payload);

    expect(outcome.kind).toBe('truncated');
    expect(delivered).toEqual(['The lantern flick']);
    expect(outcome.report.narrative).toBe('The lantern flick');
  });

  test('an empty stream is truncated, not a successful empty generation', async () => {
    const { outcome } = await read('');
    expect(outcome.kind).toBe('truncated');
  });

  test('fails closed when the unterminated buffer exceeds its cap', async () => {
    // A provider that never emits a newline must not be able to grow the
    // buffer without limit.
    const { outcome } = await read(`{"message":{"content":"${'x'.repeat(4096)}`, {
      maxBufferBytes: 256,
    });

    expect(outcome.kind).toBe('buffer-overflow');
  });

  test('reports an already-aborted signal without reading', async () => {
    const controller = new AbortController();
    controller.abort(new Error('caller left'));
    const { outcome, delivered } = await read(`${ndjsonFrame({ content: 'x' })}${NATIVE_DONE()}`, {
      signal: controller.signal,
    });

    expect(outcome.kind).toBe('aborted');
    expect(delivered).toEqual([]);
  });

  test('reports an abort that lands mid-read', async () => {
    const controller = new AbortController();
    // Deliver one frame, then abort before the stream closes.
    const payload = `${ndjsonFrame({ content: 'partial' })}${NATIVE_DONE()}`;
    const body = new ReadableStream<Uint8Array>({
      start(streamController): void {
        streamController.enqueue(new TextEncoder().encode(payload));
        controller.abort(new Error('mid-read abort'));
      },
    });
    const delivered: string[] = [];
    const outcome = await readNativeNdjsonStream({
      body,
      signal: controller.signal,
      onContent: (text) => delivered.push(text),
    });

    // Whatever arrived was delivered — streaming is streaming — but the outcome
    // is an abort, so no caller records this as a completed generation.
    expect(outcome.kind).toBe('aborted');
    expect(delivered.length).toBeLessThanOrEqual(1);
  });
});

describe('native NDJSON reader — phase windows', () => {
  /**
   * A body that delivers its groups and then STALLS, never closing.
   *
   * A body that closes would let the reader reach EOF before the watchdog ever
   * had a chance to fire, so it would report a truncation instead of the
   * timeout under test. A real provider that goes quiet mid-generation looks
   * exactly like this.
   */
  const stallingBody = (groups: string[]): ReadableStream<Uint8Array> => {
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(controller): void {
        for (const group of groups) {
          controller.enqueue(encoder.encode(group));
        }
      },
      // A promise that never settles keeps the stream open without closing it,
      // which is what a provider that stopped sending looks like: `read()`
      // stays pending rather than resolving with `done`.
      pull(): Promise<void> {
        return new Promise<void>(() => {});
      },
    });
  };

  test('reports first-content expiry distinctly from idle expiry', async () => {
    // The reader picks the phase, so the caller cannot accidentally apply the
    // short idle window to a model that has not started talking yet.
    const phases: string[] = [];
    const payload = `${ndjsonFrame({ content: 'a' })}${ndjsonFrame({ content: 'b' })}${NATIVE_DONE()}`;

    const outcome = await readNativeNdjsonStream({
      body: syntheticGroupedBody(payload, 20),
      signal: new AbortController().signal,
      onContent: () => {},
      readWindow: (phase) => {
        phases.push(phase);
        return { signal: new AbortController().signal, dispose: () => {} };
      },
    });

    expect(outcome.kind).toBe('completed');
    // Starts in `first-content` and moves to `idle` once content has arrived.
    expect(phases[0]).toBe('first-content');
    expect(phases).toContain('idle');
  });

  test('an expired window while no content has arrived is a first-content failure', async () => {
    const phases: string[] = [];
    let reads = 0;
    const outcome = await readNativeNdjsonStream({
      // One thinking frame, then silence. The completion frame is never sent,
      // so only the watchdog can end this stream.
      body: stallingBody([ndjsonFrame({ thinking: 'still thinking' })]),
      signal: new AbortController().signal,
      onContent: () => {},
      readWindow: (phase) => {
        phases.push(phase);
        reads += 1;
        const phaseController = new AbortController();
        // Real time, not a microtask: the read is genuinely pending. The first
        // read is allowed to succeed so the expiry lands on the second.
        if (reads > 1) {
          setTimeout(() => phaseController.abort(new Error('watchdog')), 1);
        }
        return { signal: phaseController.signal, dispose: () => {} };
      },
    });

    expect(phases).toEqual(['first-content', 'first-content']);

    // Thinking frames do not satisfy the first-content phase: a model that
    // thinks for 30 s and then answers has not stalled.
    expect(outcome.kind).toBe('first-content-timeout');
  });

  test('an expired window after content arrived is an idle failure', async () => {
    const groups = [ndjsonFrame({ content: 'started' }), ndjsonFrame({ content: 'more' })];
    const seen: string[] = [];
    const phases: string[] = [];
    let reads = 0;
    const outcome = await readNativeNdjsonStream({
      body: stallingBody(groups),
      signal: new AbortController().signal,
      onContent: (text) => seen.push(text),
      readWindow: (phase) => {
        phases.push(phase);
        reads += 1;
        const phaseController = new AbortController();
        if (reads > 2) {
          setTimeout(() => phaseController.abort(new Error('watchdog')), 1);
        }
        return { signal: phaseController.signal, dispose: () => {} };
      },
    });

    // The reader switched phase once visible content existed — which is what
    // keeps a thinking model from being declared stalled before it speaks.
    expect(phases).toEqual(['first-content', 'idle', 'idle']);

    // Already-delivered content is delivered — streaming is streaming — but the
    // outcome names the stall, so no caller records this as a finished reply.
    expect(seen).toEqual(['started', 'more']);
    expect(outcome.kind).toBe('idle-timeout');
  });
});
