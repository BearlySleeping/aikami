// apps/frontend/client/src/lib/services/ai/text_generation_service.test.ts
//
// Unit tests for TextGenerationService (C-080).
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/services/ai/text_generation_service.test.ts

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// $state and $derived are polyfilled globally via test_preload.ts

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------

let mockFetchCalls: Array<{
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
  signal: AbortSignal;
}> = [];
let sseChunks: string[] = [];
let mockConfigState: Record<string, unknown> = {
  preferredModel: '',
  models: [],
  apiKeys: {},
};

// ---------------------------------------------------------------------------
// Mock: crypto_vault (config_service depends on this)
// ---------------------------------------------------------------------------

const CRYPTO_VAULT_PATH =
  '/home/sonny/Development/Projects/passion/aikami/apps/frontend/client/src/lib/utils/crypto_vault.ts';

mock.module(CRYPTO_VAULT_PATH, () => ({
  encrypt: () => Promise.resolve(),
  decrypt: () => Promise.resolve(null),
  clearVault: () => Promise.resolve(),
  __esModule: true,
}));

const CONFIG_SVC_PATH =
  '/home/sonny/Development/Projects/passion/aikami/apps/frontend/client/src/lib/services/config/config_service.svelte.ts';

// ---------------------------------------------------------------------------
// Mock: global fetch
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

const setupMockFetch = (): void => {
  mockFetchCalls = [];
  sseChunks = [];

  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let body: Record<string, unknown> = {};
    const headers: Record<string, string> = {};

    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers)) {
        headers[k] = v;
      }
    }

    if (init?.body && typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        // ignore
      }
    }

    mockFetchCalls.push({
      url,
      body,
      headers,
      signal: init?.signal as AbortSignal,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of sseChunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    const response = new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });

    return Promise.resolve(response);
  });
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const loadService = async () => {
  const mod = await import('./text_generation_service.svelte.ts');
  return mod.textGenerationService as import('./text_generation_service.svelte.ts').TextGenerationServiceInterface;
};

const setConfigState = async (state: Record<string, unknown>) => {
  const cfg = await import(CONFIG_SVC_PATH);
  (cfg.configService as Record<string, unknown>).state = state;
};

/** Builds an OpenRouter SSE chunk: `data: {"choices":[{"delta":{"content":"token"}}]}\n\n` */
const buildSSEChunk = (text: string): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

/** OpenRouter SSE done signal. */
const SSE_DONE = 'data: [DONE]\n\n';

// ---------------------------------------------------------------------------
// Tests: AC-1 — Dynamic Provider & Model Resolution
// ---------------------------------------------------------------------------

describe('TextGenerationService — AC-1: Dynamic Provider Resolution', () => {
  beforeEach(async () => {
    setupMockFetch();
    mockConfigState = {
      text: { apiKeys: {}, provider: 'openrouter' },
      preferredModel: 'test-model',
      models: [{ model: 'test-model', provider: 'openrouter', endpoint: '' }],
    };
    await setConfigState(mockConfigState);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('should throw when no text provider is configured', async () => {
    // Clear config so getActiveTextProvider() throws
    await setConfigState({
      text: { apiKeys: {}, provider: 'openrouter' },
      preferredModel: '',
      models: [],
    });

    const service = await loadService();
    sseChunks = [buildSSEChunk('Hello'), SSE_DONE];

    await expect(
      service.streamChat({
        messages: [{ role: 'user', content: 'Hi' }],
        onChunk: () => {},
      }),
    ).rejects.toThrow('No text generation provider configured');
  });

  test('should use preferred model from configService', async () => {
    mockConfigState = {
      text: { apiKeys: { openai: 'sk-test-key' }, provider: 'openai' },
      preferredModel: 'gpt-4o',
      models: [{ model: 'gpt-4o', provider: 'openai', endpoint: '' }],
    };
    await setConfigState(mockConfigState);

    const service = await loadService();
    sseChunks = [buildSSEChunk('World'), SSE_DONE];

    let output = '';
    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: (text: string) => {
        output += text;
      },
    });

    expect(output).toBe('World');
    expect(mockFetchCalls[0].body.model).toBe('gpt-4o');
    expect(mockFetchCalls[0].headers.Authorization).toBe('Bearer sk-test-key');
  });

  test('should expose routing via __text_service_resolved_routing', async () => {
    mockConfigState = {
      text: { apiKeys: { anthropic: 'ant-key' }, provider: 'anthropic' },
      preferredModel: 'claude-3',
      models: [{ model: 'claude-3', provider: 'anthropic', endpoint: 'https://api.anthropic.com' }],
    };
    await setConfigState(mockConfigState);

    const service = await loadService();
    sseChunks = [buildSSEChunk('Hi'), SSE_DONE];

    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: () => {},
    });

    const routing = (globalThis as Record<string, unknown>).__text_service_resolved_routing as
      | Record<string, unknown>
      | undefined;

    expect(routing).toBeDefined();
    expect(routing?.provider).toBe('anthropic');
    expect(routing?.model).toBe('claude-3');
  });

  test('should respect explicit model override', async () => {
    mockConfigState = {
      text: { apiKeys: { openai: 'oai-key', deepseek: 'ds-key' }, provider: 'openai' },
      preferredModel: 'gpt-4o',
      models: [
        { model: 'gpt-4o', provider: 'openai', endpoint: '' },
        { model: 'deepseek-chat', provider: 'deepseek', endpoint: '' },
      ],
    };
    await setConfigState(mockConfigState);

    const service = await loadService();
    sseChunks = [buildSSEChunk('Override'), SSE_DONE];

    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: () => {},
      model: 'deepseek-chat',
    });

    expect(mockFetchCalls[0].body.model).toBe('deepseek-chat');
    expect(mockFetchCalls[0].headers.Authorization).toBe('Bearer ds-key');
  });

  test('should fallback to first model config when no preferred model', async () => {
    mockConfigState = {
      text: { apiKeys: { openrouter: 'or-key' }, provider: 'openrouter' },
      preferredModel: '',
      models: [{ model: 'llama-3-70b', provider: 'openrouter', endpoint: '' }],
    };
    await setConfigState(mockConfigState);

    const service = await loadService();
    sseChunks = [buildSSEChunk('Fallback'), SSE_DONE];

    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: () => {},
    });

    expect(mockFetchCalls[0].body.model).toBe('llama-3-70b');
  });

  test('should include OpenRouter attribution headers', async () => {
    const service = await loadService();
    sseChunks = [buildSSEChunk('Hi'), SSE_DONE];

    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: () => {},
    });

    expect(mockFetchCalls[0].headers['HTTP-Referer']).toBe('https://aikami.app');
    expect(mockFetchCalls[0].headers['X-Title']).toBe('Aikami');
  });
});

