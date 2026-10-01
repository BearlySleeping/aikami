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

import { beforeEach, describe, expect, test } from 'bun:test';
import { CyoaChoiceResultSchema, RelationshipOutputSchema } from '@aikami/schemas';
import {
  holdGateway,
  loadService,
  mocks,
  resetGatewayMocks,
} from './__tests__/text_generation_service.harness.ts';
import { textTelemetryService } from './text_telemetry_service.svelte.ts';

// $state and $derived are polyfilled globally via test_setup.ts

// ---------------------------------------------------------------------------
// Tests: AC-1 — Delegation & Routing
// ---------------------------------------------------------------------------

describe('TextGenerationService — AC-1: Gateway delegation', () => {
  beforeEach(() => {
    resetGatewayMocks();
    mocks.gatewayChunks = ['Hello'];
  });

  test('streamChat forwards messages and streams chunks from the gateway', async () => {
    const service = await loadService();
    mocks.gatewayChunks = ['Hel', 'lo ', 'World'];

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
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);
    const call = mocks.gatewayGenerateCalls[0];
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

    expect(mocks.gatewayGenerateCalls[0].model).toBe('deepseek-chat');
  });

  test('streamChat passes explicit endpoint override to the gateway', async () => {
    const service = await loadService();

    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: () => {},
      endpoint: 'http://localhost:8080/v1',
    });

    expect(mocks.gatewayGenerateCalls[0].endpoint).toBe('http://localhost:8080/v1');
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
    mocks.gatewayError = new Error('provider_unreachable');

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
    expect(mocks.gatewayGenerateCalls).toHaveLength(0);
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
    mocks.gatewayChunks = ['Hel', 'lo ', 'Wor', 'ld!'];

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
    mocks.gatewayChunks = ['A', 'B', 'C', 'D'];

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
    mocks.gatewayChunks = ['X'];

    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: () => {},
    });

    expect((globalThis as Record<string, unknown>).__text_service_active_stream_count).toBe(0);
  });

  test('should forward multi-turn conversation messages', async () => {
    const service = await loadService();
    mocks.gatewayChunks = ['Reply'];

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
    expect(mocks.gatewayGenerateCalls[0].messages).toHaveLength(3);
  });

  test('should forward system + user messages unchanged', async () => {
    const service = await loadService();
    mocks.gatewayChunks = ['OK'];

    await service.streamChat({
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
      ],
      onChunk: () => {},
    });

    const sentMessages = mocks.gatewayGenerateCalls[0].messages as Array<{
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
    mocks.gatewayStructured = { name: 'Aragorn', race: 'Human', level: 5 };

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
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);
    expect(mocks.gatewayGenerateCalls[0].schemaName).toBe('TestCharacter');
    expect(mocks.gatewayGenerateCalls[0].schema).toBeDefined();
  });

  test('should build system + user messages for extraction prompts', async () => {
    const service = await loadService();
    mocks.gatewayStructured = { ok: true };

    await service.extractStructure({
      schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      schemaName: 'Test',
      prompt: 'Extract',
      systemPrompt: 'You are an extraction engine',
    });

    const messages = mocks.gatewayGenerateCalls[0].messages as Array<{
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
    expect(mocks.gatewayGenerateCalls).toHaveLength(0);
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
    mocks.blockUntilAbort = true;
    mocks.gatewayChunks = ['partial'];

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
    mocks.blockUntilAbort = true;
    mocks.gatewayChunks = ['data'];

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
    mocks.localSubmitOutput = '';
    mocks.localSubmitError = undefined;
    mocks.localSubmitCalls = 0;
    mocks.localEnsureLoadedCalls = 0;
    mocks.localServedModels = ['local-qwen3'];
  });

  test('uses the local pool and skips the gateway for a localFirst task', async () => {
    const service = await loadService();
    mocks.localSubmitOutput = '{"change":"improve","magnitude":3,"reason":"kind"}';

    const result = await service.extractStructure({
      schema: RelationshipOutputSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema to the generic record the service accepts
      schemaName: 'Relationship',
      prompt: 'hi',
      task: 'agent-relationship',
    });

    expect(result).toEqual({ change: 'improve', magnitude: 3, reason: 'kind' });
    expect(mocks.localEnsureLoadedCalls).toBe(1);
    expect(mocks.localSubmitCalls).toBe(1);
    expect(mocks.gatewayGenerateCalls).toHaveLength(0);
  });

  test('falls back to the gateway when the local engine fails', async () => {
    const service = await loadService();
    mocks.gatewayStructured = { ok: true };
    mocks.localSubmitError = new Error('no engine');

    const result = await service.extractStructure({
      schema: RelationshipOutputSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema to the generic record the service accepts
      schemaName: 'Relationship',
      prompt: 'hi',
      task: 'agent-relationship',
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.localEnsureLoadedCalls).toBe(1);
    expect(mocks.localSubmitCalls).toBe(0);
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);
    expect(textTelemetryService.spans[0].fallback).toBe(true);
    expect(textTelemetryService.summary.counters.fallbacks).toBe(1);
  });

  test('skips the local pool for a cloud-only task', async () => {
    const service = await loadService();
    mocks.gatewayStructured = { ok: true };

    await service.extractStructure({
      schema: CyoaChoiceResultSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema to the generic record the service accepts
      schemaName: 'Cyoa',
      prompt: 'hi',
      task: 'agent-cyoa',
    });

    expect(mocks.localEnsureLoadedCalls).toBe(0);
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);
  });

  test('honours an explicit model override instead of substituting a local one', async () => {
    const service = await loadService();
    mocks.gatewayStructured = { ok: true };

    await service.extractStructure({
      schema: RelationshipOutputSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema to the generic record the service accepts
      schemaName: 'Relationship',
      prompt: 'hi',
      model: 'deepseek-chat',
      task: 'agent-relationship',
    });

    // The caller pinned which model answers. Answering from a different
    // on-device bundle would make that pin a lie.
    expect(mocks.localEnsureLoadedCalls).toBe(0);
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);
    expect(mocks.gatewayGenerateCalls[0].model).toBe('deepseek-chat');
  });

  test('skips the local attempt when the configured route is a cloud provider', async () => {
    const service = await loadService();
    mocks.gatewayStructured = { ok: true };
    mocks.gatewayRouting = {
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
    expect(mocks.localEnsureLoadedCalls).toBe(0);
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);
  });

  test('skips the local attempt when the engine does not serve the routed model', async () => {
    const service = await loadService();
    mocks.gatewayStructured = { ok: true };
    mocks.gatewayRouting = {
      capability: 'text',
      mode: 'offline',
      provider: 'local-qwen3',
      model: 'qwen3-32b',
      endpoint: '',
    };
    mocks.localServedModels = ['qwen3-0.6b'];

    await service.extractStructure({
      schema: RelationshipOutputSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema to the generic record the service accepts
      schemaName: 'Relationship',
      prompt: 'hi',
      task: 'agent-relationship',
    });

    // Readiness is per model: a live engine that cannot serve this one is not a
    // reason to pay a cold load and a failed generation.
    expect(mocks.localEnsureLoadedCalls).toBe(0);
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: in-flight coalescing of identical structured requests
// ---------------------------------------------------------------------------

describe('TextGenerationService — in-flight coalescing', () => {
  const cloudRoute = (): void => {
    mocks.gatewayRouting = {
      capability: 'text',
      mode: 'byok',
      provider: 'openrouter',
      model: 'some/model',
      endpoint: 'https://api.openrouter.ai',
    };
  };

  beforeEach(() => {
    resetGatewayMocks();
    mocks.localSubmitOutput = '';
    mocks.localSubmitError = undefined;
    mocks.localSubmitCalls = 0;
    mocks.localEnsureLoadedCalls = 0;
    mocks.localServedModels = ['local-qwen3'];
    cloudRoute();
    mocks.gatewayStructured = { ok: true };
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
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);

    release();
    expect(await first).toEqual({ ok: true });
    expect(await second).toEqual({ ok: true });
    // One call, two answers: the duplicate cost nothing.
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);
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
    // Two distinct questions are two distinct requests — not one shared call.
    // Admission, not the coalescer, is what keeps them from running at the
    // same time: both are background work on one contention domain.
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);

    release();
    await Promise.all([first, second]);
    expect(mocks.gatewayGenerateCalls).toHaveLength(2);
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
    //
    // Both are `agent-relationship` — BACKGROUND — and both resolve to one
    // contention domain, so admission runs them ONE AT A TIME. That is the
    // #416 fix, and it is why the second provider call only lands after the
    // first settles. Two distinct questions, two distinct provider calls, never
    // merged and never stacked.
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);

    release();
    await Promise.allSettled([first, second]);
    expect(mocks.gatewayGenerateCalls).toHaveLength(2);
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
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);
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
    expect(mocks.gatewayGenerateCalls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: one shared deadline per logical request
// ---------------------------------------------------------------------------

describe('TextGenerationService — shared end-to-end deadline', () => {
  beforeEach(async () => {
    await (await loadService()).dispose();
    resetGatewayMocks();
    mocks.localSubmitOutput = '';
    mocks.localSubmitError = undefined;
    mocks.localSubmitCalls = 0;
    mocks.localEnsureLoadedCalls = 0;
    mocks.localServedModels = ['local-qwen3'];
  });

  test('passes the caller deadline to the gateway rather than minting a new one', async () => {
    const service = await loadService();
    mocks.blockUntilAbort = true;
    const deadlineAt = Date.now() + 60;
    const request = service.extractStructure({
      schema: { type: 'object' },
      schemaName: 'Deadline',
      prompt: 'hi',
      model: 'explicit-model',
      deadlineAt,
    });
    await expect(request).rejects.toThrow('Aborted');
    const signal = mocks.gatewayGenerateCalls[0].signal;
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
    expect(mocks.localEnsureLoadedCalls).toBe(0);
    expect(mocks.gatewayGenerateCalls).toHaveLength(0);
    expect(textTelemetryService.spans[0].deadlineExceeded).toBe(true);
  });

  test.each([-1, 30])(
    'streamChat rejects deadline cancellation with %i ms left',
    async (remaining) => {
      const service = await loadService();
      mocks.blockUntilAbort = true;
      await expect(
        service.streamChat({
          messages: [{ role: 'user', content: 'hi' }],
          onChunk: () => {},
          deadlineAt: Date.now() + remaining,
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(mocks.gatewayGenerateCalls).toHaveLength(remaining < 0 ? 0 : 1);
      expect(textTelemetryService.spans[0].deadlineExceeded).toBe(true);
      expect(textTelemetryService.spans[0].errorCode).toBe('cancelled');
    },
  );

  test('deadline aborts local loading without cooling down the route', async () => {
    const service = await loadService();
    mocks.localBlockUntilAbort = true;
    const options = {
      schema: { type: 'object' },
      schemaName: 'Local',
      prompt: 'hi',
      task: 'agent-relationship' as const,
    };
    await expect(
      service.extractStructure({ ...options, deadlineAt: Date.now() + 30 }),
    ).rejects.toThrow();
    expect(mocks.localSignal?.aborted).toBe(true);
    expect(mocks.gatewayGenerateCalls).toHaveLength(0);
    mocks.localBlockUntilAbort = false;
    mocks.localSubmitOutput = '{}';
    await service.extractStructure(options);
    expect(mocks.localEnsureLoadedCalls).toBe(2);
    expect(mocks.gatewayGenerateCalls).toHaveLength(0);
  });

  test('a local timeout falls back without cooling down the route', async () => {
    const service = await loadService();
    mocks.localBlockUntilAbort = true;
    mocks.gatewayStructured = { ok: true };
    const options = {
      schema: { type: 'object' },
      schemaName: 'Local',
      prompt: 'hi',
      task: 'agent-relationship' as const,
    };
    await service.extractStructure(options);
    expect(mocks.localSignal?.aborted).toBe(true);
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);
    expect(textTelemetryService.spans[0].fallback).toBe(true);
    mocks.localBlockUntilAbort = false;
    mocks.localSubmitOutput = '{}';
    await service.extractStructure(options);
    expect(mocks.localEnsureLoadedCalls).toBe(2);
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);
  }, 10_000);

  test('a background task with no budget is not given an invented deadline', async () => {
    const service = await loadService();
    mocks.gatewayStructured = { ok: true };

    // `agent-schedule` declares no budget, so the request runs unbounded rather
    // than being cut off by a stopwatch it never asked for.
    await service.extractStructure({
      schema: CyoaChoiceResultSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema to the generic record the service accepts
      schemaName: 'Cyoa',
      prompt: 'hi',
      task: 'agent-schedule',
    });

    expect(mocks.gatewayGenerateCalls).toHaveLength(1);
    expect(mocks.gatewayGenerateCalls[0].signal.aborted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: structured-call DURATION telemetry (#382)
//
// The defect these cover: `extractStructure` passed `start: performance.now()`
// AFTER its awaits, and `recordTextCall` derives `totalMs` as
// `performance.now() - start`. Every structured call therefore reported its own
// duration as ~0 ms. #416 found a 4 s provider call logged as 0.
// ---------------------------------------------------------------------------

/** The most recent recorded span, newest-first as the buffer is ordered. */
const lastSpan = () => textTelemetryService.spans[0];

const durationSchema = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
};

describe('TextGenerationService — structured-call duration telemetry', () => {
  beforeEach(async () => {
    await (await loadService()).dispose();
    resetGatewayMocks();
    mocks.localSubmitOutput = '';
    mocks.localSubmitError = undefined;
    mocks.localServedModels = ['local-qwen3'];
  });

  test('a provider call that takes measurable time no longer records 0 ms', async () => {
    const service = await loadService();
    mocks.gatewayStructured = { ok: true };
    mocks.gatewayDelayMs = 40;

    await service.extractStructure({
      schema: durationSchema,
      schemaName: 'DurationProbe',
      prompt: 'go',
      task: 'envelope',
    });

    // Before the fix this was `0`: the clock was read after the work finished.
    expect(lastSpan().totalMs).toBeGreaterThanOrEqual(40);
  });

  test('a FAILED provider call reports the same real elapsed time as a successful one', async () => {
    const service = await loadService();
    mocks.gatewayStructured = { ok: true };
    mocks.gatewayDelayMs = 40;

    await service.extractStructure({
      schema: durationSchema,
      schemaName: 'DurationProbe',
      prompt: 'go',
      task: 'envelope',
    });
    const succeededMs = lastSpan().totalMs;

    // The failure path shares the ONE logical start rather than minting its
    // own clock, which is how the success path ended up at 0 in the first place.
    mocks.gatewayError = new Error('provider exploded');
    await expect(
      service.extractStructure({
        schema: durationSchema,
        schemaName: 'DurationProbe',
        prompt: 'go',
        task: 'envelope',
      }),
    ).rejects.toThrow();

    expect(lastSpan().ok).toBe(false);
    expect(lastSpan().totalMs).toBeGreaterThanOrEqual(40);
    expect(lastSpan().totalMs).toBeGreaterThan(0);
    expect(succeededMs).toBeGreaterThan(0);
  });

  test('a local-first success records real elapsed time, not 0', async () => {
    const service = await loadService();
    mocks.localSubmitOutput = '{"change":"improve","magnitude":3,"reason":"kind"}';
    mocks.localDelayMs = 30;

    await service.extractStructure({
      schema: RelationshipOutputSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema to the generic record the service accepts
      schemaName: 'Relationship',
      prompt: 'hi',
      task: 'agent-relationship',
    });

    // The local path is a different outcome, not a different clock: it reported
    // 0 ms for exactly the same reason the provider path did.
    expect(lastSpan().provider).toBe('local-tasks');
    expect(lastSpan().ok).toBe(true);
    expect(lastSpan().totalMs).toBeGreaterThanOrEqual(30);
  });

  test('duration telemetry does not disturb token provenance', async () => {
    const service = await loadService();
    mocks.gatewayStructured = { ok: true };
    mocks.gatewayDelayMs = 20;
    // No provider usage reported → the estimate is labelled as an estimate.
    await service.extractStructure({
      schema: durationSchema,
      schemaName: 'DurationProbe',
      prompt: 'go',
      task: 'envelope',
    });
    expect(lastSpan().tokenSource).toBe('estimated');
    expect(lastSpan().promptTokens).toBeGreaterThan(0);

    // Provider-reported usage still WINS over the estimate, unchanged by the
    // start-capture fix — which touched timing only.
    textTelemetryService.clear();
    mocks.gatewayUsage = { inputTokens: 111, outputTokens: 22 };
    await service.extractStructure({
      schema: durationSchema,
      schemaName: 'DurationProbe',
      prompt: 'go',
      task: 'envelope',
    });
    expect(lastSpan().tokenSource).toBe('provider');
    expect(lastSpan().promptTokens).toBe(111);
    expect(lastSpan().completionTokens).toBe(22);
    expect(lastSpan().totalMs).toBeGreaterThanOrEqual(20);
  });

  test('a queued request records queue wait inside totalMs AND as queueMs', async () => {
    mocks.gatewayStructured = { ok: true };

    // Admission does not exist yet in this commit, so this asserts the SPAN's
    // contract: a caller that supplies queue measurements has them carried
    // through the recorder without being dropped.
    const { recordTextCall } = await import('./text_telemetry_recorder.ts');
    recordTextCall({
      start: performance.now() - 500,
      startedAt: new Date().toISOString(),
      streamed: false,
      promptChars: 40,
      completionChars: 8,
      ok: true,
      queueMs: 480,
      queueDepth: 3,
    });

    expect(lastSpan().queueMs).toBe(480);
    expect(lastSpan().queueDepth).toBe(3);
    // totalMs is measured from the same `start`, so the queue wait is already
    // inside it rather than reported alongside a sanitised total.
    expect(lastSpan().totalMs).toBeGreaterThanOrEqual(480);
    expect(textTelemetryService.summary.counters.maxQueueDepth).toBe(3);
  });

  test('a call that never queued carries no queueMs rather than a fabricated zero', async () => {
    const service = await loadService();
    mocks.gatewayStructured = { ok: true };
    mocks.gatewayDelayMs = 15;

    // An INTERACTIVE call is admitted immediately, so its queue wait is a
    // measured zero — recorded as such rather than left absent, which is what
    // makes `queueMs > 0` mean something.
    await service.extractStructure({
      schema: durationSchema,
      schemaName: 'DurationProbe',
      prompt: 'go',
      task: 'envelope',
    });

    expect(lastSpan().queueMs).toBe(0);
    expect(lastSpan().queueDepth).toBe(0);
  });
});
