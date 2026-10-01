// packages/frontend/ai-gateway/tests/text_usage.test.ts
//
// Provider-reported token accounting (issue #382 P0 "Distinguish actual
// provider usage/cached-token counts from character-based estimates").
//
// The property under test is provenance: a number the provider reported is
// marked as such and carries its cache detail; a body that reports nothing
// yields no usage at all rather than a fabricated zero. A zero would be
// indistinguishable from "the provider said this cost nothing", which is a very
// different claim from "we did not measure it".

import { describe, expect, test } from 'bun:test';
import type { AiModeResolution } from '@aikami/types';
import {
  createAdapterRegistry,
  createAiProviderGateway,
  createOpenAiCompatibleTextAdapter,
  isAiGatewayError,
} from '../src/index.ts';
import { readChatSseStream } from '../src/lib/sse.ts';
import {
  createJsonFetchMock,
  createNativeNdjsonFetchMock,
  createSseFetchMock,
  NATIVE_DONE,
  ndjsonFrame,
  SSE_DONE,
  sseChunk,
  sseUsage,
  syntheticSseBody,
} from './helpers.ts';

const resolution = (overrides?: Partial<AiModeResolution>): AiModeResolution => ({
  capability: 'text',
  mode: 'byok',
  provider: 'openrouter',
  endpoint: 'https://openrouter.ai/api/v1',
  model: 'llama-3-70b',
  ...overrides,
});

const signal = (): AbortSignal => new AbortController().signal;