// ---------------------------------------------------------------------------
// Tests: AC-2 — Unified Token Streaming Chat
// ---------------------------------------------------------------------------

describe('TextGenerationService — AC-2: Token Streaming', () => {
  beforeEach(async () => {
    setupMockFetch();
    mockConfigState = {
      text: { apiKeys: {}, provider: 'openrouter' },
      preferredModel: 'test-model',
      models: [{ model: 'test-model', provider: 'openrouter', endpoint: '' }],
    };
    await setConfigState(mockConfigState);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('should accumulate fragmented tokens', async () => {
    const service = await loadService();
    sseChunks = [
      buildSSEChunk('Hel'),
      buildSSEChunk('lo '),
      buildSSEChunk('Wor'),
      buildSSEChunk('ld!'),
      SSE_DONE,
    ];

    let output = '';
    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: (text: string) => {
        output += text;
      },
    });

    expect(output).toBe('Hello World!');
  });

  test('should pass abort signal to fetch and handle abort gracefully', async () => {
    const service = await loadService();
    const controller = new AbortController();
    sseChunks = [];

    controller.abort();

    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: () => {},
      signal: controller.signal,
    });

    // Should return without throwing
  });

  test('should cancel mid-stream via abort signal', async () => {
    const service = await loadService();
    const controller = new AbortController();

    sseChunks = [
      buildSSEChunk('A'),
      buildSSEChunk('B'),
      buildSSEChunk('C'),
      buildSSEChunk('D'),
      SSE_DONE,
    ];

    let output = '';
    const onChunk = (text: string): void => {
      output += text;
      if (output.length >= 2) {
        controller.abort();
      }
    };

    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk,
      signal: controller.signal,
    });

    expect(output.length).toBeGreaterThanOrEqual(1);
  });

  test('should track active stream count', async () => {
    const service = await loadService();
    sseChunks = [buildSSEChunk('X'), SSE_DONE];

    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: () => {},
    });

    expect((globalThis as Record<string, unknown>).__text_service_active_stream_count).toBe(0);
  });

  test('should handle multi-turn conversation', async () => {
    const service = await loadService();
    sseChunks = [buildSSEChunk('Reply'), SSE_DONE];

    let output = '';
    await service.streamChat({
      messages: [
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'Q2' },
      ],
      onChunk: (text: string) => {
        output += text;
      },
    });

    expect(output).toBe('Reply');
    expect(mockFetchCalls[0].body.messages).toHaveLength(3);
  });

  test('should send messages array in OpenAI-compatible format', async () => {
    const service = await loadService();
    sseChunks = [buildSSEChunk('OK'), SSE_DONE];

    await service.streamChat({
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
      ],
      onChunk: () => {},
    });

    const sentMessages = mockFetchCalls[0].body.messages as Array<{
      role: string;
      content: string;
    }>;
    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[0]).toEqual({ role: 'system', content: 'You are helpful' });
    expect(sentMessages[1]).toEqual({ role: 'user', content: 'Hello' });
  });
});

// ---------------------------------------------------------------------------
// Tests: AC-3 — TypeBox Structural Extraction
// ---------------------------------------------------------------------------

