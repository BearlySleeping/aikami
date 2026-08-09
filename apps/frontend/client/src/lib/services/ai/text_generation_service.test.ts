// apps/frontend/client/src/lib/services/ai/text_generation_service.test.ts
//
// Unit tests for TextGenerationService (C-080).
//
// Since C-320 the service delegates provider routing, HTTP transport and
// structured extraction to the AI Provider Gateway (aiGatewayService). These
// tests verify the client service's own contract: argument forwarding,
// chunk streaming, cancellation handling, routing exposure, and stream
// accounting. Gateway-level behaviors (SSE parsing, schema compilation,
// markdown sanitization, provider detection) are covered by the
// @aikami/frontend/ai-gateway test suite.
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/services/ai/text_generation_service.test.ts

import { beforeEach, describe, expect, mock, test } from 'bun:test';

// $state and $derived are polyfilled globally via test_preload.ts

// ---------------------------------------------------------------------------
// Mock: aiGatewayService (the C-320 delegation target)
// ---------------------------------------------------------------------------

let gatewayGenerateCalls: Array<Record<string, unknown>> = [];
let gatewayChunks: string[] = [];
let gatewayStructured: unknown;
let gatewayError: unknown;
let blockUntilAbort = false;

const mockAiGatewayService = {
  generateText: mock(async (options: Record<string, unknown>) => {
    gatewayGenerateCalls.push(options);
    const { onChunk, onResolve, signal, model } = options as {
      onChunk?: (text: string) => void;
      onResolve?: (resolution: unknown) => void;
      signal?: AbortSignal;
      model?: string;
    };

    if (gatewayError) {
      throw gatewayError;
    }

    onResolve?.({
      provider: 'openrouter',
      model: model ?? 'test-model',
      endpoint: 'https://api.openrouter.ai',
    });

    if (onChunk) {
      for (const chunk of gatewayChunks) {
        onChunk(chunk);
      }
    }

    // Optional hang used by cancelAll tests: resolve only when aborted.
    if (blockUntilAbort && signal) {
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
    }

    if (signal?.aborted) {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      throw error;
    }

    return { text: gatewayChunks.join(''), structured: gatewayStructured };
  }),
  cancelAll: mock(() => {}),
};

