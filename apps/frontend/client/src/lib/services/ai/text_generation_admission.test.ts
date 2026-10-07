// apps/frontend/client/src/lib/services/ai/text_generation_admission.test.ts
//
// Priority-aware inference admission, through the real service (issue #382).
//
// The service is the OWNER of admission, because it already owns the logical
// request's lifetime, caller abort linkage, the one absolute deadline, the
// local-first decision, the coalescer and the telemetry. These tests exercise
// it through the public API, which is the only place the ORDERING guarantees
// can be checked: the relative order of admission, coalescing and the provider
// call is invisible from inside any one of those modules.
//
// The single most important test here is "#411 IN-FLIGHT COALESCING SURVIVES
// admission". Putting the gate around each subscriber rather than around the
// shared work would serialize them, make them no longer simultaneous at the
// coalescer, and silently switch off #411 for exactly the case it exists for.
//
// Run with:
//   bun test --preload ./src/lib/test_setup.ts --tsconfig-override tsconfig.test.json \
//     src/lib/services/ai/text_generation_admission.test.ts

import { beforeEach, describe, expect, test } from 'bun:test';
import { RelationshipOutputSchema } from '@aikami/schemas';
import {
  holdGateway,
  loadService,
  mocks,
  resetGatewayMocks,
  setQuietWindow,
} from './__tests__/text_generation_service.harness.ts';
import { textTelemetryService } from './text_telemetry_service.svelte.ts';

const durationSchema = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
};

/** The most recent recorded span, newest-first as the buffer is ordered. */
const lastSpan = () => textTelemetryService.spans[0];

