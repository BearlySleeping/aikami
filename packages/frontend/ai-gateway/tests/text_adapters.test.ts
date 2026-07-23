// packages/frontend/ai-gateway/tests/text_adapters.test.ts
//
// AC-2 (C-320): OpenAI-compatible text adapter — streaming order, headers,
// endpoint resolution, Ollama VRAM eviction params, structured extraction
// (native response_format + system-prompt fallback), abort propagation.

import { describe, expect, test } from 'bun:test';
import type { AiModeResolution } from '@aikami/types';
import {
  createOpenAiCompatibleTextAdapter,
  isAiGatewayError,
} from '../src/index.ts';
import { createJsonFetchMock, createSseFetchMock, SSE_DONE, sseChunk } from './helpers.ts';

const resolution = (overrides?: Partial<AiModeResolution>): AiModeResolution => ({
  capability: 'text',
  mode: 'byok',
  provider: 'openrouter',
  endpoint: 'https://openrouter.ai/api/v1',
  model: 'llama-3-70b',
  ...overrides,
});

const signal = (): AbortSignal => new AbortController().signal;

describe('OpenAI-compatible text adapter — streaming', () => {
  test('delivers chunks in provider order and accumulates text', async () => {
    const { fetchFn } = createSseFetchMock({
      chunks: [sseChunk('Hel'), sseChunk('lo '), sseChunk('World'), SSE_DONE],
    });
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    const received: string[] = [];
    const result = await adapter.generateText({
      resolution: resolution(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: (text) => received.push(text),
    });

    expect(received).toEqual(['Hel', 'lo ', 'World']);
    expect(result.text).toBe('Hello World');
  });

  test('posts to <endpoint>/chat/completions with OpenAI-compatible body', async () => {
    const { fetchFn, calls } = createSseFetchMock();
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    await adapter.generateText({
      resolution: resolution(),
      signal: signal(),
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
      ],
    });

    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(calls[0].body.model).toBe('llama-3-70b');
    expect(calls[0].body.stream).toBe(true);
    expect(calls[0].body.messages).toEqual([
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Hello' },
    ]);
  });

  test('sends Authorization header from injected key resolver', async () => {
    const { fetchFn, calls } = createSseFetchMock();
    const adapter = createOpenAiCompatibleTextAdapter({
      fetchFn,
      getApiKey: (provider) => (provider === 'openrouter' ? 'or-key' : undefined),
    });

    await adapter.generateText({
      resolution: resolution(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(calls[0].headers.Authorization).toBe('Bearer or-key');
  });

  test('includes OpenRouter attribution headers for openrouter provider', async () => {
    const { fetchFn, calls } = createSseFetchMock();
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    await adapter.generateText({
      resolution: resolution(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(calls[0].headers['HTTP-Referer']).toBe('https://aikami.app');
    expect(calls[0].headers['X-Title']).toBe('Aikami');
  });

  test('falls back to well-known local endpoint for ollama', async () => {
    const { fetchFn, calls } = createJsonFetchMock();
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    await adapter.generateText({
      resolution: resolution({ mode: 'offline', provider: 'ollama', endpoint: '' }),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(calls[0].url).toBe('http://localhost:11434/api/chat');
  });

  test('uses injected default endpoint for cloud providers without one', async () => {
    const { fetchFn, calls } = createSseFetchMock();
    const adapter = createOpenAiCompatibleTextAdapter({
      fetchFn,
      getDefaultEndpoint: (provider) =>
        provider === 'openai' ? 'https://api.openai.com/v1' : undefined,
    });

    await adapter.generateText({
      resolution: resolution({ provider: 'openai', endpoint: '' }),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
  });

  test('throws not_configured when no endpoint can be resolved', async () => {
    const { fetchFn } = createSseFetchMock();
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    try {
      await adapter.generateText({
        resolution: resolution({ provider: 'unknown', endpoint: '' }),
        signal: signal(),
        messages: [{ role: 'user', content: 'Hi' }],
      });
      throw new Error('expected rejection');
    } catch (error) {
      expect(isAiGatewayError(error)).toBe(true);
      if (isAiGatewayError(error)) {
        expect(error.code).toBe('not_configured');
        expect(error.message).toContain('No endpoint configured for provider "unknown"');
      }
    }
  });

  // Updated for C-320: Ollama native /api/chat no longer sends VRAM eviction
  // params — the endpoint uses stream: false which naturally releases VRAM.
  test('Ollama native endpoint does not send VRAM eviction params', async () => {
    const { fetchFn, calls } = createJsonFetchMock();
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    await adapter.generateText({
      resolution: resolution({ mode: 'offline', provider: 'ollama', endpoint: '' }),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
    });
    await adapter.generateText({
      resolution: resolution(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Hi' }],
    });

    // Ollama native endpoint should NOT include VRAM eviction params.
    expect(calls[0].body.keep_alive).toBeUndefined();
    expect(calls[0].body.options).toBeUndefined();
    // Non-Ollama providers also skip them.
    expect(calls[1].body.keep_alive).toBeUndefined();
    expect(calls[1].body.options).toBeUndefined();
  });

  test('propagates AbortSignal to the upstream fetch mid-stream', async () => {
    // SSE stream that emits one chunk and stays open — only an abort ends it.
    const calls: Array<{ signal: AbortSignal | undefined }> = [];
    const encoder = new TextEncoder();
    const fetchFn = ((_input: unknown, init?: RequestInit): Promise<Response> => {
      calls.push({ signal: init?.signal ?? undefined });
      const body = new ReadableStream<Uint8Array>({
        start(controller): void {
          controller.enqueue(encoder.encode(sseChunk('partial')));
          // never closed — simulates a hung provider stream
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    }) as typeof fetch;

    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });
    const controller = new AbortController();

    const pending = adapter.generateText({
      resolution: resolution(),
      signal: controller.signal,
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: () => controller.abort(), // abort mid-stream on first chunk
    });

    await pending.catch(() => undefined);

    // Client disconnect must abort the upstream fetch signal (C-056 VRAM lesson).
    expect(calls[0].signal).toBeDefined();
    expect(calls[0].signal?.aborted).toBe(true);
  });

  test('maps provider HTTP 401 to auth_failed', async () => {
    const { fetchFn } = createSseFetchMock({ status: 401, statusBody: 'bad key' });
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    try {
      await adapter.generateText({
        resolution: resolution(),
        signal: signal(),
        messages: [{ role: 'user', content: 'Hi' }],
      });
      throw new Error('expected rejection');
    } catch (error) {
      expect(isAiGatewayError(error)).toBe(true);
      if (isAiGatewayError(error)) {
        expect(error.code).toBe('auth_failed');
        expect(error.message).toContain('HTTP 401');
      }
    }
  });
});

describe('OpenAI-compatible text adapter — structured extraction', () => {
  const characterSchema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      level: { type: 'integer' },
    },
    required: ['name'],
  };

  test('extracts a structured object with native response_format', async () => {
    const payload = JSON.stringify({ name: 'Aragorn', level: 5 });
    const { fetchFn, calls } = createSseFetchMock({ chunks: [sseChunk(payload), SSE_DONE] });
    const adapter = createOpenAiCompatibleTextAdapter({
      fetchFn,
      supportsStructuredOutput: () => true,
    });

    const result = await adapter.generateText({
      resolution: resolution(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Extract a character' }],
      schema: characterSchema,
      schemaName: 'TestCharacter',
    });

    expect(result.structured).toEqual({ name: 'Aragorn', level: 5 });
    const responseFormat = calls[0].body.response_format as Record<string, unknown>;
    expect(responseFormat).toBeDefined();
    expect(responseFormat.type).toBe('json_schema');
  });

  test('omits response_format for providers without structured support', async () => {
    const payload = JSON.stringify({ name: 'Gandalf' });
    const { fetchFn, calls } = createSseFetchMock({ chunks: [sseChunk(payload), SSE_DONE] });
    const adapter = createOpenAiCompatibleTextAdapter({
      fetchFn,
      supportsStructuredOutput: () => false,
    });

    const result = await adapter.generateText({
      resolution: resolution({ mode: 'offline', provider: 'ollama', endpoint: '' }),
      signal: signal(),
      messages: [{ role: 'user', content: 'Extract a wizard' }],
      schema: characterSchema,
      schemaName: 'TestWizard',
    });

    expect(result.structured).toEqual({ name: 'Gandalf' });
    expect(calls[0].body.response_format).toBeUndefined();
  });

  test('strips markdown fences and surrounding prose from the response', async () => {
    const { fetchFn } = createSseFetchMock({
      chunks: [
        sseChunk('Here you go: ```json\n'),
        sseChunk(JSON.stringify({ name: 'Gimli' })),
        sseChunk('\n```'),
        SSE_DONE,
      ],
    });
    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    const result = await adapter.generateText({
      resolution: resolution(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Extract' }],
      schema: characterSchema,
      schemaName: 'TestDwarf',
    });

    expect(result.structured).toEqual({ name: 'Gimli' });
  });

  test('enforces additionalProperties: false and caches compiled schemas', async () => {
    const sizes: number[] = [];
    const payload = JSON.stringify({ name: 'Test' });
    const { fetchFn, calls } = createSseFetchMock({ chunks: [sseChunk(payload), SSE_DONE] });
    const adapter = createOpenAiCompatibleTextAdapter({
      fetchFn,
      supportsStructuredOutput: () => true,
      onSchemaCacheSize: (size) => sizes.push(size),
    });

    for (const prompt of ['first', 'second'] as const) {
      await adapter.generateText({
        resolution: resolution(),
        signal: signal(),
        messages: [{ role: 'user', content: prompt }],
        schema: characterSchema,
        schemaName: 'CachedSchema',
      });
    }

    const responseFormat = calls[0].body.response_format as {
      // biome-ignore lint/style/useNamingConvention: OpenAI API contract field name
      json_schema: { schema: Record<string, unknown> };
    };
    expect(responseFormat.json_schema.schema.additionalProperties).toBe(false);
    expect(sizes).toEqual([1, 1]);
  });

  test('falls back to system-prompt extraction on HTTP 400', async () => {
    const payload = JSON.stringify({ name: 'Legolas' });
    let callCount = 0;
    const { fetchFn: sseFetch } = createSseFetchMock({ chunks: [sseChunk(payload), SSE_DONE] });
    const fetchFn = ((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(new Response('response_format unsupported', { status: 400 }));
      }
      return sseFetch(input, init);
    }) as typeof fetch;

    const adapter = createOpenAiCompatibleTextAdapter({
      fetchFn,
      supportsStructuredOutput: () => true,
    });

    const result = await adapter.generateText({
      resolution: resolution(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Extract' }],
      schema: characterSchema,
      schemaName: 'FallbackSchema',
    });

    expect(callCount).toBe(2);
    expect(result.structured).toEqual({ name: 'Legolas' });
  });

  test('falls back to system-prompt extraction when 200 response is not JSON', async () => {
    let callCount = 0;
    const { fetchFn: proseFetch } = createSseFetchMock({
      chunks: [sseChunk('I cannot produce structured output, sorry.'), SSE_DONE],
    });
    const { fetchFn: jsonFetch } = createSseFetchMock({
      chunks: [sseChunk(JSON.stringify({ name: 'Boromir' })), SSE_DONE],
    });
    const fetchFn = ((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      callCount++;
      return callCount === 1 ? proseFetch(input, init) : jsonFetch(input, init);
    }) as typeof fetch;

    const adapter = createOpenAiCompatibleTextAdapter({ fetchFn });

    const result = await adapter.generateText({
      resolution: resolution(),
      signal: signal(),
      messages: [{ role: 'user', content: 'Extract' }],
      schema: characterSchema,
      schemaName: 'ProseFallback',
    });

    expect(callCount).toBe(2);
    expect(result.structured).toEqual({ name: 'Boromir' });
  });
});