mock.module('$services', () => ({
  aiGatewayService: mockAiGatewayService,
  __esModule: true,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const loadService = async () => {
  const mod = await import('./text_generation_service.svelte.ts');
  return mod.textGenerationService as import('./text_generation_service.svelte.ts').TextGenerationServiceInterface;
};

const resetGatewayMocks = (): void => {
  gatewayGenerateCalls = [];
  gatewayChunks = [];
  gatewayStructured = undefined;
  gatewayError = undefined;
  blockUntilAbort = false;
};

// ---------------------------------------------------------------------------
// Tests: AC-1 — Delegation & Routing
// ---------------------------------------------------------------------------

describe('TextGenerationService — AC-1: Gateway delegation', () => {
  beforeEach(() => {
    resetGatewayMocks();
    gatewayChunks = ['Hello'];
  });

  test('streamChat forwards messages and streams chunks from the gateway', async () => {
    const service = await loadService();
    gatewayChunks = ['Hel', 'lo ', 'World'];

    let output = '';
    await service.streamChat({
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
      ],
      onChunk: (text: string) => {
        output += text;
      },
    });

    expect(output).toBe('Hello World');
    expect(gatewayGenerateCalls).toHaveLength(1);
    const call = gatewayGenerateCalls[0];
    expect(call.messages).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
    ]);
    expect(typeof call.onChunk).toBe('function');
    expect(call.signal).toBeInstanceOf(AbortSignal);
  });

  test('streamChat passes explicit model override to the gateway', async () => {
    const service = await loadService();

    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: () => {},
      model: 'deepseek-chat',
    });

    expect(gatewayGenerateCalls[0].model).toBe('deepseek-chat');
  });

  test('streamChat exposes resolved routing via __text_service_resolved_routing', async () => {
    const service = await loadService();

    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: () => {},
    });

    const routing = (globalThis as Record<string, unknown>).__text_service_resolved_routing as
      | Record<string, unknown>
      | undefined;

    expect(routing).toBeDefined();
    expect(routing?.provider).toBe('openrouter');
    expect(routing?.model).toBe('test-model');
  });

  test('streamChat rethrows non-cancellation gateway errors', async () => {
    const service = await loadService();
    gatewayError = new Error('provider_unreachable');

    await expect(
      service.streamChat({
        messages: [{ role: 'user', content: 'Hi' }],
        onChunk: () => {},
      }),
    ).rejects.toThrow('provider_unreachable');
  });

  test('streamChat returns early when the signal is already aborted', async () => {
    const service = await loadService();
    const controller = new AbortController();
    controller.abort();

    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: () => {},
      signal: controller.signal,
    });

    // No gateway call should have been made.
    expect(gatewayGenerateCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: AC-2 — Token Streaming & Cancellation
// ---------------------------------------------------------------------------

describe('TextGenerationService — AC-2: Token Streaming', () => {
  beforeEach(() => {
    resetGatewayMocks();
  });

  test('should accumulate fragmented tokens', async () => {
    const service = await loadService();
    gatewayChunks = ['Hel', 'lo ', 'Wor', 'ld!'];

    let output = '';
    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: (text: string) => {
        output += text;
      },
    });

    expect(output).toBe('Hello World!');
  });

  test('should swallow abort cancellation mid-stream', async () => {
    const service = await loadService();
    const controller = new AbortController();
    gatewayChunks = ['A', 'B', 'C', 'D'];

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
    gatewayChunks = ['X'];

    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: () => {},
    });

    expect((globalThis as Record<string, unknown>).__text_service_active_stream_count).toBe(0);
  });

  test('should forward multi-turn conversation messages', async () => {
    const service = await loadService();
    gatewayChunks = ['Reply'];

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
    expect(gatewayGenerateCalls[0].messages).toHaveLength(3);
  });

  test('should forward system + user messages unchanged', async () => {
    const service = await loadService();
    gatewayChunks = ['OK'];

    await service.streamChat({
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
      ],
      onChunk: () => {},
    });

    const sentMessages = gatewayGenerateCalls[0].messages as Array<{
      role: string;
      content: string;
    }>;
    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[0]).toEqual({ role: 'system', content: 'You are helpful' });
    expect(sentMessages[1]).toEqual({ role: 'user', content: 'Hello' });
  });
});

// ---------------------------------------------------------------------------
// Tests: AC-3 — Structural Extraction Delegation
// ---------------------------------------------------------------------------

describe('TextGenerationService — AC-3: Structural Extraction', () => {
  beforeEach(() => {
    resetGatewayMocks();
  });

  test('should return structured output from the gateway', async () => {
    const service = await loadService();
    gatewayStructured = { name: 'Aragorn', race: 'Human', level: 5 };

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
    expect(gatewayGenerateCalls).toHaveLength(1);
    expect(gatewayGenerateCalls[0].schemaName).toBe('TestCharacter');
    expect(gatewayGenerateCalls[0].schema).toBeDefined();
  });

  test('should build system + user messages for extraction prompts', async () => {
    const service = await loadService();
    gatewayStructured = { ok: true };

    await service.extractStructure({
      schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      schemaName: 'Test',
      prompt: 'Extract',
      systemPrompt: 'You are an extraction engine',
    });

    const messages = gatewayGenerateCalls[0].messages as Array<{
      role: string;
      content: string;
    }>;
    expect(messages).toEqual([
      { role: 'system', content: 'You are an extraction engine' },
      { role: 'user', content: 'Extract' },
    ]);
  });

  test('should reject when the signal is already aborted', async () => {
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
    // No gateway call should have been made.
    expect(gatewayGenerateCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: cancelAll
// ---------------------------------------------------------------------------

describe('TextGenerationService — cancelAll', () => {
  beforeEach(() => {
    resetGatewayMocks();
  });

  test('should cancel all active streams and reset the stream count', async () => {
    const service = await loadService();
    blockUntilAbort = true;
    gatewayChunks = ['partial'];

    const streamPromise = service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: () => {},
    });

    // Let the stream start and block on the abort signal.
    await new Promise((r) => setTimeout(r, 10));

    service.cancelAll();

    await streamPromise;

    expect((globalThis as Record<string, unknown>).__text_service_active_stream_count).toBe(0);
  });

  test('should cancel multiple active streams', async () => {
    const service = await loadService();
    blockUntilAbort = true;
    gatewayChunks = ['data'];

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
