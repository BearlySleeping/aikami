// apps/frontend/client/src/lib/services/ai/__tests__/text_request_identity_scenarios.test.ts
//
// SCENARIO: request identity across route, revision and partition, through the
// real TextGenerationService (issue #382 P1).
//
// WHAT MAKES THIS A SCENARIO FILE RATHER THAN MORE UNIT TESTS
//
// The defects are in the SEAM. The coalescer can key on a route perfectly and
// still be useless if the service never puts the route in the identity; the
// route identity can be correct and be recomputed at the wrong moment, after
// the settings change it was supposed to catch. Those orderings are invisible
// from inside any single module — the only place they are observable is through
// the public `extractStructure` surface, with a gateway whose routing the test
// controls between two calls.
//
// It consumes the EXISTING harness rather than re-declaring the gateway and
// local-pool mocks. A second copy of a mock that decides whether a provider call
// happens is worse than one large file; the harness exists precisely so suites
// do not fork it.
//
// Run with:
//   bun moon run client:test
//   (or, for this file only:
//    bun test --preload ./src/lib/test_setup.ts --tsconfig-override tsconfig.test.json \
//      src/lib/services/ai/__tests__/text_request_identity_scenarios.test.ts)

import { beforeEach, describe, expect, test } from 'bun:test';
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

const PROMPT = 'How did this interaction go?';
const SYSTEM = 'You are a relationship analyst.';

/** The service type, narrowed to what these scenarios call. */
type StructuredCaller = {
  extractStructure(options: {
    schema: Record<string, unknown>;
    schemaName: string;
    prompt: string;
    systemPrompt?: string;
    task?: 'summarization';
    scope?: string;
    configRevision?: string;
    signal?: AbortSignal;
  }): Promise<unknown>;
  cancelAll(): void;
};

let service: StructuredCaller;

beforeEach(async () => {
  // Zero quiet window: these scenarios are about IDENTITY, and a test that
  // passed because its subject was still sitting in the admission queue would
  // prove nothing.
  setQuietWindow(0);
  resetGatewayMocks();
  service = (await loadService()) as unknown as StructuredCaller;
  setGatewayRouting({
    capability: 'text',
    mode: 'offline',
    provider: 'ollama',
    model: 'ornith-1.5:9b',
    endpoint: 'http://127.0.0.1:11434',
  });
  setGatewayStructured({ verdict: 'warm' });
});

const call = (overrides?: {
  scope?: string;
  configRevision?: string;
  schema?: Record<string, unknown>;
}) =>
  service.extractStructure({
    schema: overrides?.schema ?? SCHEMA,
    schemaName: 'RelationshipOutput',
    prompt: PROMPT,
    systemPrompt: SYSTEM,
    task: 'summarization',
    ...(overrides?.scope === undefined ? {} : { scope: overrides.scope }),
    ...(overrides?.configRevision === undefined
      ? {}
      : { configRevision: overrides.configRevision }),
  });

describe('scenario — a settings change must not join an in-flight request', () => {
  test('the same prompt on a DIFFERENT route makes its own provider call', async () => {
    const release = holdGateway();
    const first = call({ scope: 'campaign_a' });
    // The player edits the connection while the first request is in flight.
    setGatewayRouting({
      capability: 'text',
      mode: 'offline',
      provider: 'openrouter',
      model: 'some-cloud-model',
      endpoint: 'https://openrouter.ai/api/v1',
    });
    const second = call({ scope: 'campaign_a' });
    release();

    await Promise.all([first, second]);
    // Two provider calls, not one. Sharing here would serve the first model's
    // answer to a request that was aimed at the second.
    expect(mocks.gatewayGenerateCalls).toHaveLength(2);
  });

  test('the same route with a DIFFERENT connection revision makes its own call', async () => {
    const release = holdGateway();
    const before = call({ scope: 'campaign_a', configRevision: 'rev-1' });
    const after = call({ scope: 'campaign_a', configRevision: 'rev-2' });
    release();
    await Promise.all([before, after]);
    expect(mocks.gatewayGenerateCalls).toHaveLength(2);
  });

  test('identical route, revision and scope DO share one provider call', async () => {
    const release = holdGateway();
    const first = call({ scope: 'campaign_a', configRevision: 'rev-1' });
    const second = call({ scope: 'campaign_a', configRevision: 'rev-1' });
    release();
    await Promise.all([first, second]);
    // The positive control. Without it, a key that separated everything would
    // pass every isolation test above while deleting coalescing entirely.
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);
  });
});

describe('scenario — sharing never crosses a partition', () => {
  test('the same request in two campaigns makes two provider calls', async () => {
    const release = holdGateway();
    const campaignA = call({ scope: 'campaign_a' });
    const campaignB = call({ scope: 'campaign_b' });
    release();
    await Promise.all([campaignA, campaignB]);
    // A result computed inside one campaign must never be served to another.
    expect(mocks.gatewayGenerateCalls).toHaveLength(2);
  });

  test('two calls in the SAME campaign still share', async () => {
    const release = holdGateway();
    const first = call({ scope: 'campaign_a' });
    const second = call({ scope: 'campaign_a' });
    release();
    await Promise.all([first, second]);
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);
  });

  test('an unscoped caller coalesces only with other unscoped callers', async () => {
    const release = holdGateway();
    const unscoped = call();
    const scoped = call({ scope: 'campaign_a' });
    release();
    await Promise.all([unscoped, scoped]);
    expect(mocks.gatewayGenerateCalls).toHaveLength(2);
  });
});

describe('scenario — schema identity through the real service', () => {
  test('the same schema NAME with a different nested shape does not share', async () => {
    const release = holdGateway();
    const alpha = call({
      scope: 'campaign_a',
      schema: {
        type: 'object',
        properties: { mood: { type: 'object', properties: { tone: { enum: ['warm'] } } } },
      },
    });
    const beta = call({
      scope: 'campaign_a',
      schema: {
        type: 'object',
        properties: { mood: { type: 'object', properties: { tone: { enum: ['hostile'] } } } },
      },
    });
    release();
    await Promise.all([alpha, beta]);
    expect(mocks.gatewayGenerateCalls).toHaveLength(2);
  });

  test('cancelling ONE shared subscriber leaves the other served', async () => {
    const release = holdGateway();
    const quitter = new AbortController();
    const staying = call({ scope: 'campaign_a' });
    const leaving = service
      .extractStructure({
        schema: SCHEMA,
        schemaName: 'RelationshipOutput',
        prompt: PROMPT,
        systemPrompt: SYSTEM,
        task: 'summarization',
        scope: 'campaign_a',
        signal: quitter.signal,
      })
      .catch(() => 'cancelled');
    quitter.abort();
    release();

    // The subscriber that left must not have taken the shared work with it.
    expect(await leaving).toBe('cancelled');
    expect(await staying).toEqual({ verdict: 'warm' });
    expect(mocks.gatewayGenerateCalls).toHaveLength(1);
  });
});