/** Awaits a turn of the event loop, so queued timers and microtasks settle. */
const tick = (ms = 20): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('TextGenerationService — inference admission', () => {
  beforeEach(async () => {
    await (await loadService()).dispose();
    resetGatewayMocks();
    mocks.localSubmitOutput = '';
    mocks.localSubmitError = undefined;
    mocks.localSubmitCalls = 0;
    mocks.localEnsureLoadedCalls = 0;
    mocks.localServedModels = ['local-qwen3'];
    mocks.gatewayRouting = {
      capability: 'text',
      mode: 'byok',
      provider: 'openrouter',
      model: 'some/model',
      endpoint: 'https://api.openrouter.ai',
    };
    mocks.gatewayStructured = { ok: true };
  });

  test('an interactive task reaches the provider with no queue wait', async () => {
    setQuietWindow(5_000);
    const service = await loadService();

    await service.extractStructure({
      schema: durationSchema,
      schemaName: 'AdmissionProbe',
      prompt: 'hello',
      task: 'envelope',
    });

    // Even with a five-second quiet window armed, interactive work does not
    // wait for it. Admission adds nothing to the player's latency.
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);
    expect(lastSpan().task).toBe('envelope');
    expect(lastSpan().queueMs).toBe(0);
    expect(lastSpan().queueDepth).toBe(0);
  });

  test('an UNTASKED call is treated as foreground', async () => {
    setQuietWindow(5_000);
    const service = await loadService();

    await service.extractStructure({
      schema: durationSchema,
      schemaName: 'AdmissionProbe',
      prompt: 'untasked',
    });

    // No classification is not permission to be deprioritised.
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);
    expect(lastSpan().queueMs).toBe(0);
  });

  test('a background task is deferred until the domain is quiet', async () => {
    setQuietWindow(150);
    const service = await loadService();

    const pending = service.extractStructure({
      schema: durationSchema,
      schemaName: 'AdmissionProbe',
      prompt: 'background',
      task: 'summarization',
    });

    await tick();
    // The window is armed and has not elapsed: nothing on the provider.
    expect(mocks.gatewayGenerateCalls).toHaveLength(0);

    await pending;
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);
    // The wait is recorded, and it is INSIDE totalMs — not reported beside a
    // sanitised duration.
    expect(lastSpan().task).toBe('summarization');
    expect(lastSpan().queueMs).toBeGreaterThanOrEqual(100);
    expect(lastSpan().totalMs).toBeGreaterThanOrEqual(Number(lastSpan().queueMs ?? 0));
    expect(textTelemetryService.summary.counters.maxQueueDepth).toBeGreaterThanOrEqual(0);
  });

  test('an interactive arrival during the window prevents the background dispatch', async () => {
    setQuietWindow(200);
    const service = await loadService();

    const background = service.extractStructure({
      schema: durationSchema,
      schemaName: 'AdmissionProbe',
      prompt: 'background',
      task: 'summarization',
    });

    await tick(120);
    expect(mocks.gatewayGenerateCalls).toHaveLength(0);

    // The player starts a conversation 120 ms into a 200 ms window.
    await service.extractStructure({
      schema: durationSchema,
      schemaName: 'AdmissionProbe',
      prompt: 'interactive',
      task: 'envelope',
    });
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);
    expect(mocks.gatewayGenerateCalls[0].task).toBe('envelope');

    // The window restarted from the interactive arrival, so at +200 ms from the
    // BACKGROUND request the background work still has not started.
    await tick(120);
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);

    await background;
    expect(mocks.gatewayGenerateCalls).toHaveLength(2);
    expect(mocks.gatewayGenerateCalls[1].task).toBe('summarization');
  });

  test('one background request at a time per contention domain', async () => {
    setQuietWindow(50);
    const service = await loadService();
    const release = holdGateway();

    const first = service.extractStructure({
      schema: durationSchema,
      schemaName: 'AdmissionProbe',
      prompt: 'npc-a',
      task: 'summarization',
    });
    const second = service.extractStructure({
      schema: durationSchema,
      schemaName: 'AdmissionProbe',
      prompt: 'npc-b',
      task: 'summarization',
    });

    await tick(80);
    // A 4-way burst must not become four concurrent 9B generations on one GPU.
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);
    release();

    await Promise.all([first, second]);
    expect(mocks.gatewayGenerateCalls).toHaveLength(2);
  });

  test('different contention domains are NOT serialized', async () => {
    setQuietWindow(50);
    const service = await loadService();
    const release = holdGateway();

    const onCloud = service.extractStructure({
      schema: durationSchema,
      schemaName: 'AdmissionProbe',
      prompt: 'cloud',
      task: 'summarization',
    });
    mocks.gatewayRouting = {
      capability: 'text',
      mode: 'offline',
      provider: 'ollama',
      model: 'ornith-1.5:9b',
      endpoint: 'http://127.0.0.1:11434/api/chat',
    };
    const onLocal = service.extractStructure({
      schema: durationSchema,
      schemaName: 'AdmissionProbe',
      prompt: 'local',
      task: 'summarization',
    });

    await tick(80);
    // Two independent devices must not queue behind one another.
    expect(mocks.gatewayGenerateCalls).toHaveLength(2);

    release();
    await Promise.all([onCloud, onLocal]);
  });

  test('caller cancellation while queued performs NO provider call', async () => {
    setQuietWindow(5_000);
    const service = await loadService();
    const quitter = new AbortController();

    const pending = service.extractStructure({
      schema: durationSchema,
      schemaName: 'AdmissionProbe',
      prompt: 'cancelled-in-queue',
      task: 'summarization',
      signal: quitter.signal,
    });

    await tick();
    quitter.abort();

    await expect(pending).rejects.toThrow();
    await tick(50);
    expect(mocks.gatewayGenerateCalls).toHaveLength(0);

    // Recorded honestly: it did not run, and it says so — AND it reports the
    // queue wait it actually incurred. Recording only the ADMITTED path would
    // make a call that waited in a queue look like one that never queued.
    expect(lastSpan().ok).toBe(false);
    expect(lastSpan().provider).toBe('openrouter');
    expect(Number(lastSpan().queueMs ?? -1)).toBeGreaterThanOrEqual(10);
    expect(lastSpan().queueDepth).toBeGreaterThanOrEqual(0);
  });

  test('deadline expiry while queued performs NO provider call', async () => {
    setQuietWindow(5_000);
    const service = await loadService();

    // `summarization` carries no budget of its own, so the caller supplies one:
    // admission must not mint a second, longer deadline to wait behind.
    const deadlineAt = Date.now() + 60;
    const pending = service.extractStructure({
      schema: durationSchema,
      schemaName: 'AdmissionProbe',
      prompt: 'expires-in-queue',
      task: 'summarization',
      deadlineAt,
    });

    await expect(pending).rejects.toThrow();
    expect(mocks.gatewayGenerateCalls).toHaveLength(0);
    // It expired rather than being cancelled by the user — a different outcome,
    // and one the telemetry must not conflate.
    expect(lastSpan().deadlineExceeded).toBe(true);
  });

  test('cancelAll cannot release queued work later', async () => {
    setQuietWindow(120);
    const service = await loadService();

    const pending = service.extractStructure({
      schema: durationSchema,
      schemaName: 'AdmissionProbe',
      prompt: 'queued-at-cancel',
      task: 'summarization',
    });

    await tick();
    expect(mocks.gatewayGenerateCalls).toHaveLength(0);

    service.cancelAll();
    await expect(pending).rejects.toThrow();

    // Long past the window it would have been admitted at.
    await tick(300);
    expect(mocks.gatewayGenerateCalls).toHaveLength(0);
  });

  test('dispose clears admission state and leaves the counters at zero', async () => {
    setQuietWindow(120);
    const service = await loadService();

    const pending = service.extractStructure({
      schema: durationSchema,
      schemaName: 'AdmissionProbe',
      prompt: 'queued-at-dispose',
      task: 'summarization',
    });
    await tick();
    await service.dispose();

    await expect(pending).rejects.toThrow();
    await tick(300);
    expect(mocks.gatewayGenerateCalls).toHaveLength(0);

    const stats = (globalThis as Record<string, unknown>).__text_service_admission_stats as Record<
      string,
      number
    >;
    expect(stats.backgroundQueued).toBe(0);
    expect(stats.backgroundActive).toBe(0);
    expect(stats.interactiveActive).toBe(0);
  });

  test('#411 IN-FLIGHT COALESCING SURVIVES admission', async () => {
    // The trap this guards: putting the gate around each SUBSCRIBER instead of
    // around the shared work would serialize them, so request A would complete
    // before request B was admitted, they would no longer be simultaneous at
    // the coalescer, and #411 would silently stop deduplicating exactly the
    // case it exists for.
    setQuietWindow(150);
    const service = await loadService();
    const release = holdGateway();

    const first = service.extractStructure({
      schema: durationSchema,
      schemaName: 'AdmissionProbe',
      prompt: 'identical',
      task: 'summarization',
    });
    const second = service.extractStructure({
      schema: durationSchema,
      schemaName: 'AdmissionProbe',
      prompt: 'identical',
      task: 'summarization',
    });

    await tick(250);
    // Both subscribers waited out ONE window and produced ONE provider call.
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);

    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);
    // The subscriber that did NOT start the attempt records no queue wait of
    // its own rather than borrowing the initiator's.
    const coalescedSpans = textTelemetryService.spans.filter(
      (span) => span.cacheLayer === 'in-flight-dedup',
    );
    expect(coalescedSpans).toHaveLength(1);
    expect(coalescedSpans[0].queueMs).toBeUndefined();
  });

  test('one coalesced subscriber cancelling does not cancel the shared call', async () => {
    setQuietWindow(150);
    const service = await loadService();
    const release = holdGateway();
    const quitter = new AbortController();

    const cancelled = service.extractStructure({
      schema: durationSchema,
      schemaName: 'AdmissionProbe',
      prompt: 'shared',
      task: 'summarization',
      signal: quitter.signal,
    });
    const survivor = service.extractStructure({
      schema: durationSchema,
      schemaName: 'AdmissionProbe',
      prompt: 'shared',
      task: 'summarization',
    });

    await tick(250);
    quitter.abort();
    await expect(cancelled).rejects.toThrow();

    release();
    expect(await survivor).toEqual({ ok: true });
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);
  });

  test('a provider error releases the lease and does not wedge the domain', async () => {
    setQuietWindow(20);
    const service = await loadService();

    mocks.gatewayError = new Error('provider exploded');
    await expect(
      service.extractStructure({
        schema: durationSchema,
        schemaName: 'AdmissionProbe',
        prompt: 'fails',
        task: 'summarization',
      }),
    ).rejects.toThrow();
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);

    // If the lease had leaked, the domain would be closed to background work
    // for the rest of the session — indistinguishable from starvation.
    mocks.gatewayError = undefined;
    await service.extractStructure({
      schema: durationSchema,
      schemaName: 'AdmissionProbe',
      prompt: 'after-failure',
      task: 'summarization',
    });
    expect(mocks.gatewayGenerateCalls).toHaveLength(2);
  });

  test('a stream success releases its interactive lease', async () => {
    setQuietWindow(120);
    const service = await loadService();
    mocks.gatewayChunks = ['Hello'];

    await service.streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: () => {},
      task: 'dialogue',
    });

    // A leaked interactive lease would keep background work out for the rest of
    // the session — indistinguishable, from the outside, from starvation.
    const after = (globalThis as Record<string, unknown>).__text_service_admission_stats as Record<
      string,
      number
    >;
    expect(after.interactiveActive).toBe(0);

    await service.extractStructure({
      schema: durationSchema,
      schemaName: 'AdmissionProbe',
      prompt: 'after-stream',
      task: 'summarization',
    });
    // Two calls: the stream, then the background one it unblocked.
    expect(mocks.gatewayGenerateCalls).toHaveLength(2);
    expect(mocks.gatewayGenerateCalls[1].task).toBe('summarization');
  });

  test('a stream failure releases its interactive lease', async () => {
    setQuietWindow(120);
    const service = await loadService();
    mocks.gatewayError = new Error('stream failed');

    await expect(
      service.streamChat({
        messages: [{ role: 'user', content: 'Hi' }],
        onChunk: () => {},
        task: 'dialogue',
      }),
    ).rejects.toThrow();

    const after = (globalThis as Record<string, unknown>).__text_service_admission_stats as Record<
      string,
      number
    >;
    expect(after.interactiveActive).toBe(0);

    mocks.gatewayError = undefined;
    await service.extractStructure({
      schema: durationSchema,
      schemaName: 'AdmissionProbe',
      prompt: 'after-stream-failure',
      task: 'summarization',
    });
    expect(mocks.gatewayGenerateCalls).toHaveLength(2);
    expect(mocks.gatewayGenerateCalls[1].task).toBe('summarization');
  });

  test('a local-first success is NOT gated by provider admission', async () => {
    setQuietWindow(5_000);
    const service = await loadService();
    mocks.gatewayRouting = {
      capability: 'text',
      mode: 'offline',
      provider: 'local-qwen3',
      model: 'local-qwen3',
      endpoint: '',
    };
    mocks.localSubmitOutput = '{"change":"improve","magnitude":3,"reason":"kind"}';

    await service.extractStructure({
      schema: RelationshipOutputSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema to the generic record the service accepts
      schemaName: 'Relationship',
      prompt: 'hi',
      task: 'agent-relationship',
    });

    // The on-device pool is a different resource, not the contended local
    // runtime. Queueing it behind provider admission would delay a player for
    // a resource that was never in conflict.
    expect(mocks.localSubmitCalls).toBe(1);
    expect(mocks.gatewayGenerateCalls).toHaveLength(0);
    expect(lastSpan().provider).toBe('local-tasks');
    expect(lastSpan().queueMs).toBeUndefined();
  });

  test('admission diagnostics expose separate interactive/background counts', async () => {
    setQuietWindow(200);
    const service = await loadService();

    const pending = service.extractStructure({
      schema: durationSchema,
      schemaName: 'AdmissionProbe',
      prompt: 'bg',
      task: 'summarization',
    });
    await tick();
    const stats = (globalThis as Record<string, unknown>).__text_service_admission_stats as Record<
      string,
      number
    >;
    expect(stats.backgroundQueued).toBe(1);
    expect(stats.backgroundActive).toBe(0);
    expect(stats.interactiveActive).toBe(0);
    // The logical-request counter is NOT reused for provider work: a queued
    // request is not provider-in-flight.
    expect((globalThis as Record<string, unknown>).__text_service_active_stream_count).toBe(1);

    await pending;
  });
});
