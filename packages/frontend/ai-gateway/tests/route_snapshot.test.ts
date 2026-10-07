// packages/frontend/ai-gateway/tests/route_snapshot.test.ts
//
// ONE ROUTE PER REQUEST, and no dispatch on a spent budget (issue #382).
//
// The defect under test is a SEAM defect, not a resolver defect. Both halves of
// the old contract were individually correct: `resolveText` returned the right
// routing, and `generateText` resolved the right routing. What was wrong was
// that they were two separate resolutions taken at two separate instants, with
// a settings screen between them. A caller could therefore be admitted against
// route A, coalesced under an identity describing route A, and dispatched to
// route B — three committed facts and one actual call, with nothing anywhere
// recording the disagreement.
//
// These tests are at the gateway boundary on purpose. A resolver test would
// pass throughout the whole period this describes.
//
// Second defect, same boundary: a caller whose absolute deadline had already
// passed still reached `onDispatch` and the adapter. The adapter refused, so no
// provider bill appeared — but a dispatch hook fired and an attempt counter was
// registered for a call that never existed, which is exactly the kind of thing
// that makes an attempt ledger disagree with a bill.

import { expect, test } from 'bun:test';
import type { AiAdapterContext, AiModeResolution } from '@aikami/types';
import {
  type AiProviderGateway,
  type AiTextAdapter,
  createAdapterRegistry,
  createAiProviderGateway,
} from '../src/index.ts';

const ROUTE_A: AiModeResolution = {
  capability: 'text',
  mode: 'offline',
  provider: 'ollama',
  model: 'model-a',
  endpoint: 'http://127.0.0.1:11434',
  params: { temperature: 0.2 },
};

const ROUTE_B: AiModeResolution = {
  capability: 'text',
  mode: 'byok',
  provider: 'openrouter',
  model: 'model-b',
  endpoint: 'https://openrouter.ai/api/v1',
  params: { temperature: 0.9 },
};

type Spy = {
  gateway: AiProviderGateway;
  /** Every resolution the adapter was handed, in order. */
  dispatched: AiModeResolution[];
  /** Every context field the adapter was handed, in order. */
  contexts: AiAdapterContext[];
  /** How many times `onDispatch` fired. */
  dispatches: number;
  /** The resolver's call count. */
  resolveCount: () => number;
};

const spy = (current: () => AiModeResolution): Spy => {
  const dispatched: AiModeResolution[] = [];
  const contexts: AiAdapterContext[] = [];
  let dispatches = 0;
  let resolveCount = 0;

  const recording = (label: string): AiTextAdapter => ({
    provider: label,
    generateText: async (context) => {
      dispatched.push(context.resolution);
      contexts.push(context);
      // Real adapters refuse an already-aborted signal before doing anything;
      // the spy does the same so a cancellation test is not asserting that a
      // fake adapter ignored its input.
      if (context.signal.aborted) {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        throw error;
      }
      return { text: 'ok' };
    },
  });

  const registry = createAdapterRegistry();
  registry.registerText({ mode: 'offline', adapter: recording('ollama') });
  registry.registerText({ mode: 'byok', adapter: recording('openai_compatible') });

  const gateway = createAiProviderGateway({
    registry,
    resolveMode: () => {
      resolveCount += 1;
      return current();
    },
    onDispatch: () => {
      dispatches += 1;
    },
  });
  return {
    gateway,
    dispatched,
    contexts,
    get dispatches() {
      return dispatches;
    },
    resolveCount: () => resolveCount,
  };
};

test('a supplied route is dispatched verbatim and the resolver is not consulted', async () => {
  const now = ROUTE_A;
  const harness = spy(() => now);

  await harness.gateway.generateText({ messages: [], route: ROUTE_B });

  // The resolver WOULD have said A. The caller said B, and the caller is the
  // one that already admitted, coalesced and accounted for this request.
  expect(harness.dispatched).toEqual([ROUTE_B]);
  expect(harness.resolveCount()).toBe(0);
  expect(harness.dispatches).toBe(1);
});

test('a settings change between resolution and dispatch cannot move the route', async () => {
  let now = ROUTE_A;
  const harness = spy(() => now);

  // Exactly the production sequence: the caller resolves, the player edits
  // Settings, the queue drains and the call finally goes out.
  const admitted = harness.gateway.resolveText();
  expect(admitted).toEqual(ROUTE_A);
  now = ROUTE_B;
  await harness.gateway.generateText({ messages: [], route: admitted });

  // Before the fix, dispatch re-resolved and reached ROUTE_B while the
  // caller's admission, its coalescing identity and its contention domain all
  // described ROUTE_A.
  expect(harness.dispatched).toEqual([ROUTE_A]);
  expect(harness.dispatched[0]?.endpoint).toBe('http://127.0.0.1:11434');
  expect(harness.dispatched[0]?.provider).toBe('ollama');
});

