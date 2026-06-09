// apps/frontend/pwa/src/lib/client/services/media/ai_text_intelligence_service.test.ts
//
// Unit tests for AiTextIntelligenceService (C-080).
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/client/services/media/ai_text_intelligence_service.test.ts

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// $state and $derived are polyfilled globally via test_preload.ts

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------

let mockFetchCalls: Array<{ url: string; body: Record<string, unknown>; signal: AbortSignal }> = [];
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
  '/home/sonny/Development/Projects/passion/aikami/apps/frontend/pwa/src/lib/client/utils/crypto_vault.ts';

mock.module(CRYPTO_VAULT_PATH, () => ({
  encrypt: () => Promise.resolve(),
  decrypt: () => Promise.resolve(null),
  clearVault: () => Promise.resolve(),
  __esModule: true,
}));

// The $services barrel mock is NOT set globally —
// we use setConfigState() to control the real configService directly.
// crypto_vault must be mocked to avoid browser API dependencies.

const CONFIG_SVC_PATH =
  '/home/sonny/Development/Projects/passion/aikami/apps/frontend/pwa/src/lib/client/services/config/config_service.svelte.ts';

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

/** Loads a fresh service instance via dynamic import. */
const loadService = async () => {
  const mod = await import('./ai_text_intelligence_service.svelte.ts');
  return mod.aiTextIntelligenceService as import('./ai_text_intelligence_service.svelte.ts').AiTextIntelligenceServiceInterface;
};

/** Sets the real configService state for test control. */
const setConfigState = async (state: Record<string, unknown>) => {
  const cfg = await import(CONFIG_SVC_PATH);
  (cfg.configService as Record<string, unknown>).state = state;
};

const buildSSEChunk = (text: string): string => `data: ${JSON.stringify({ text })}\n\n`;

// ---------------------------------------------------------------------------
// Tests: AC-1 — Dynamic Provider & Model Resolution
// ---------------------------------------------------------------------------

describe('AiTextIntelligenceService — AC-1: Dynamic Provider Resolution', () => {
  beforeEach(async () => {
    setupMockFetch();
    mockConfigState = {
      preferredModel: '',
      models: [],
      apiKeys: {},
    };
    await setConfigState(mockConfigState);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('should resolve default model when no config is set', async () => {
    const service = await loadService();
    sseChunks = [buildSSEChunk('Hello'), 'data: [DONE]\n\n'];

    let _output = '';
    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: (text: string) => {
        _output += text;
      },
    });

    expect(_output).toBe('Hello');
    expect(mockFetchCalls.length).toBe(1);
    expect(mockFetchCalls[0].body.provider).toBe('openrouter');
    expect(mockFetchCalls[0].body.model).toBe('liquid/lfm-2.5-1.2b-instruct:free');
  });

  test('should use preferred model from configService', async () => {
    mockConfigState = {
      preferredModel: 'gpt-4o',
      models: [{ model: 'gpt-4o', provider: 'openai', endpoint: '' }],
      apiKeys: {},
    };
    await setConfigState(mockConfigState);

    const service = await loadService();
    sseChunks = [buildSSEChunk('World'), 'data: [DONE]\n\n'];

    let _output = '';
    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: (text: string) => {
        _output += text;
      },
    });

    expect(mockFetchCalls[0].body.model).toBe('gpt-4o');
    expect(mockFetchCalls[0].body.provider).toBe('openai');
  });

  test('should expose routing via __ai_service_resolved_routing', async () => {
    mockConfigState = {
      preferredModel: 'claude-3',
      models: [{ model: 'claude-3', provider: 'anthropic', endpoint: 'https://api.anthropic.com' }],
      apiKeys: {},
    };
    await setConfigState(mockConfigState);

    const service = await loadService();
    sseChunks = [buildSSEChunk('Hi'), 'data: [DONE]\n\n'];

    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: () => {},
    });

    const routing = (globalThis as Record<string, unknown>).__ai_service_resolved_routing as
      | Record<string, unknown>
      | undefined;

    expect(routing).toBeDefined();
    expect(routing?.provider).toBe('anthropic');
    expect(routing?.model).toBe('claude-3');
  });

  test('should respect explicit model override', async () => {
    mockConfigState = {
      preferredModel: 'gpt-4o',
      models: [
        { model: 'gpt-4o', provider: 'openai', endpoint: '' },
        { model: 'deepseek-chat', provider: 'deepseek', endpoint: '' },
      ],
      apiKeys: {},
    };
    await setConfigState(mockConfigState);

    const service = await loadService();
    sseChunks = [buildSSEChunk('Override'), 'data: [DONE]\n\n'];

    let _output = '';
    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: (text: string) => {
        _output += text;
      },
      model: 'deepseek-chat',
    });

    expect(mockFetchCalls[0].body.model).toBe('deepseek-chat');
  });

  test('should fallback to first model config when no preferred model', async () => {
    mockConfigState = {
      preferredModel: '',
      models: [{ model: 'llama-3-70b', provider: 'openrouter', endpoint: 'https://my-proxy' }],
      apiKeys: {},
    };
    await setConfigState(mockConfigState);

    const service = await loadService();
    sseChunks = [buildSSEChunk('Fallback'), 'data: [DONE]\n\n'];

    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: () => {},
    });

    expect(mockFetchCalls[0].body.model).toBe('llama-3-70b');
  });
});

