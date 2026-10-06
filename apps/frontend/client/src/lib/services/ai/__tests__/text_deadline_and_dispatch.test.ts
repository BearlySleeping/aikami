// apps/frontend/client/src/lib/services/ai/__tests__/text_deadline_and_dispatch.test.ts
//
// SCENARIO: the caller's budget and the caller's route reach the transport.
//
// Two defects, one file, because both are the same shape of bug — a fact the
// caller established and the transport never received:
//
//   1. `streamChat` and the structured path built a deadline and then sent the
//      gateway a bare `signal`. The adapter, which is the only layer that can
//      stop a request, saw a 120 s dialogue budget and installed its own 90 s
//      safety watchdog over the top of it. The dialogue was cut at 90 s with
//      no error naming the cause, because from the adapter's point of view
//      nothing was wrong: it had simply never been told the budget existed.
//
//   2. The service resolved a route for admission, built a coalescing identity
//      and a contention domain from it, and then let the gateway resolve a
//      SECOND time at dispatch. A settings change in between produced a request
//      admitted against route A, keyed under route A, dispatched to route B.
//
// These run through the real `TextGenerationService` with the shared harness,
// because both defects are in the seam between the service and the transport
// and neither is observable from inside either module.

import { beforeEach, describe, expect, test } from 'bun:test';
import { textTelemetryService } from '../text_telemetry_service.svelte.ts';
import {
  holdGateway,
  loadService,
  mocks,
  resetGatewayMocks,
  setGatewayRouting,
  setGatewayStructured,
  setQuietWindow,
} from './text_generation_service.harness.ts';

const SCHEMA = {
  type: 'object',
  properties: { verdict: { type: 'string' } },
};

/** The cloud route these scenarios run against — a real provider, not local. */
const cloudRoute = (): void => {
  setGatewayRouting({
    capability: 'text',
    mode: 'byok',
    provider: 'openrouter',
    model: 'anthropic/claude',
    endpoint: 'https://openrouter.ai/api/v1',
  });
};

let service: Awaited<ReturnType<typeof loadService>>;

beforeEach(async () => {
  setQuietWindow(0);
  resetGatewayMocks();
  service = await loadService();
  cloudRoute();
  setGatewayStructured({ verdict: 'warm' });
});

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