test('model/endpoint/task are ignored when a route is supplied', async () => {
  const harness = spy(() => ROUTE_B);
  await harness.gateway.generateText({
    messages: [],
    route: ROUTE_A,
    // All three are inputs to RESOLUTION. Supplied alongside a resolved route
    // they are the caller's old intent, and honouring them would re-introduce
    // exactly the late-binding this option exists to remove.
    model: 'model-b',
    endpoint: 'https://elsewhere.example/v1',
    task: 'summarization',
  });
  expect(harness.dispatched[0]?.model).toBe('model-a');
  expect(harness.dispatched[0]?.endpoint).toBe('http://127.0.0.1:11434');
});

test('a route with no registered adapter fails rather than silently re-resolving', async () => {
  const registry = createAdapterRegistry();
  const gateway = createAiProviderGateway({
    registry,
    resolveMode: () => ROUTE_A,
  });
  await expect(gateway.generateText({ messages: [], route: ROUTE_B })).rejects.toMatchObject({
    code: 'mode_unavailable',
  });
});

test('a route that disagrees with an explicit mode override is reported', async () => {
  const harness = spy(() => ROUTE_A);
  // Both are statements about where the call goes. Silently preferring one
  // would make the other a lie the caller cannot see.
  await expect(
    harness.gateway.generateText({ messages: [], route: ROUTE_B, mode: 'offline' }),
  ).rejects.toMatchObject({ code: 'mode_unavailable' });
  expect(harness.dispatched).toHaveLength(0);
});

test('a route that AGREES with an explicit mode override is accepted', async () => {
  const harness = spy(() => ROUTE_A);
  await harness.gateway.generateText({ messages: [], route: ROUTE_A, mode: 'offline' });
  expect(harness.dispatched).toEqual([ROUTE_A]);
});

test('the caller deadline is forwarded to the adapter unchanged', async () => {
  const harness = spy(() => ROUTE_A);
  // The dialogue budget. The adapter's own 90 s watchdog is SHORTER than this,
  // so forwarding is the difference between a 120 s turn and a 90 s one.
  const deadlineAt = Date.now() + 120_000;
  await harness.gateway.generateText({ messages: [], route: ROUTE_A, deadlineAt });
  expect(harness.contexts[0]?.deadlineAt).toBe(deadlineAt);
});

test('an absent deadline leaves the adapter to its own safety limit', async () => {
  const harness = spy(() => ROUTE_A);
  await harness.gateway.generateText({ messages: [], route: ROUTE_A });
  // `undefined` is meaningful: it is the signal to keep the historical finite
  // watchdog, and substituting a default here would be the very re-minting
  // this fix removed.
  expect(harness.contexts[0]?.deadlineAt).toBeUndefined();
});

test('a SPENT deadline dispatches nothing at all', async () => {
  const harness = spy(() => ROUTE_A);
  const attemptIds: string[] = [];

  await expect(
    harness.gateway.generateText({
      messages: [],
      route: ROUTE_A,
      deadlineAt: Date.now() - 1,
      requestId: 'spent',
      onAttempt: (event) => attemptIds.push(event.attemptId),
    }),
  ).rejects.toMatchObject({ code: 'timeout', timeoutKind: 'total_budget' });

  // Not "the adapter refused". The boundary that owns the decision to spend
  // money refused, so no dispatch was announced and no attempt was numbered.
  expect(harness.dispatched).toHaveLength(0);
  expect(harness.dispatches).toBe(0);
  expect(attemptIds).toHaveLength(0);
});

test('a deadline spent while queued still dispatches if it had time on entry', async () => {
  const harness = spy(() => ROUTE_A);
  // The check is at the boundary, not continuously: a request that arrives
  // with budget must be allowed to spend it, and a request that arrives without
  // any must not. Anything in between is the adapter's phase logic.
  const deadlineAt = Date.now() + 5_000;
  await harness.gateway.generateText({ messages: [], route: ROUTE_A, deadlineAt });
  expect(harness.dispatched).toHaveLength(1);
  expect(harness.contexts[0]?.deadlineAt).toBe(deadlineAt);
});

test('an aborted caller signal still wins over a valid deadline', async () => {
  const harness = spy(() => ROUTE_A);
  const controller = new AbortController();
  controller.abort();
  await expect(
    harness.gateway.generateText({
      messages: [],
      route: ROUTE_A,
      signal: controller.signal,
      deadlineAt: Date.now() + 60_000,
    }),
  ).rejects.toMatchObject({ code: 'cancelled' });
  // The adapter is still reached: cancellation is its vocabulary, and the
  // budget gate above is about spending, not about who stopped the request.
  expect(harness.dispatched).toHaveLength(1);
});
