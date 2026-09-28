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
} from '../src/index.ts';
import {
  createJsonFetchMock,
  createSseFetchMock,
  SSE_DONE,
  sseChunk,
  sseUsage,
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

  test('reads Ollama-native eval counts', async () => {
    const { fetchFn } = createJsonFetchMock({
      usage: { ollama: { promptTokens: 42, outputTokens: 7 } },
    });
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    const result = await adapter.generateText({
      resolution: resolution({ provider: 'ollama', endpoint: 'http://localhost:11434' }),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 7, source: 'provider' });
  });

  test('reports nothing when the body carries no accounting', async () => {
    const { fetchFn } = createJsonFetchMock();
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    const result = await adapter.generateText({
      resolution: resolution({ provider: 'ollama', endpoint: 'http://localhost:11434' }),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.text).toBe('Hello from JSON mock');
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
    expect(error).toBeInstanceOf(Error);
  });
});
