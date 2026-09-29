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
//   bun test --preload ./src/lib/test_setup.ts --tsconfig tsconfig.test.json \
//     src/lib/services/ai/text_generation_service.test.ts

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { CyoaChoiceResultSchema, RelationshipOutputSchema } from '@aikami/schemas';
import { textTelemetryService } from './text_telemetry_service.svelte.ts';

// $state and $derived are polyfilled globally via test_setup.ts

// ---------------------------------------------------------------------------
// Mock: aiGatewayService (the C-320 delegation target)
// ---------------------------------------------------------------------------

let gatewayGenerateCalls: Array<Record<string, unknown>> = [];
let gatewayChunks: string[] = [];
let gatewayStructured: unknown;
let gatewayError: unknown;
let blockUntilAbort = false;
/** Holds the NEXT gateway call open, so in-flight behaviour is observable. */
let gatewayGate: { promise: Promise<void>; release: () => void } | undefined;
/** The routing `resolveText` reports, so policy can be exercised per test. */
let gatewayRouting: Record<string, unknown> = {
  capability: 'text',
  mode: 'offline',
  provider: 'local-qwen3',
  model: '',
  endpoint: '',
};

const mockAiGatewayService = {
  resolveText: mock((options?: { model?: string; task?: string }) => ({
    ...gatewayRouting,
    ...(options?.model === undefined ? {} : { model: options.model }),
  })),
  generateText: mock(async (options: Record<string, unknown>) => {
    gatewayGenerateCalls.push(options);
    // A test may hold every gateway call open to observe what happens while a
    // request is genuinely in flight.
    if (gatewayGate) {
      const gate = gatewayGate;
      gatewayGate = undefined;
      await gate.promise;
    }
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

mock.module('./ai_gateway_service.svelte.ts', () => ({
  aiGatewayService: mockAiGatewayService,
  __esModule: true,
}));

// ---------------------------------------------------------------------------
// Mock: localTaskPoolService (local-first micro-task path)
// ---------------------------------------------------------------------------

let localBlockUntilAbort = false;
let localSignal: AbortSignal | undefined;
let localSubmitOutput = '';
let localSubmitError: unknown;
let localSubmitCalls = 0;
let localEnsureLoadedCalls = 0;
/** Model the fake engine claims to serve; drives readiness. */
let localServedModels: string[] = ['local-qwen3'];

const mockLocalPool = {
  ensureLoaded: mock(async (signal: AbortSignal) => {
    localEnsureLoadedCalls++;
    localSignal = signal;
    if (localBlockUntilAbort) {
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      throw new DOMException('Aborted', 'AbortError');
    }
    if (localSubmitError) {
      throw localSubmitError;
    }
  }),
  submit: mock(async () => {
    localSubmitCalls++;
    if (localSubmitError) {
      throw localSubmitError;
    }
    return { type: 'text', output: localSubmitOutput, latencyMs: 1, ok: true };
  }),
  readiness: {
    state: 'ready' as const,
    get servedModelIds() {
      return localServedModels;
    },
    confirmedModelIds: [] as string[],
  },
  canServeLocal: mock((model?: string) => {
    if (model === undefined || model.trim().length === 0) {
      return true;
    }
    return localServedModels.some((id) => id.toLowerCase() === model.toLowerCase());
  }),
};

mock.module('./local_task_pool_service.svelte.ts', () => ({
  localTaskPoolService: {
    pool: mockLocalPool,
    readiness: mockLocalPool.readiness,
    canServeLocal: mockLocalPool.canServeLocal,
  },
  __esModule: true,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const loadService = async () => {
  const mod = await import('./text_generation_service.svelte.ts');
  return mod.textGenerationService as import('./text_generation_service.svelte.ts').TextGenerationServiceInterface;
};

/** Holds the next gateway call open until the returned release is invoked. */
const holdGateway = (): (() => void) => {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  gatewayGate = { promise, release };
  return () => release();
};

const resetGatewayMocks = (): void => {
  gatewayGenerateCalls = [];
  gatewayChunks = [];
  gatewayStructured = undefined;
  gatewayError = undefined;
  blockUntilAbort = false;
  localBlockUntilAbort = false;
  localSignal = undefined;
  textTelemetryService.clear();
  gatewayGate = undefined;
  gatewayRouting = {
    capability: 'text',
    mode: 'offline',
    provider: 'local-qwen3',
    model: '',
    endpoint: '',
  };
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

  test('streamChat passes explicit endpoint override to the gateway', async () => {
    const service = await loadService();

    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: () => {},
      endpoint: 'http://localhost:8080/v1',
    });

    expect(gatewayGenerateCalls[0].endpoint).toBe('http://localhost:8080/v1');
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

// ---------------------------------------------------------------------------
// Tests: local-first micro-tasks — policy resolved BEFORE any local spend
// ---------------------------------------------------------------------------

describe('TextGenerationService — local-first micro-tasks', () => {
  beforeEach(async () => {
    await (await loadService()).dispose();
    resetGatewayMocks();
    localSubmitOutput = '';
    localSubmitError = undefined;
    localSubmitCalls = 0;
    localEnsureLoadedCalls = 0;
    localServedModels = ['local-qwen3'];
  });

  test('uses the local pool and skips the gateway for a localFirst task', async () => {
    const service = await loadService();
    localSubmitOutput = '{"change":"improve","magnitude":3,"reason":"kind"}';

    const result = await service.extractStructure({
      schema: RelationshipOutputSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema to the generic record the service accepts
      schemaName: 'Relationship',
      prompt: 'hi',
      task: 'agent-relationship',
    });

    expect(result).toEqual({ change: 'improve', magnitude: 3, reason: 'kind' });
    expect(localEnsureLoadedCalls).toBe(1);
    expect(localSubmitCalls).toBe(1);
    expect(gatewayGenerateCalls).toHaveLength(0);
  });

  test('falls back to the gateway when the local engine fails', async () => {
    const service = await loadService();
    gatewayStructured = { ok: true };
    localSubmitError = new Error('no engine');

    const result = await service.extractStructure({
      schema: RelationshipOutputSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema to the generic record the service accepts
      schemaName: 'Relationship',
      prompt: 'hi',
      task: 'agent-relationship',
    });

    expect(result).toEqual({ ok: true });
    expect(localEnsureLoadedCalls).toBe(1);
    expect(localSubmitCalls).toBe(0);
    expect(gatewayGenerateCalls).toHaveLength(1);
    expect(textTelemetryService.spans[0].fallback).toBe(true);
    expect(textTelemetryService.summary.counters.fallbacks).toBe(1);
  });

  test('skips the local pool for a cloud-only task', async () => {
    const service = await loadService();
    gatewayStructured = { ok: true };

    await service.extractStructure({
      schema: CyoaChoiceResultSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema to the generic record the service accepts
      schemaName: 'Cyoa',
      prompt: 'hi',
      task: 'agent-cyoa',
    });

    expect(localEnsureLoadedCalls).toBe(0);
    expect(gatewayGenerateCalls).toHaveLength(1);
  });

  test('honours an explicit model override instead of substituting a local one', async () => {
    const service = await loadService();
    gatewayStructured = { ok: true };

    await service.extractStructure({
      schema: RelationshipOutputSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema to the generic record the service accepts
      schemaName: 'Relationship',
      prompt: 'hi',
      model: 'deepseek-chat',
      task: 'agent-relationship',
    });

    // The caller pinned which model answers. Answering from a different
    // on-device bundle would make that pin a lie.
    expect(localEnsureLoadedCalls).toBe(0);
    expect(gatewayGenerateCalls).toHaveLength(1);
    expect(gatewayGenerateCalls[0].model).toBe('deepseek-chat');
  });

  test('skips the local attempt when the configured route is a cloud provider', async () => {
    const service = await loadService();
    gatewayStructured = { ok: true };
    gatewayRouting = {
      capability: 'text',
      mode: 'byok',
      provider: 'openrouter',
      model: 'some/model',
      endpoint: 'https://api.openrouter.ai',
    };

    await service.extractStructure({
      schema: RelationshipOutputSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema to the generic record the service accepts
      schemaName: 'Relationship',
      prompt: 'hi',
      task: 'agent-relationship',
    });

    // The task did not ask for an on-device detour, so it does not get one.
    expect(localEnsureLoadedCalls).toBe(0);
    expect(gatewayGenerateCalls).toHaveLength(1);
  });

  test('skips the local attempt when the engine does not serve the routed model', async () => {
    const service = await loadService();
    gatewayStructured = { ok: true };
    gatewayRouting = {
      capability: 'text',
      mode: 'offline',
      provider: 'local-qwen3',
      model: 'qwen3-32b',
      endpoint: '',
    };
    localServedModels = ['qwen3-0.6b'];

    await service.extractStructure({
      schema: RelationshipOutputSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema to the generic record the service accepts
      schemaName: 'Relationship',
      prompt: 'hi',
      task: 'agent-relationship',
    });

    // Readiness is per model: a live engine that cannot serve this one is not a
    // reason to pay a cold load and a failed generation.
    expect(localEnsureLoadedCalls).toBe(0);
    expect(gatewayGenerateCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: in-flight coalescing of identical structured requests
// ---------------------------------------------------------------------------

describe('TextGenerationService — in-flight coalescing', () => {
  const cloudRoute = (): void => {
    gatewayRouting = {
      capability: 'text',
      mode: 'byok',
      provider: 'openrouter',
      model: 'some/model',
      endpoint: 'https://api.openrouter.ai',
    };
  };

  beforeEach(() => {
    resetGatewayMocks();
    localSubmitOutput = '';
    localSubmitError = undefined;
    localSubmitCalls = 0;
    localEnsureLoadedCalls = 0;
    localServedModels = ['local-qwen3'];
    cloudRoute();
    gatewayStructured = { ok: true };
  });

  test('two identical concurrent requests make ONE provider call', async () => {
    const service = await loadService();
    const release = holdGateway();

    const first = service.extractStructure({
      schema: RelationshipOutputSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema to the generic record the service accepts
      schemaName: 'Relationship',
      prompt: 'same question',
      task: 'agent-relationship',
    });
    const second = service.extractStructure({
      schema: RelationshipOutputSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema to the generic record the service accepts
      schemaName: 'Relationship',
      prompt: 'same question',
      task: 'agent-relationship',
    });

    // Let both subscribers attach to the same in-flight attempt.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(gatewayGenerateCalls).toHaveLength(1);

    release();
    expect(await first).toEqual({ ok: true });
    expect(await second).toEqual({ ok: true });
    // One call, two answers: the duplicate cost nothing.
    expect(gatewayGenerateCalls).toHaveLength(1);
  });

  test('a different prompt is not coalesced', async () => {
    const service = await loadService();
    const release = holdGateway();

    const first = service.extractStructure({
      schema: RelationshipOutputSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema to the generic record the service accepts
      schemaName: 'Relationship',
      prompt: 'question one',
      task: 'agent-relationship',
    });
    const second = service.extractStructure({
      schema: RelationshipOutputSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema to the generic record the service accepts
      schemaName: 'Relationship',
      prompt: 'question two',
      task: 'agent-relationship',
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    // Two distinct questions are two distinct requests.
    expect(gatewayGenerateCalls).toHaveLength(2);

    release();
    await Promise.all([first, second]);
  });

  test('a different schema is not coalesced even with the same prompt', async () => {
    const service = await loadService();
    const release = holdGateway();

    const first = service.extractStructure({
      schema: RelationshipOutputSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema to the generic record the service accepts
      schemaName: 'Relationship',
      prompt: 'shared',
      task: 'agent-relationship',
    });
    const second = service.extractStructure({
      schema: CyoaChoiceResultSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema to the generic record the service accepts
      schemaName: 'Cyoa',
      prompt: 'shared',
      task: 'agent-relationship',
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    // The same prompt under a different schema is a different question, and
    // merging them would serve one request's answer to the other.
    expect(gatewayGenerateCalls).toHaveLength(2);

    release();
    await Promise.allSettled([first, second]);
  });

  test('cancelling ONE consumer does not cancel the other', async () => {
    const service = await loadService();
    const release = holdGateway();
    const quitter = new AbortController();

    const cancelled = service.extractStructure({
      schema: RelationshipOutputSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema to the generic record the service accepts
      schemaName: 'Relationship',
      prompt: 'shared question',
      task: 'agent-relationship',
      signal: quitter.signal,
    });
    const survivor = service.extractStructure({
      schema: RelationshipOutputSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema to the generic record the service accepts
      schemaName: 'Relationship',
      prompt: 'shared question',
      task: 'agent-relationship',
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    quitter.abort();
    await expect(cancelled).rejects.toThrow();

    // The shared call was NOT cancelled: somebody was still waiting for it.
    release();
    expect(await survivor).toEqual({ ok: true });
    expect(gatewayGenerateCalls).toHaveLength(1);
  });

  test('a request after a settled one is NOT replayed from a cache', async () => {
    const service = await loadService();

    await service.extractStructure({
      schema: RelationshipOutputSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema to the generic record the service accepts
      schemaName: 'Relationship',
      prompt: 'sequential',
      task: 'agent-relationship',
    });
    await service.extractStructure({
      schema: RelationshipOutputSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema to the generic record the service accepts
      schemaName: 'Relationship',
      prompt: 'sequential',
      task: 'agent-relationship',
    });

    // This coalesces IN-FLIGHT work only. Reusing a settled answer across calls
    // is a separate decision with separate correctness requirements.
    expect(gatewayGenerateCalls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: one shared deadline per logical request
// ---------------------------------------------------------------------------

describe('TextGenerationService — shared end-to-end deadline', () => {
  beforeEach(async () => {
    await (await loadService()).dispose();
    resetGatewayMocks();
    localSubmitOutput = '';
    localSubmitError = undefined;
    localSubmitCalls = 0;
    localEnsureLoadedCalls = 0;
    localServedModels = ['local-qwen3'];
  });

  test('passes the caller deadline to the gateway rather than minting a new one', async () => {
    const service = await loadService();
    blockUntilAbort = true;
    const deadlineAt = Date.now() + 60;
    const request = service.extractStructure({
      schema: { type: 'object' },
      schemaName: 'Deadline',
      prompt: 'hi',
      model: 'explicit-model',
      deadlineAt,
    });
    await expect(request).rejects.toThrow('Aborted');
    const signal = gatewayGenerateCalls[0].signal;
    if (!(signal instanceof AbortSignal)) {
      throw new Error('Missing gateway signal');
    }
    expect(signal.aborted).toBe(true);
    expect(Date.now() - deadlineAt).toBeGreaterThanOrEqual(-5);
    expect(Date.now() - deadlineAt).toBeLessThan(150);
    expect(textTelemetryService.spans[0].deadlineExceeded).toBe(true);
  });

  test('an expired caller deadline dispatches neither local nor gateway work', async () => {
    const service = await loadService();
    await expect(
      service.extractStructure({
        schema: { type: 'object' },
        schemaName: 'Deadline',
        prompt: 'hi',
        task: 'agent-relationship',
        deadlineAt: Date.now() - 1,
      }),
    ).rejects.toThrow('Request deadline exceeded');
    expect(localEnsureLoadedCalls).toBe(0);
    expect(gatewayGenerateCalls).toHaveLength(0);
    expect(textTelemetryService.spans[0].deadlineExceeded).toBe(true);
  });

  test.each([-1, 30])(
    'streamChat rejects deadline cancellation with %i ms left',
    async (remaining) => {
      const service = await loadService();
      blockUntilAbort = true;
      await expect(
        service.streamChat({
          messages: [{ role: 'user', content: 'hi' }],
          onChunk: () => {},
          deadlineAt: Date.now() + remaining,
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(gatewayGenerateCalls).toHaveLength(remaining < 0 ? 0 : 1);
      expect(textTelemetryService.spans[0].deadlineExceeded).toBe(true);
      expect(textTelemetryService.spans[0].errorCode).toBe('cancelled');
    },
  );

  test('deadline aborts local loading without cooling down the route', async () => {
    const service = await loadService();
    localBlockUntilAbort = true;
    const options = {
      schema: { type: 'object' },
      schemaName: 'Local',
      prompt: 'hi',
      task: 'agent-relationship' as const,
    };
    await expect(
      service.extractStructure({ ...options, deadlineAt: Date.now() + 30 }),
    ).rejects.toThrow();
    expect(localSignal?.aborted).toBe(true);
    expect(gatewayGenerateCalls).toHaveLength(0);
    localBlockUntilAbort = false;
    localSubmitOutput = '{}';
    await service.extractStructure(options);
    expect(localEnsureLoadedCalls).toBe(2);
    expect(gatewayGenerateCalls).toHaveLength(0);
  });

  test('a local timeout falls back without cooling down the route', async () => {
    const service = await loadService();
    localBlockUntilAbort = true;
    gatewayStructured = { ok: true };
    const options = {
      schema: { type: 'object' },
      schemaName: 'Local',
      prompt: 'hi',
      task: 'agent-relationship' as const,
    };
    await service.extractStructure(options);
    expect(localSignal?.aborted).toBe(true);
    expect(gatewayGenerateCalls).toHaveLength(1);
    expect(textTelemetryService.spans[0].fallback).toBe(true);
    localBlockUntilAbort = false;
    localSubmitOutput = '{}';
    await service.extractStructure(options);
    expect(localEnsureLoadedCalls).toBe(2);
    expect(gatewayGenerateCalls).toHaveLength(1);
  }, 10_000);

  test('a background task with no budget is not given an invented deadline', async () => {
    const service = await loadService();
    gatewayStructured = { ok: true };

    // `agent-schedule` declares no budget, so the request runs unbounded rather
    // than being cut off by a stopwatch it never asked for.
    await service.extractStructure({
      schema: CyoaChoiceResultSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema to the generic record the service accepts
      schemaName: 'Cyoa',
      prompt: 'hi',
      task: 'agent-schedule',
    });

    expect(gatewayGenerateCalls).toHaveLength(1);
    expect(gatewayGenerateCalls[0].signal.aborted).toBe(false);
  });
});