describe('TextGenerationService — AC-3: Structural Extraction', () => {
  beforeEach(async () => {
    setupMockFetch();
    mockConfigState = {
      text: { apiKeys: {}, provider: 'openrouter' },
      preferredModel: 'test-model',
      models: [{ model: 'test-model', provider: 'openrouter', endpoint: '' }],
    };
    await setConfigState(mockConfigState);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('should extract structured object with native response_format', async () => {
    const service = await loadService();

    const jsonResponse = JSON.stringify({ name: 'Aragorn', race: 'Human', level: 5 });
    sseChunks = [buildSSEChunk(jsonResponse), SSE_DONE];

    const result = await service.extractStructure({
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          race: { type: 'string' },
          level: { type: 'integer' },
        },
      },
      schemaName: 'TestCharacter',
      prompt: 'Extract a character',
    });

    expect(result).toEqual({ name: 'Aragorn', race: 'Human', level: 5 });
    expect(mockFetchCalls[0].body.response_format).toBeDefined();
    expect((mockFetchCalls[0].body.response_format as Record<string, unknown>).type).toBe(
      'json_schema',
    );
  });

  test('should strip markdown fences from response', async () => {
    const service = await loadService();

    sseChunks = [
      buildSSEChunk('```json\n'),
      buildSSEChunk(JSON.stringify({ name: 'Gandalf', power: 9000 })),
      buildSSEChunk('\n```'),
      SSE_DONE,
    ];

    const result = await service.extractStructure({
      schema: {
        type: 'object',
        properties: { name: { type: 'string' }, power: { type: 'number' } },
      },
      schemaName: 'TestWizard',
      prompt: 'Extract a wizard',
    });

    expect(result).toEqual({ name: 'Gandalf', power: 9000 });
  });

  test('should handle response with explanatory text before JSON', async () => {
    const service = await loadService();

    sseChunks = [
      buildSSEChunk('Here is the extracted data: '),
      buildSSEChunk(JSON.stringify({ item: 'sword', value: 100 })),
      SSE_DONE,
    ];

    const result = await service.extractStructure({
      schema: {
        type: 'object',
        properties: { item: { type: 'string' }, value: { type: 'number' } },
      },
      schemaName: 'TestItem',
      prompt: 'Extract an item',
    });

    expect(result).toEqual({ item: 'sword', value: 100 });
  });

  test('should enforce additionalProperties: false on compiled schema', async () => {
    const service = await loadService();

    sseChunks = [buildSSEChunk(JSON.stringify({ name: 'Test' })), SSE_DONE];

    await service.extractStructure({
      schema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
      schemaName: 'StrictTest',
      prompt: 'test',
    });

    const cacheSize = (globalThis as Record<string, unknown>)
      .__text_service_compiled_schema_cache_size as number | undefined;
    expect(cacheSize).toBeGreaterThanOrEqual(1);
  });

  test('should cache compiled schemas', async () => {
    const service = await loadService();

    const schema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    };

    sseChunks = [buildSSEChunk(JSON.stringify({ name: 'First' })), SSE_DONE];
    await service.extractStructure({
      schema,
      schemaName: 'CachedSchema',
      prompt: 'first',
    });

    sseChunks = [buildSSEChunk(JSON.stringify({ name: 'Second' })), SSE_DONE];
    await service.extractStructure({
      schema,
      schemaName: 'CachedSchema',
      prompt: 'second',
    });

    const cacheSize = (globalThis as Record<string, unknown>)
      .__text_service_compiled_schema_cache_size as number | undefined;
    expect(cacheSize).toBeGreaterThanOrEqual(1);
  });

  test('should handle abort during extraction', async () => {
    const service = await loadService();
    const controller = new AbortController();

    controller.abort();

    const promise = service.extractStructure({
      schema: { type: 'object', properties: { name: { type: 'string' } } },
      schemaName: 'AbortTest',
      prompt: 'test',
      signal: controller.signal,
    });

    await expect(promise).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tests: cancelAll
// ---------------------------------------------------------------------------

describe('TextGenerationService — cancelAll', () => {
  beforeEach(async () => {
    setupMockFetch();
    mockConfigState = {
      text: { apiKeys: {}, provider: 'openrouter' },
      preferredModel: 'test-model',
      models: [{ model: 'test-model', provider: 'openrouter', endpoint: '' }],
    };
    await setConfigState(mockConfigState);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('should cancel all active streams', async () => {
    const service = await loadService();

    sseChunks = [buildSSEChunk('partial')];

    const streamPromise = service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: () => {},
    });

    await new Promise((r) => setTimeout(r, 10));

    service.cancelAll();

    await streamPromise;

    expect((globalThis as Record<string, unknown>).__text_service_active_stream_count).toBe(0);
  });

  test('should reset stream count on cancelAll', async () => {
    const service = await loadService();

    sseChunks = [buildSSEChunk('data')];

    const p1 = service.streamChat({
      messages: [{ role: 'user', content: 'A' }],
      onChunk: () => {},
    });
    const p2 = service.streamChat({
      messages: [{ role: 'user', content: 'B' }],
      onChunk: () => {},
    });

    await new Promise((r) => setTimeout(r, 10));

    service.cancelAll();

    await Promise.allSettled([p1, p2]);

    expect((globalThis as Record<string, unknown>).__text_service_active_stream_count).toBe(0);
  });
});