describe('the caller deadline reaches the transport', () => {
  test('streamChat forwards a 120 s budget as an ABSOLUTE instant', async () => {
    // The dialogue turn's real budget. The adapter's standalone watchdog is
    // 90 s, so this is the exact number that was being ignored.
    const deadlineAt = Date.now() + 120_000;
    await service.streamChat({
      messages: [{ role: 'user', content: 'Tell me about the village.' }],
      onChunk: () => {},
      deadlineAt,
    });

    const call = mocks.gatewayGenerateCalls[0];
    expect(call?.deadlineAt).toBe(deadlineAt);
    // Not merely "a deadline was sent": the INSTANT is what stops the adapter
    // from minting its own, and it is within a millisecond of what the caller
    // asked for.
    expect(Math.abs((call?.deadlineAt as number) - deadlineAt)).toBeLessThanOrEqual(1);
  });

  test('a structured call forwards its deadline too, through admission and coalescing', async () => {
    const deadlineAt = Date.now() + 120_000;
    await service.extractStructure({
      schema: SCHEMA,
      schemaName: 'RelationshipOutput',
      prompt: 'How did that go?',
      task: 'summarization',
      scope: 'campaign_a',
      deadlineAt,
    });
    expect(mocks.gatewayGenerateCalls[0]?.deadlineAt).toBe(deadlineAt);
  });

  test('an unbounded background call forwards NO deadline, not an invented one', async () => {
    // `agent-schedule` declares no budget. Forwarding a synthesised one would
    // turn background work into a foreground request with a stopwatch nobody
    // asked for; forwarding the preset default would be worse.
    await service.extractStructure({
      schema: SCHEMA,
      schemaName: 'SchedulePlan',
      prompt: 'plan the week',
      task: 'agent-schedule',
    });
    expect(mocks.gatewayGenerateCalls[0]?.deadlineAt).toBeUndefined();
  });

  test('a deadline spent in the quiet window suppresses dispatch', async () => {
    setQuietWindow(100);
    const deadlineAt = Date.now() + 20;
    await expect(
      service.extractStructure({
        schema: SCHEMA,
        schemaName: 'RelationshipOutput',
        prompt: 'queued question',
        task: 'summarization',
        scope: 'campaign_a',
        deadlineAt,
      }),
    ).rejects.toThrow();
    expect(Date.now()).toBeGreaterThanOrEqual(deadlineAt);
    expect(mocks.gatewayGenerateCalls).toHaveLength(0);
    expect(textTelemetryService.summary.counters.suppressed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// One route
// ---------------------------------------------------------------------------

describe('one resolved route, from admission to dispatch', () => {
  test('the dispatched route is the one admission and coalescing used', async () => {
    const release = holdGateway();
    const inFlight = service.extractStructure({
      schema: SCHEMA,
      schemaName: 'RelationshipOutput',
      prompt: 'queued question',
      task: 'summarization',
      scope: 'campaign_a',
    });

    // The player edits Settings while the request is queued. Everything the
    // service already committed to still describes the ORIGINAL route.
    setGatewayRouting({
      capability: 'text',
      mode: 'byok',
      provider: 'openai',
      model: 'gpt-4o',
      endpoint: 'https://api.openai.com/v1',
    });
    release();
    await inFlight;

    const dispatched = mocks.gatewayGenerateCalls[0]?.route as Record<string, unknown>;
    // The endpoint, the model, the provider AND the identity the request was
    // admitted under all have to agree. Any one of them disagreeing is the
    // defect; this asserts all four at once because the fix is one snapshot
    // used everywhere, and a partial fix would be indistinguishable here from a
    // complete one.
    expect(dispatched?.endpoint).toBe('https://openrouter.ai/api/v1');
    expect(dispatched?.model).toBe('anthropic/claude');
    expect(dispatched?.provider).toBe('openrouter');
  });

  test('the two callers of a coalesced pair are dispatched the INITIATOR route', async () => {
    const release = holdGateway();
    const first = service.extractStructure({
      schema: SCHEMA,
      schemaName: 'RelationshipOutput',
      prompt: 'identical question',
      task: 'summarization',
      scope: 'campaign_a',
    });
    const second = service.extractStructure({
      schema: SCHEMA,
      schemaName: 'RelationshipOutput',
      prompt: 'identical question',
      task: 'summarization',
      scope: 'campaign_a',
    });
    setGatewayRouting({
      capability: 'text',
      mode: 'byok',
      provider: 'openai',
      model: 'gpt-4o',
      endpoint: 'https://api.openai.com/v1',
    });
    release();
    await Promise.all([first, second]);

    // One dispatch, on the route the shared work was keyed under. Before the
    // fix this call re-resolved and reached the NEW provider while the
    // coalescing identity — and therefore every subscriber's expectation —
    // described the old one.
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);
    const dispatched = mocks.gatewayGenerateCalls[0]?.route as Record<string, unknown>;
    expect(dispatched?.provider).toBe('openrouter');
  });

  test('a request AFTER the settings change is dispatched on the NEW route', async () => {
    await service.extractStructure({
      schema: SCHEMA,
      schemaName: 'RelationshipOutput',
      prompt: 'before',
      task: 'summarization',
      scope: 'campaign_a',
    });
    setGatewayRouting({
      capability: 'text',
      mode: 'byok',
      provider: 'openai',
      model: 'gpt-4o',
      endpoint: 'https://api.openai.com/v1',
    });
    await service.extractStructure({
      schema: SCHEMA,
      schemaName: 'RelationshipOutput',
      prompt: 'after',
      task: 'summarization',
      scope: 'campaign_a',
    });

    // The positive control for the test above. A fix that pinned EVERY call to
    // the first route ever resolved would satisfy "dispatched route === routed
    // route" while making the settings screen do nothing.
    const first = mocks.gatewayGenerateCalls[0]?.route as Record<string, unknown>;
    const second = mocks.gatewayGenerateCalls[1]?.route as Record<string, unknown>;
    expect(first?.provider).toBe('openrouter');
    expect(second?.provider).toBe('openai');
    expect(second?.endpoint).toBe('https://api.openai.com/v1');
  });

  test('a caller-supplied revision rides along, and a changed one separates requests', async () => {
    const release = holdGateway();
    const before = service.extractStructure({
      schema: SCHEMA,
      schemaName: 'RelationshipOutput',
      prompt: 'same question',
      task: 'summarization',
      scope: 'campaign_a',
      configRevision: 'rev-1',
    });
    const after = service.extractStructure({
      schema: SCHEMA,
      schemaName: 'RelationshipOutput',
      prompt: 'same question',
      task: 'summarization',
      scope: 'campaign_a',
      configRevision: 'rev-2',
    });
    release();
    await Promise.all([before, after]);

    // Same route, same prompt, same scope — only the revision differs, which
    // is what a credential rotation looks like from here.
    expect(mocks.gatewayGenerateCalls).toHaveLength(2);
    expect(mocks.gatewayGenerateCalls[0]?.routeRevision).toBe('rev-1');
    expect(mocks.gatewayGenerateCalls[1]?.routeRevision).toBe('rev-2');
  });

  test('with no caller revision, the composition layer supplies one', async () => {
    await service.extractStructure({
      schema: SCHEMA,
      schemaName: 'RelationshipOutput',
      prompt: 'anything',
      task: 'summarization',
      scope: 'campaign_a',
    });
    // Nobody named a revision, and the request still carries one. A request
    // with no configuration identity must not be the same request as one with
    // a default configuration identity.
    expect(mocks.gatewayGenerateCalls[0]?.routeRevision).toBe(mocks.gatewayRouteRevision);
  });
});

// ---------------------------------------------------------------------------
// Accounting
// ---------------------------------------------------------------------------

describe('logical requests, provider attempts and the spans that record them', () => {
  test('every dispatched attempt reaches the span exactly once', async () => {
    const release = holdGateway();
    const inFlight = service.extractStructure({
      schema: SCHEMA,
      schemaName: 'RelationshipOutput',
      prompt: 'repaired question',
      task: 'summarization',
      scope: 'campaign_a',
    });
    release();
    // Three physical attempts: the first returned a schema-invalid body, the
    // second returned an empty body, the third succeeded. The provider billed
    // all three and only the last one produced an answer.
    setGatewayStructured({ verdict: 'warm' });
    mocks.gatewayAttempts = [
      {
        kind: 'structured',
        transport: 'buffered-json',
        startedAt: 0,
        outcome: 'invalid',
        usage: { inputTokens: 100, outputTokens: 0, cachedSource: 'unknown' },
      },
      {
        kind: 'structured',
        transport: 'buffered-json',
        startedAt: 0,
        outcome: 'empty',
        usage: { inputTokens: 100, outputTokens: 0, cachedSource: 'unknown' },
      },
      {
        kind: 'structured',
        transport: 'buffered-json',
        startedAt: 0,
        outcome: 'completed',
        totalMs: 40,
        usage: { inputTokens: 120, outputTokens: 30, cachedTokens: 0, cachedSource: 'provider' },
      },
    ];
    await inFlight;

    const span = textTelemetryService.spans[0];
    // The discarded attempts are the whole reason this hook is consumed in
    // production. An accounting boundary that only saw the survivor would
    // report one bill where the provider issued three.
    expect(span?.attemptCount).toBe(3);
    expect(span?.dispatch).toBe('provider');
    // Cached-token provenance survives: the discarded attempts reported no
    // count, so the span must say `unknown` rather than averaging a `provider`
    // zero into a claim of measured reuse.
    expect(span?.cachedSource).toBe('unknown');
    expect(textTelemetryService.summary.counters.attempts).toBe(3);
  });

  test('a CANCELLED attempt is still recorded — the provider ran it', async () => {
    // The caller cancels mid-generation. The provider does not stop: it keeps
    // generating for a client that has gone away, which is the single most
    // under-reported line in any cost ledger.
    mocks.gatewayAttempts = [
      {
        kind: 'structured',
        transport: 'buffered-json',
        startedAt: 0,
        outcome: 'cancelled',
      },
    ];
    const quitter = new AbortController();
    const release = holdGateway();
    const inFlight = service
      .extractStructure({
        schema: SCHEMA,
        schemaName: 'RelationshipOutput',
        prompt: 'cancelled question',
        task: 'summarization',
        scope: 'campaign_a',
        signal: quitter.signal,
      })
      .catch(() => 'cancelled');
    // Let the request reach the provider, then walk away from it.
    await new Promise((resolve) => setTimeout(resolve, 5));
    quitter.abort();
    release();
    expect(await inFlight).toBe('cancelled');

    const span = textTelemetryService.spans[0];
    // Dispatched, therefore billable, therefore counted — and NOT rolled back
    // by the cancellation that ended it.
    expect(span?.attemptCount).toBe(1);
    expect(span?.dispatch).toBe('provider');
    expect(span?.ok).toBe(false);
    expect(textTelemetryService.summary.counters.attempts).toBe(1);
    expect(textTelemetryService.summary.counters.suppressed).toBe(0);
  });

  test('subscribers do not multiply the bill', async () => {
    const release = holdGateway();
    const first = service.extractStructure({
      schema: SCHEMA,
      schemaName: 'RelationshipOutput',
      prompt: 'shared question',
      task: 'summarization',
      scope: 'campaign_a',
    });
    const second = service.extractStructure({
      schema: SCHEMA,
      schemaName: 'RelationshipOutput',
      prompt: 'shared question',
      task: 'summarization',
      scope: 'campaign_a',
    });
    const third = service.extractStructure({
      schema: SCHEMA,
      schemaName: 'RelationshipOutput',
      prompt: 'shared question',
      task: 'summarization',
      scope: 'campaign_a',
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    release();
    await Promise.all([first, second, third]);

    // ONE provider call, three answers, and the record says one.
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);
    const counters = textTelemetryService.summary.counters;
    expect(counters.calls).toBe(3);
    expect(counters.attempts).toBe(1);
    expect(counters.coalesced).toBe(2);
    // The subscribers are visible as joiners, not as failures and not as
    // callers that reached a provider.
    expect(textTelemetryService.spans.filter((span) => span.dispatch === 'coalesced')).toHaveLength(
      2,
    );
  });

  test('a local answer and a suppressed request both cost zero attempts', async () => {
    // A local-first success.
    mocks.localSubmitOutput = '{"change":"improve","magnitude":3,"reason":"kind"}';
    setGatewayRouting({
      capability: 'text',
      mode: 'offline',
      provider: 'local-qwen3',
      model: '',
      endpoint: '',
    });
    await service.extractStructure({
      schema: { type: 'object', properties: { change: { type: 'string' } } },
      schemaName: 'RelationshipOutput',
      prompt: 'local work',
      task: 'agent-relationship',
    });

    // A request that never leaves, because its budget was gone.
    await service
      .extractStructure({
        schema: SCHEMA,
        schemaName: 'RelationshipOutput',
        prompt: 'no budget',
        task: 'summarization',
        scope: 'campaign_a',
        deadlineAt: Date.now() - 1,
      })
      .catch(() => 'expired');

    const counters = textTelemetryService.summary.counters;
    // The local answer dispatched ZERO provider attempts. Before this change
    // every span defaulted to one, so a session that answered most of its work
    // on-device reported more provider calls than it made.
    expect(counters.attempts).toBe(0);
    expect(counters.localCalls).toBe(1);
    expect(counters.suppressed).toBe(1);
    expect(textTelemetryService.spans.some((span) => span.dispatch === 'local')).toBe(true);
  });
});