describe('Streaming usage — provider accounting', () => {
  test('delivers content before usage when both share a frame', async () => {
    const events: string[] = [];
    await readChatSseStream({
      body: syntheticSseBody([
        'data: {"choices":[{"delta":{"content":"hello"}}],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\n',
        SSE_DONE,
      ]),
      signal: signal(),
      onChunk: (text) => events.push(text),
      onUsage: () => events.push('usage'),
    });
    expect(events).toEqual(['hello', 'usage']);
  });

  test('rejects fractional token counts in streaming accounting', async () => {
    const { fetchFn } = createSseFetchMock({
      chunks: [sseChunk('Hi'), sseUsage({ promptTokens: 1.5, completionTokens: 2 }), SSE_DONE],
    });
    const result = await createOpenAiCompatibleTextAdapter({ fetchFn }).generateText({
      resolution: resolution(),
      signal: signal(),
      messages: [],
    });
    expect(result.usage).toBeUndefined();
  });

  test('reports the trailing accounting frame as provider usage', async () => {
    const { fetchFn } = createSseFetchMock({
      chunks: [
        sseChunk('Hel'),
        sseChunk('lo'),
        sseUsage({ promptTokens: 1_200, completionTokens: 340 }),
        SSE_DONE,
      ],
    });
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    const result = await adapter.generateText({
      resolution: resolution(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.text).toBe('Hello');
    expect(result.usage).toEqual({
      inputTokens: 1_200,
      outputTokens: 340,
      source: 'provider',
    });
  });

  test('delivers content carried in the same frame as usage', async () => {
    const usageFrame = JSON.parse(sseUsage({ promptTokens: 10, completionTokens: 2 }).slice(6));
    const { fetchFn } = createSseFetchMock({
      chunks: [
        `data: ${JSON.stringify({ ...usageFrame, choices: [{ delta: { content: 'Hello' } }] })}\n\n`,
        SSE_DONE,
      ],
    });
    const chunks: string[] = [];
    const result = await createOpenAiCompatibleTextAdapter({ fetchFn }).generateText({
      resolution: resolution(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: (chunk) => chunks.push(chunk),
    });
    expect(chunks).toEqual(['Hello']);
    expect(result.text).toBe('Hello');
    expect(result.usage?.inputTokens).toBe(10);
  });

  test.each([-1, 1.5])('rejects invalid SSE token count %i', async (count) => {
    const { fetchFn } = createSseFetchMock({
      chunks: [
        sseChunk('Hi'),
        sseUsage({ promptTokens: count, completionTokens: count }),
        SSE_DONE,
      ],
    });
    const result = await createOpenAiCompatibleTextAdapter({ fetchFn }).generateText({
      resolution: resolution(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
    });
    expect(result.text).toBe('Hi');
    expect(result.usage).toBeUndefined();
  });

  test('carries cached prompt tokens when the provider reports them', async () => {
    const { fetchFn } = createSseFetchMock({
      chunks: [
        sseChunk('Hi'),
        sseUsage({ promptTokens: 10_000, completionTokens: 50, cachedTokens: 8_000 }),
        SSE_DONE,
      ],
    });
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    const result = await adapter.generateText({
      resolution: resolution(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.usage?.cachedTokens).toBe(8_000);
    expect(result.usage?.source).toBe('provider');
  });

  test('omits cachedTokens when the provider reports no cache detail', async () => {
    const { fetchFn } = createSseFetchMock({
      chunks: [sseChunk('Hi'), sseUsage({ promptTokens: 10, completionTokens: 2 }), SSE_DONE],
    });
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    const result = await adapter.generateText({
      resolution: resolution(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 2, source: 'provider' });
  });

  test('reports no usage at all when the stream carries no accounting frame', async () => {
    const { fetchFn } = createSseFetchMock({ chunks: [sseChunk('Hi'), SSE_DONE] });
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    const result = await adapter.generateText({
      resolution: resolution(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
    });

    // Absence of measurement is not a measurement of zero.
    expect(result.text).toBe('Hi');
    expect(result.usage).toBeUndefined();
  });

  test('asks the provider for the accounting frame on streaming calls', async () => {
    const { fetchFn, calls } = createSseFetchMock({ chunks: [sseChunk('Hi'), SSE_DONE] });
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    await adapter.generateText({
      resolution: resolution(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
    });

    // Without this the frame never arrives, and usage would always be unknown.
    expect(calls[0].body.stream_options).toEqual({
      // biome-ignore lint/style/useNamingConvention: OpenAI API contract field name
      include_usage: true,
    });
  });

  test('ignores an accounting frame with non-numeric counts', async () => {
    const { fetchFn } = createSseFetchMock({
      chunks: [
        sseChunk('Hi'),
        // biome-ignore lint/style/useNamingConvention: OpenAI API contract field names, deliberately malformed
        `data: ${JSON.stringify({ usage: { prompt_tokens: 'many', completion_tokens: null } })}\n\n`,
        SSE_DONE,
      ],
    });
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    const result = await adapter.generateText({
      resolution: resolution(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.text).toBe('Hi');
    expect(result.usage).toBeUndefined();
  });
});

describe('Non-streaming usage — provider accounting', () => {
  test('request usage retains the discarded empty attempt when retry usage is absent', async () => {
    const empty = createJsonFetchMock({
      content: '',
      usage: { openAi: { promptTokens: 100, completionTokens: 0 } },
    });
    const retry = createJsonFetchMock({ content: '{"ok":true}' });
    let count = 0;
    const adapter = createOpenAiCompatibleTextAdapter({
      fetchFn: Object.assign(
        (...args: Parameters<typeof fetch>) =>
          ++count === 1 ? empty.fetchFn(...args) : retry.fetchFn(...args),
        { preconnect: fetch.preconnect },
      ),
    });
    const result = await adapter.generateText({
      resolution: resolution(),
      signal: signal(),
      messages: [],
      schema: { type: 'object' },
      schemaName: 'Ok',
    });
    expect(count).toBe(2);
    expect(result.usage).toMatchObject({ inputTokens: 100, outputTokens: 0 });
  });

  test('combines structured and fallback usage after invalid JSON', async () => {
    const structured = createJsonFetchMock({
      content: 'not json',
      usage: { openAi: { promptTokens: 100, completionTokens: 10, cachedTokens: 30 } },
    });
    const fallback = createSseFetchMock({
      chunks: [
        sseChunk('{"ok":true}'),
        sseUsage({ promptTokens: 50, completionTokens: 5, cachedTokens: 20 }),
        SSE_DONE,
      ],
    });
    let count = 0;
    const adapter = createOpenAiCompatibleTextAdapter({
      fetchFn: Object.assign(
        (...args: Parameters<typeof fetch>) =>
          ++count === 1 ? structured.fetchFn(...args) : fallback.fetchFn(...args),
        { preconnect: fetch.preconnect },
      ),
    });
    const result = await adapter.generateText({
      resolution: resolution(),
      signal: signal(),
      messages: [],
      schema: { type: 'object' },
      schemaName: 'Ok',
    });
    expect(result.structured).toEqual({ ok: true });
    // `cachedSource` is additive provenance: both attempts reported a cached
    // count, so the SUM is provider-reported rather than partly guessed.
    expect(result.usage).toEqual({
      inputTokens: 150,
      outputTokens: 15,
      cachedTokens: 50,
      cachedSource: 'provider',
      source: 'provider',
    });
  });

  test('reads the OpenAI usage block from a structured response', async () => {
    const { fetchFn } = createJsonFetchMock({
      content: '{"ok":true}',
      usage: { openAi: { promptTokens: 300, completionTokens: 25 } },
    });
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    const result = await adapter.generateText({
      resolution: resolution(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
      schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      schemaName: 'Ok',
    });

    expect(result.structured).toEqual({ ok: true });
    expect(result.usage).toEqual({ inputTokens: 300, outputTokens: 25, source: 'provider' });
  });

  test.each([-1, 1.5])('rejects invalid JSON token count %i', async (count) => {
    const { fetchFn } = createJsonFetchMock({
      content: '{"ok":true}',
      usage: { openAi: { promptTokens: count, completionTokens: count } },
    });
    const result = await createOpenAiCompatibleTextAdapter({ fetchFn }).generateText({
      resolution: resolution(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
      schema: { type: 'object' },
      schemaName: 'Ok',
    });
    expect(result.structured).toEqual({ ok: true });
    expect(result.usage).toBeUndefined();
  });

  test('structured retry discards earlier whitespace but retains billed usage', async () => {
    let attempts = 0;
    const first = createJsonFetchMock({
      content: ' ',
      usage: { openAi: { promptTokens: 300, completionTokens: 1 } },
    });
    const second = createJsonFetchMock({ content: '{"ok":true}' });
    const adapter = createOpenAiCompatibleTextAdapter({
      fetchFn: async (...args) => {
        attempts++;
        return (attempts === 1 ? first.fetchFn : second.fetchFn)(...args);
      },
    });
    const result = await adapter.generateText({
      resolution: resolution(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
      schema: { type: 'object' },
      schemaName: 'Ok',
    });
    expect(attempts).toBe(2);
    expect(result.text).toBe('{"ok":true}');
    expect(result.usage).toMatchObject({ inputTokens: 300, outputTokens: 1 });
  });

  // The native route now streams, so its counters arrive on the TERMINATING
  // NDJSON frame rather than on a whole buffered body. Measured on Ollama
  // 0.34.3: `prompt_eval_cached_count` is present, and it is 18 against a
  // `prompt_eval_count` of 22 on a warm call — so it is parsed rather than
  // assumed absent, and its absence is reported as unknown rather than zero.
  test('reads Ollama-native eval counts off the terminating native frame', async () => {
    const { fetchFn } = createNativeNdjsonFetchMock({
      lines: [
        ndjsonFrame({ content: 'Hi' }),
        NATIVE_DONE({ usage: { promptTokens: 42, evalTokens: 7, cachedTokens: 12 } }),
      ],
    });
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    const result = await adapter.generateText({
      resolution: resolution({ provider: 'ollama', endpoint: 'http://localhost:11434' }),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.usage).toEqual({
      inputTokens: 42,
      outputTokens: 7,
      cachedTokens: 12,
      cachedSource: 'provider',
      source: 'provider',
    });
  });

  test('records an ABSENT native cached counter as unknown, never as zero', async () => {
    const { fetchFn } = createNativeNdjsonFetchMock({
      lines: [
        ndjsonFrame({ content: 'Hi' }),
        NATIVE_DONE({ usage: { promptTokens: 42, evalTokens: 7 } }),
      ],
    });
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    const result = await adapter.generateText({
      resolution: resolution({ provider: 'ollama', endpoint: 'http://localhost:11434' }),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
    });

    // A runtime that does not supply the field is UNKNOWN. Defaulting to 0
    // would read as a measured "this call reused no cache".
    expect(result.usage).toEqual({
      inputTokens: 42,
      outputTokens: 7,
      cachedSource: 'unknown',
      source: 'provider',
    });
    expect(result.usage?.cachedTokens).toBeUndefined();
  });

  test('reports nothing when the body carries no accounting', async () => {
    const { fetchFn } = createNativeNdjsonFetchMock();
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    const result = await adapter.generateText({
      resolution: resolution({ provider: 'ollama', endpoint: 'http://localhost:11434' }),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.text).toBe('Hello');
    expect(result.usage).toBeUndefined();
  });
});

describe('gateway.resolveText — policy without dispatch', () => {
  const buildGateway = (routing: AiModeResolution) => {
    const registry = createAdapterRegistry();
    registry.registerText({
      mode: 'byok',
      adapter: createOpenAiCompatibleTextAdapter({ fetchFn: createSseFetchMock().fetchFn }),
    });
    return createAiProviderGateway({
      registry,
      resolveMode: () => routing,
    });
  };

  test('returns the same resolution the dispatch path would compute', () => {
    const expected = resolution();
    const gateway = buildGateway(expected);

    expect(gateway.resolveText({ model: 'llama-3-70b', task: 'combat-ai' })).toEqual(expected);
  });

  test('passes the model, endpoint and task through to the resolver', () => {
    const seen: Array<Record<string, unknown>> = [];
    const gateway = createAiProviderGateway({
      registry: createAdapterRegistry(),
      resolveMode: (options) => {
        seen.push(options);
        return resolution();
      },
    });

    gateway.resolveText({ model: 'pinned/model', endpoint: 'http://x/v1', task: 'envelope' });

    expect(seen[0]).toEqual({
      capability: 'text',
      model: 'pinned/model',
      endpoint: 'http://x/v1',
      task: 'envelope',
    });
  });

  test('resolves with no options at all', () => {
    const gateway = buildGateway(resolution());
    expect(gateway.resolveText()).toEqual(resolution());
  });

  test('normalizes a resolver failure into a typed gateway error', () => {
    const gateway = createAiProviderGateway({
      registry: createAdapterRegistry(),
      resolveMode: () => {
        throw new Error('no provider configured');
      },
    });

    let error: unknown;
    try {
      gateway.resolveText({ task: 'narration' });
    } catch (caught) {
      error = caught;
    }

    // A caller that must decide something before spending a call gets the same
    // typed failure the dispatch path would have produced.
    expect(error).toBeDefined();
    expect(isAiGatewayError(error)).toBe(true);
  });
});
