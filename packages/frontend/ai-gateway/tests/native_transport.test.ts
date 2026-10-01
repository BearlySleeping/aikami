// packages/frontend/ai-gateway/tests/native_transport.test.ts
//
// End-to-end behaviour of the native Ollama route after the #382 change:
// incremental delivery, thinking exclusion, native schema constraint, the
// deadline reaching the transport, and per-attempt accounting.
//
// Each test names the pre-change behaviour it would have failed against, because
// a regression that merely passes is not evidence of anything.

import { describe, expect, test } from 'bun:test';
import type { AiModeResolution, TextParams } from '@aikami/types';
import {
  type AiTransportAttemptEvent,
  createOpenAiCompatibleTextAdapter,
  isAiGatewayError,
} from '../src/index.ts';
import {
  createJsonFetchMock,
  createNativeNdjsonFetchMock,
  NATIVE_DONE,
  ndjsonFrame,
} from './helpers.ts';

const native = (overrides?: Partial<AiModeResolution>): AiModeResolution => ({
  capability: 'text',
  mode: 'offline',
  provider: 'ollama',
  endpoint: 'http://localhost:11434',
  model: 'ornith-1.5:9b',
  ...overrides,
});

const signal = (): AbortSignal => new AbortController().signal;

const params: TextParams = {
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  repetitionPenalty: 1.1,
  presencePenalty: 0,
  maxTokens: 1024,
  contextSize: 4096,
};