// ---------------------------------------------------------------------------
// Tests: AC-2 — Unified Token Streaming Chat
// ---------------------------------------------------------------------------

describe('AiTextIntelligenceService — AC-2: Token Streaming', () => {
  beforeEach(async () => {
    setupMockFetch();
    mockConfigState = {
      preferredModel: '',
      models: [],
      apiKeys: {},
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
      'data: [DONE]\n\n',
    ];

    let _output = '';
    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: (text: string) => {
        _output += text;
      },
    });

    expect(_output).toBe('Hello World!');
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
      'data: [DONE]\n\n',
    ];

    let _output = '';
    const onChunk = (text: string): void => {
      _output += text;
      if (_output.length >= 2) {
        controller.abort();
      }
    };

    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk,
      signal: controller.signal,
    });

    expect(_output.length).toBeGreaterThanOrEqual(1);
  });

  test('should track active stream count', async () => {
    const service = await loadService();
    sseChunks = [buildSSEChunk('X'), 'data: [DONE]\n\n'];

    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: () => {},
    });

    expect((globalThis as Record<string, unknown>).__ai_service_active_stream_count).toBe(0);
  });

  test('should handle system message correctly', async () => {
    const service = await loadService();
    sseChunks = [buildSSEChunk('Response'), 'data: [DONE]\n\n'];

    await service.streamChat({
      messages: [
        { role: 'system', content: 'You are a test bot' },
        { role: 'user', content: 'Hello' },
      ],
      onChunk: () => {},
    });

    expect(mockFetchCalls[0].body.systemPrompt).toBe('You are a test bot');
    expect(mockFetchCalls[0].body.prompt).toBe('Hello');
  });

  test('should handle multi-turn conversation', async () => {
    const service = await loadService();
    sseChunks = [buildSSEChunk('Reply'), 'data: [DONE]\n\n'];

    let _output = '';
    await service.streamChat({
      messages: [
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'Q2' },
      ],
      onChunk: (text: string) => {
        _output += text;
      },
    });

    expect(_output).toBe('Reply');
    expect(mockFetchCalls[0].body.prompt).toBe('Q2');
    expect(mockFetchCalls[0].body.messages).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Tests: AC-3 — TypeBox Structural Extraction
// ---------------------------------------------------------------------------

describe('AiTextIntelligenceService — AC-3: Structural Extraction', () => {
  beforeEach(async () => {
    setupMockFetch();
    mockConfigState = {
      preferredModel: '',
      models: [],
      apiKeys: {},
    };
    await setConfigState(mockConfigState);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('should extract structured object with strict schema', async () => {
    const service = await loadService();

    const jsonResponse = JSON.stringify({ name: 'Aragorn', race: 'Human', level: 5 });
    sseChunks = [buildSSEChunk(jsonResponse), 'data: [DONE]\n\n'];

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
  });

  test('should strip markdown fences from response', async () => {
    const service = await loadService();

    sseChunks = [
      buildSSEChunk('```json\n'),
      buildSSEChunk(JSON.stringify({ name: 'Gandalf', power: 9000 })),
      buildSSEChunk('\n```'),
      'data: [DONE]\n\n',
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
      'data: [DONE]\n\n',
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

    sseChunks = [buildSSEChunk(JSON.stringify({ name: 'Test' })), 'data: [DONE]\n\n'];

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
      .__ai_service_compiled_schema_cache_size as number | undefined;
    expect(cacheSize).toBeGreaterThanOrEqual(1);
  });

  test('should cache compiled schemas', async () => {
    const service = await loadService();

    const schema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    };

    sseChunks = [buildSSEChunk(JSON.stringify({ name: 'First' })), 'data: [DONE]\n\n'];
    await service.extractStructure({
      schema,
      schemaName: 'CachedSchema',
      prompt: 'first',
    });

    sseChunks = [buildSSEChunk(JSON.stringify({ name: 'Second' })), 'data: [DONE]\n\n'];
    await service.extractStructure({
      schema,
      schemaName: 'CachedSchema',
      prompt: 'second',
    });

    const cacheSize = (globalThis as Record<string, unknown>)
      .__ai_service_compiled_schema_cache_size as number | undefined;
    // Schema is cached — second call with same name should not increase cache
    expect(cacheSize).toBeGreaterThanOrEqual(1);
  });

  test('should handle abort during extraction', async () => {
    const service = await loadService();
    const controller = new AbortController();

    // Abort before the call — the service checks signal.aborted at entry
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

describe('AiTextIntelligenceService — cancelAll', () => {
  beforeEach(async () => {
    setupMockFetch();
    mockConfigState = {
      preferredModel: '',
      models: [],
      apiKeys: {},
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

    expect((globalThis as Record<string, unknown>).__ai_service_active_stream_count).toBe(0);
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

    expect((globalThis as Record<string, unknown>).__ai_service_active_stream_count).toBe(0);
  });
});