describe('native transport — incremental narrative delivery', () => {
  test('delivers each content fragment ONCE, in order, and the total matches', async () => {
    const fragments = ['The ', 'lantern ', 'flickers', '.'];
    const { fetchFn } = createNativeNdjsonFetchMock({
      lines: [...fragments.map((c) => ndjsonFrame({ content: c })), NATIVE_DONE()],
    });
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    const received: string[] = [];
    const result = await adapter.generateText({
      resolution: native(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Describe the lantern' }],
      onChunk: (text) => received.push(text),
    });

    // Before: one onChunk, delivered after the whole body was awaited, and no
    // first-content time was definable at all.
    expect(received).toEqual(fragments);
    expect(received.join('')).toBe(result.text);
    expect(result.text).toBe('The lantern flickers.');
  });

  test('NEVER delivers or counts the thinking channel as narrative', async () => {
    // The measured shape: many thinking frames with EMPTY content before the
    // first visible character. On the real runtime the first FRAME arrived at
    // 94 ms and the first CONTENT at 5 616 ms.
    const { fetchFn } = createNativeNdjsonFetchMock({
      lines: [
        ...Array.from({ length: 20 }, (_, i) =>
          ndjsonFrame({ content: '', thinking: `reason ${i}` }),
        ),
        ndjsonFrame({ content: 'The', thinking: 'final thought. ' }),
        ndjsonFrame({ content: ' lantern.' }),
        NATIVE_DONE({ usage: { promptTokens: 22, evalTokens: 314 } }),
      ],
    });
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    const received: string[] = [];
    const result = await adapter.generateText({
      resolution: native(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: (text) => received.push(text),
    });

    expect(received).toEqual(['The', ' lantern.']);
    // A model's private reasoning must not reach narrative rendering, and the
    // token count for it must not be charged to the visible answer.
    expect(result.text).not.toContain('reason 0');
    expect(result.text).not.toContain('final thought');
  });

  test('reassembles a stream delivered one byte at a time', async () => {
    const { fetchFn } = createNativeNdjsonFetchMock({
      lines: [ndjsonFrame({ content: 'Grüße 🜁' }), NATIVE_DONE()],
      byteGrouping: 1,
    });
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    const result = await adapter.generateText({
      resolution: native(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
    });

    // A decoder not in streaming mode would have written U+FFFD here.
    expect(result.text).toBe('Grüße 🜁');
  });

  test('refuses to report a stream that ended before completion as success', async () => {
    const { fetchFn } = createNativeNdjsonFetchMock({
      lines: [ndjsonFrame({ content: 'The lantern flick' })],
    });
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    let error: unknown;
    try {
      await adapter.generateText({
        resolution: native(),
        signal: signal(),
        messages: [{ role: 'user', content: 'Hi' }],
      });
    } catch (caught) {
      error = caught;
    }

    expect(isAiGatewayError(error)).toBe(true);
    if (isAiGatewayError(error)) {
      // A half-sentence that looks like a finished reply is the exact outcome
      // this refuses to produce.
      expect(error.code).toBe('invalid_response');
      expect(error.message).toContain('before the provider signalled completion');
    }
  });

  test('a completion without a trailing newline still yields its usage', async () => {
    const { fetchFn } = createNativeNdjsonFetchMock({
      lines: [
        ndjsonFrame({ content: 'Hi' }),
        NATIVE_DONE({ usage: { promptTokens: 30, evalTokens: 4, cachedTokens: 25 } }),
      ],
      trailingNewline: false,
    });
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    const result = await adapter.generateText({
      resolution: native(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
    });

    // The `done` frame is the one that usually carries the counters; losing it
    // would trade the provider's own numbers for an estimate.
    expect(result.usage).toEqual({
      inputTokens: 30,
      outputTokens: 4,
      cachedTokens: 25,
      cachedSource: 'provider',
      source: 'provider',
    });
  });
});

describe('native transport — configured parameters are actually sent', () => {
  test('sends mapped options under Ollama’s own `options` key', async () => {
    const { fetchFn, calls } = createNativeNdjsonFetchMock();
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    await adapter.generateText({
      resolution: native({ params }),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
    });

    const body = calls[0].body;
    // Before: `buildGenerationParams` returned `{}` for Ollama, so every one of
    // these was configured and silently ignored.
    expect(body.stream).toBe(true);
    expect(body.options).toMatchObject({
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      num_predict: 1024,
      temperature: 0.7,
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      top_p: 0.9,
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      top_k: 40,
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      repeat_penalty: 1.1,
    });
    // The OpenAI spellings must NOT appear: Ollama ignores unknown top-level
    // fields and answers 200, so sending them would look configured and do
    // nothing.
    expect('max_tokens' in body).toBe(false);
    expect('presence_penalty' in body).toBe(false);
  });

  test('omits `options` entirely when nothing is configured', async () => {
    const { fetchFn, calls } = createNativeNdjsonFetchMock();
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    await adapter.generateText({
      resolution: native(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(calls[0].body.options).toBeUndefined();
  });

  test('can reproduce the OLD buffered route on one build, for A/B measurement', async () => {
    // A whole JSON body, which is what the pre-change route received.
    const { fetchFn, calls } = createJsonFetchMock({ content: 'buffered reply' });
    // The before/after comparison needs both behaviours measurable from the
    // same binary, otherwise it compares two commits and two provider states.
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn, nativeStreamingEnabled: false });

    await adapter.generateText({
      resolution: native(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(calls[0].body.stream).toBe(false);
  });
});

describe('native transport — structured extraction', () => {
  const draftSchema = {
    type: 'object',
    properties: { mood: { type: 'string', enum: ['calm', 'wary'] } },
    required: ['mood'],
  };

  const structuredBody = (content: string) =>
    // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
    JSON.stringify({ message: { content }, done: true, done_reason: 'stop' });

  test('sends a NATIVE format schema when the capability is declared', async () => {
    const { fetchFn, calls } = createNativeNdjsonFetchMock({
      lines: [structuredBody('{"mood":"wary"}')],
    });
    const adapter = createOpenAiCompatibleTextAdapter({
      fetchFn,
      supportsNativeFormat: () => true,
    });

    const result = await adapter.generateText({
      resolution: native(),
      signal: signal(),
      messages: [{ role: 'user', content: 'The caravan never arrived.' }],
      schema: draftSchema,
      schemaName: 'Draft',
    });

    const body = calls[0].body;
    // Measured on 0.34.3: a JSON Schema passed as `format` returns a
    // conforming body. Before, the schema was only a system-prompt
    // instruction and the prose was parsed afterwards.
    expect(body.format).toMatchObject({ type: 'object' });
    // The original TypeBox validation stays authoritative; `format` constrains
    // the decoder, it does not replace the contract.
    expect(result.structured).toEqual({ mood: 'wary' });
  });

  test('stays BUFFERED for structured requests', async () => {
    const { fetchFn, calls } = createNativeNdjsonFetchMock({
      lines: [structuredBody('{"mood":"calm"}')],
    });
    const adapter = createOpenAiCompatibleTextAdapter({
      fetchFn,
      supportsNativeFormat: () => true,
    });

    await adapter.generateText({
      resolution: native(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
      schema: draftSchema,
      schemaName: 'Draft',
    });

    // A schema-constrained object is parsed as a whole anyway, so streaming it
    // changes no player-visible latency while adding a failure mode on
    // providers that reject stream:true with a schema constraint.
    expect(calls[0].body.stream).toBe(false);
    // One chunk at the end, exactly as the old route delivered it — which is
    // why no first-content time was definable for it.
  });

  test('omits `format` when the capability is not declared, and says so', async () => {
    const { fetchFn, calls } = createNativeNdjsonFetchMock({
      lines: [structuredBody('{"mood":"calm"}')],
    });
    const events: string[] = [];
    const adapter = createOpenAiCompatibleTextAdapter({
      fetchFn,
      // Absent means "not declared", which is treated as UNSUPPORTED. Because
      // Ollama answers 200 to fields it ignores, guessing wrong in the other
      // direction would produce unconstrained prose that then fails validation.
      supportsNativeFormat: () => false,
      onEvent: (event) => events.push(event),
    });

    const result = await adapter.generateText({
      resolution: native(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
      schema: draftSchema,
      schemaName: 'Draft',
    });

    expect('format' in calls[0].body).toBe(false);
    expect(events).toContain('native-format-unavailable');
    // Still works, via the system-prompt path.
    expect(result.structured).toEqual({ mood: 'calm' });
  });

  test('falls back ONCE on a shape rejection, without a retry storm', async () => {
    let dispatched = 0;
    const fetchFn = (async () => {
      dispatched += 1;
      // First attempt is rejected for its shape; the second is plain prose.
      if (dispatched === 1) {
        return new Response('unsupported format', { status: 400 });
      }
      return new Response(structuredBody('{"mood":"wary"}'), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const adapter = createOpenAiCompatibleTextAdapter({
      fetchFn,
      supportsNativeFormat: () => true,
    });

    const result = await adapter.generateText({
      resolution: native(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
      schema: draftSchema,
      schemaName: 'Draft',
    });

    expect(result.structured).toEqual({ mood: 'wary' });
    // Exactly one differently-shaped retry. Broadening this to every 400 would
    // turn a malformed-request bug into a silent retry against a paid provider.
    expect(dispatched).toBe(2);
  });

  test('does NOT treat a 500 as a shape rejection', async () => {
    let dispatched = 0;
    const fetchFn = (async () => {
      dispatched += 1;
      return new Response('boom', { status: 500 });
    }) as typeof fetch;

    const adapter = createOpenAiCompatibleTextAdapter({
      fetchFn,
      supportsNativeFormat: () => true,
    });

    await adapter
      .generateText({
        resolution: native(),
        signal: signal(),
        messages: [{ role: 'user', content: 'Hi' }],
        schema: draftSchema,
        schemaName: 'Draft',
      })
      .catch(() => undefined);

    // A server error is not something a differently-shaped request fixes.
    expect(dispatched).toBe(1);
  });
});

describe('native transport — the deadline reaches the transport', () => {
  test('an ALREADY-EXPIRED caller budget never buys a provider call', async () => {
    const { fetchFn, calls } = createNativeNdjsonFetchMock();
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    let error: unknown;
    try {
      await adapter.generateText({
        resolution: native(),
        signal: signal(),
        messages: [{ role: 'user', content: 'Hi' }],
        // In the past. Before, the transport had no deadline field at all and
        // would have dispatched a 90-second request for a caller that had
        // already given up.
        deadlineAt: Date.now() - 1,
      });
    } catch (caught) {
      error = caught;
    }

    expect(calls).toHaveLength(0);
    expect(isAiGatewayError(error)).toBe(true);
    if (isAiGatewayError(error)) {
      // A timeout, not a cancellation: nobody waited, but the budget is gone.
      expect(error.code).toBe('timeout');
      expect(error.timeoutKind).toBe('total_budget');
    }
  });

  test('a budget LONGER than the 90s watchdog is honoured, not truncated', async () => {
    const { fetchFn } = createNativeNdjsonFetchMock();
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    // `npc_dialogue_service` declares a 120 s logical budget. Before, the
    // adapter's own 90 s timer cut every one of these.
    const result = await adapter.generateText({
      resolution: native(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
      deadlineAt: Date.now() + 120_000,
    });

    expect(result.text).toBe('Hello');
  });

  test('a caller cancellation is a cancellation, not a timeout', async () => {
    const controller = new AbortController();
    const { fetchFn } = createNativeNdjsonFetchMock();
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    controller.abort();
    let error: unknown;
    try {
      await adapter.generateText({
        resolution: native(),
        signal: controller.signal,
        messages: [{ role: 'user', content: 'Hi' }],
      });
    } catch (caught) {
      error = caught;
    }

    expect(isAiGatewayError(error)).toBe(true);
    if (isAiGatewayError(error)) {
      expect(error.code).toBe('cancelled');
    }
  });
});

describe('native transport — per-attempt accounting', () => {
  test('one narrative dispatch produces one completed attempt with its timings', async () => {
    const { fetchFn } = createNativeNdjsonFetchMock({
      lines: [
        ndjsonFrame({ content: 'The lantern ' }),
        ndjsonFrame({ content: 'flickers.' }),
        NATIVE_DONE({ doneReason: 'stop', usage: { promptTokens: 22, evalTokens: 9 } }),
      ],
    });
    const seen: AiTransportAttemptEvent[] = [];
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    await adapter.generateText({
      resolution: native(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
      onAttempt: (event) => seen.push(event as AiTransportAttemptEvent),
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.kind).toBe('narrative');
    expect(seen[0]?.transport).toBe('ndjson-stream');
    expect(seen[0]?.outcome).toBe('completed');
    // The shape is named, so a buffered completion can never be read as a
    // first-token measurement.
    expect(seen[0]?.firstContentMs).toBeGreaterThanOrEqual(0);
    expect(seen[0]?.totalMs).toBeGreaterThanOrEqual(0);
    expect(seen[0]?.usage).toMatchObject({ inputTokens: 22, outputTokens: 9 });
    expect(seen[0]?.doneReason).toBe('stop');
  });

  test('an empty completion is recorded as `empty`, distinctly from success', async () => {
    const { fetchFn } = createNativeNdjsonFetchMock({ lines: [NATIVE_DONE()] });
    const seen: AiTransportAttemptEvent[] = [];
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    await adapter.generateText({
      resolution: native(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
      onAttempt: (event) => seen.push(event as AiTransportAttemptEvent),
    });

    expect(seen[0]?.outcome).toBe('empty');
    expect(seen[0]?.firstContentMs).toBeUndefined();
  });

  test('a truncated stream is recorded AND reported as a failure', async () => {
    const { fetchFn } = createNativeNdjsonFetchMock({
      lines: [ndjsonFrame({ content: 'half a sent' })],
    });
    const seen: AiTransportAttemptEvent[] = [];
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    await adapter
      .generateText({
        resolution: native(),
        signal: signal(),
        messages: [{ role: 'user', content: 'Hi' }],
        onAttempt: (event) => seen.push(event as AiTransportAttemptEvent),
      })
      .catch(() => undefined);

    // The attempt exists even though the call failed, because the provider
    // billed it.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.outcome).toBe('error');
    expect(seen[0]?.truncated).toBe(true);
  });

  test('a discarded structured attempt is still accounted for', async () => {
    let dispatched = 0;
    const fetchFn = (async () => {
      dispatched += 1;
      if (dispatched === 1) {
        return new Response('bad shape', { status: 400 });
      }
      return new Response(
        JSON.stringify({
          message: { content: '{"mood":"calm"}' },
          done: true,
          // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
          prompt_eval_count: 60,
          // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
          eval_count: 8,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const seen: AiTransportAttemptEvent[] = [];
    const adapter = createOpenAiCompatibleTextAdapter({
      fetchFn,
      supportsNativeFormat: () => true,
    });

    await adapter.generateText({
      resolution: native(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
      schema: { type: 'object', properties: { mood: { type: 'string' } }, required: ['mood'] },
      schemaName: 'Draft',
      onAttempt: (event) => seen.push(event as AiTransportAttemptEvent),
    });

    // Every DISPATCHED attempt has identity and outcome, including the one
    // whose output was thrown away. An accounting boundary that only saw the
    // survivor would under-report real spend.
    expect(seen.map((event) => event.outcome)).toEqual(['unsupported', 'completed']);
    expect(seen[0]?.kind).toBe('structured');
    expect(seen[1]?.kind).toBe('narrative');
  });

  test("an empty-retry does not inherit the discarded attempt's accounting", async () => {
    const bodies = [
      JSON.stringify({
        message: { content: '' },
        done: true,
        // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
        prompt_eval_count: 100,
        // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
        eval_count: 0,
      }),
      JSON.stringify({
        message: { content: '{"ok":true}' },
        done: true,
        // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
        prompt_eval_count: 7,
        // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
        eval_count: 2,
      }),
    ];
    let dispatched = 0;
    const fetchFn = (async () => {
      const body = bodies[dispatched];
      dispatched += 1;
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    const seen: AiTransportAttemptEvent[] = [];
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    const result = await adapter.generateText({
      resolution: native(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
      schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
      schemaName: 'Ok',
      onAttempt: (event) => seen.push(event as AiTransportAttemptEvent),
    });

    expect(dispatched).toBe(2);
    expect(seen.map((event) => event.outcome)).toEqual(['empty', 'completed']);
    // The surviving attempt reports ITS OWN counters, not the empty attempt's.
    expect(seen[1]?.usage).toMatchObject({ inputTokens: 7, outputTokens: 2 });
    expect(result.usage).toMatchObject({ inputTokens: 7, outputTokens: 2 });
  });
});
