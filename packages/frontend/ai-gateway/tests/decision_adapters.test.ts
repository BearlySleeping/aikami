// packages/frontend/ai-gateway/tests/decision_adapters.test.ts
//
// Contract C-566 AC-4/AC-5: adapter contracts, transport behaviour, and the
// cache's invalidation guarantee.
//
// The transport is tested against an injected fetch, never a live backend. A
// mock proves the CONTRACT — that this code sends the right shape and reads the
// right one back. It proves nothing about what any model would answer, and the
// report is written accordingly.

import { describe, expect, spyOn, test } from 'bun:test';
import Type from 'typebox';
import {
  analyzeDecisionSchema,
  bindDecisionPolicy,
  buildDecisionDispatch,
  createDecisionPlanCache,
  createDeterministicDecisionAdapter,
  createSystemOneDecisionAdapter,
  type DecisionPlan,
  type DecisionTaskPolicy,
  isUnsafeSegment,
  parseSystemOneResponse,
  runDecision,
  type SystemOneTransport,
} from '../src/lib/decision/index.ts';

/** The pilot schema: one closed choice over command kinds, plus one boolean. */
const pilotSchema = Type.Object(
  {
    commandKind: Type.Union([
      Type.Literal('trade'),
      Type.Literal('recruit'),
      Type.Literal('presentEvidence'),
      Type.Literal('skillCheck'),
    ]),
    urgent: Type.Boolean(),
  },
  { additionalProperties: false },
);

/** Authored pilot policy. */
const pilotPolicy: DecisionTaskPolicy = {
  task: 'npc-command-kind',
  enabled: true,
  language: 'en',
  instructions: 'Decide which bounded dialogue command the player message asks the NPC for.',
  fieldInstructions: {
    commandKind: 'Which bounded dialogue command does the player message ask the NPC for?',
    urgent: 'Does the player message read as time-critical in this exchange?',
  },
  optionDescriptions: {
    commandKind: {
      trade: 'The player wants to open the trade overlay.',
      recruit: 'The player asks the NPC to join the party.',
      presentEvidence: 'The player hands over a piece of evidence.',
      skillCheck: 'The player asks for a d20 skill check.',
    },
  },
};

/** Builds the bound pilot plan. */
const pilotPlan = (): DecisionPlan => {
  const analysis = analyzeDecisionSchema({ schema: pilotSchema });
  if (!analysis.ok) {
    throw new Error('compile failed');
  }
  const binding = bindDecisionPolicy({ plan: analysis.plan, policy: pilotPolicy });
  if (!binding.ok) {
    throw new Error('bind failed');
  }
  return binding.plan;
};

/** Builds a fetch stub that records requests and replies from a route table. */
const stubTransport = (options: {
  routes: Record<string, { status: number; body: unknown }>;
}): SystemOneTransport & { calls: Array<{ url: string; body: string }> } => {
  const calls: Array<{ url: string; body: string }> = [];
  return {
    calls,
    fetch: async (input, init) => {
      calls.push({ url: input, body: init.body ?? '' });
      const route = Object.entries(options.routes).find(([key]) => input.endsWith(key));
      const chosen = route?.[1];
      const status = chosen?.status ?? 404;
      const body = chosen === undefined ? 'not found' : JSON.stringify(chosen.body);
      return { status, text: async () => body };
    },
  };
};

describe('createDecisionPlanCache', () => {
  test('an unchanged schema is served from cache', () => {
    const cache = createDecisionPlanCache();
    const first = cache.analyze({ schema: pilotSchema });
    const second = cache.analyze({ schema: pilotSchema });
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
  });

  test('an equivalent schema with reordered properties is the same plan', () => {
    const cache = createDecisionPlanCache();
    const original = cache.analyze({ schema: pilotSchema });
    const reordered = {
      type: 'object',
      properties: {
        urgent: { type: 'boolean' },
        commandKind: {
          anyOf: [
            { type: 'string', const: 'trade' },
            { type: 'string', const: 'recruit' },
            { type: 'string', const: 'presentEvidence' },
            { type: 'string', const: 'skillCheck' },
          ],
        },
      },
      required: ['urgent', 'commandKind'],
      additionalProperties: false,
    };
    const reorderedResult = cache.analyze({ schema: reordered });
    expect(reorderedResult.cacheHit).toBe(false);
    // Reordering `required` changes the content key, but must not change the plan.
    expect(original.analysis.ok).toBe(true);
    expect(reorderedResult.analysis.ok).toBe(true);
    if (original.analysis.ok && reorderedResult.analysis.ok) {
      expect(reorderedResult.analysis.plan.questions).toEqual(original.analysis.plan.questions);
      expect(reorderedResult.analysis.plan.constants).toEqual(original.analysis.plan.constants);
      expect(reorderedResult.analysis.plan.groups).toEqual(original.analysis.plan.groups);
    }
  });

  test('changing one option invalidates the cached plan', () => {
    const cache = createDecisionPlanCache();
    const before = {
      ...pilotSchema,
      properties: { ...(pilotSchema as never as { properties: unknown }).properties },
    };
    cache.analyze({ schema: before });
    const changed = Type.Object(
      {
        commandKind: Type.Union([
          Type.Literal('trade'),
          Type.Literal('recruit'),
          Type.Literal('presentEvidence'),
          Type.Literal('skillCheck'),
          Type.Literal('startCombat'),
        ]),
        urgent: Type.Boolean(),
      },
      { additionalProperties: false },
    );
    expect(cache.analyze({ schema: changed }).cacheHit).toBe(false);
  });

  test('a rejected schema is not cached', () => {
    const cache = createDecisionPlanCache();
    const bad = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    };
    expect(cache.analyze({ schema: bad }).cacheHit).toBe(false);
    expect(cache.analyze({ schema: bad }).cacheHit).toBe(false);
  });

  test('different limits are different cache entries', () => {
    const cache = createDecisionPlanCache();
    cache.analyze({ schema: pilotSchema });
    expect(cache.analyze({ schema: pilotSchema, limits: { maxOptions: 2 } }).cacheHit).toBe(false);
  });

  test('changing the policy changes the bound plan', () => {
    const cache = createDecisionPlanCache();
    const plan = pilotPlan();
    const first = cache.bind({ plan, policy: pilotPolicy });
    const second = cache.bind({ plan, policy: pilotPolicy });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second).toBe(first);
    const disabled = cache.bind({ plan, policy: { ...pilotPolicy, enabled: false } });
    expect(disabled.ok).toBe(false);
  });
});

describe('buildDecisionDispatch — bounds before dispatch', () => {
  test('an oversize context is refused, never truncated', () => {
    const result = buildDecisionDispatch({
      plan: pilotPlan(),
      context: 'x'.repeat(100),
      limits: { maxContextBytes: 10 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.refusal.reason).toBe('context-too-large');
      expect(result.refusal.size).toBe(100);
      expect(result.refusal.limit).toBe(10);
    }
  });

  test('a bound context produces one unit carrying the question text and options', () => {
    const result = buildDecisionDispatch({ plan: pilotPlan(), context: 'player asks to trade' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.units).toHaveLength(1);
      expect(result.units[0]?.questions).toHaveLength(2);
      expect(result.units[0]?.questions[1]?.instructions).toContain('time-critical');
      expect(result.units[0]?.stateBytes).toBeGreaterThan(0);
    }
  });

  test('a group asking more questions than the backend allows is refused', () => {
    const result = buildDecisionDispatch({
      plan: pilotPlan(),
      context: 'x',
      limits: { maxQuestions: 1 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.refusal.reason).toBe('question-limit-exceeded');
    }
  });
});

describe('deterministic baseline adapter', () => {
  const adapter = createDeterministicDecisionAdapter({
    rules: {
      rules: {
        commandKind: [
          { match: ['buy', 'sell', 'trade', 'shop', 'price'], value: 'trade', weight: 1 },
          { match: ['join', 'recruit', 'party', 'travel with'], value: 'recruit', weight: 1 },
          { match: ['evidence', 'proof', 'clue', 'token'], value: 'presentEvidence', weight: 1 },
          {
            match: ['roll', 'persuade', 'sneak', 'intimidate', 'check'],
            value: 'skillCheck',
            weight: 1,
          },
        ],
        urgent: [
          { match: ['now', 'quickly', 'hurry', 'immediately'], booleanValue: true, weight: 1 },
          { match: ['later', 'someday', 'whenever'], booleanValue: false, weight: 1 },
        ],
      },
    },
  });

  /** Builds a request for the pilot plan. */
  const request = (overrides?: { deadlineAt?: number; signal?: AbortSignal }) => {
    const plan = pilotPlan();
    const dispatch = buildDecisionDispatch({ plan, context: 'hello there' });
    if (!dispatch.ok) {
      throw new Error('dispatch failed');
    }
    return {
      plan,
      unit: dispatch.units[0],
      deadlineAt: overrides?.deadlineAt ?? Date.now() + 5000,
      signal: overrides?.signal ?? new AbortController().signal,
      requestId: 'req-1',
      stateRevision: 7,
    };
  };

  test('capability is honest about being in-process and ready', async () => {
    const capability = await adapter.capability();
    expect(capability.ready).toBe(true);
    expect(capability.dialect).toBe('lexicon');
    expect(capability.checkpoint).toBe('authored-lexicon');
    expect(capability.languages).toEqual(['en']);
  });

  test('matches an authored rule and returns a normalised distribution', async () => {
    const plan = pilotPlan();
    const dispatch = buildDecisionDispatch({ plan, context: 'I would like to buy a lantern now' });
    if (!dispatch.ok) {
      throw new Error('dispatch failed');
    }
    const response = await adapter.run({
      plan,
      unit: dispatch.units[0],
      deadlineAt: Date.now() + 5000,
      signal: new AbortController().signal,
      requestId: 'req-1',
      stateRevision: 7,
    });
    expect(response.ok).toBe(true);
    if (response.ok) {
      const kindQuestion = plan.questions.find((question) => question.path[0] === 'commandKind');
      const tradeKey = kindQuestion?.options?.find((option) => option.value === 'trade')?.key;
      const kind = response.answers.find((answer) => answer.optionKey === tradeKey);
      expect(kind).toBeDefined();
      const probabilities = kind?.probabilities ?? {};
      const total = Object.values(probabilities).reduce((sum, value) => sum + value, 0);
      expect(Math.abs(total - 1)).toBeLessThan(1e-9);
      const urgent = response.answers.find((answer) => answer.booleanValue !== undefined);
      expect(urgent?.booleanValue).toBe(true);
    }
  });

  test('abstains rather than guessing when no rule matches', async () => {
    const plan = pilotPlan();
    const dispatch = buildDecisionDispatch({ plan, context: 'completely unrelated musing' });
    if (!dispatch.ok) {
      throw new Error('dispatch failed');
    }
    const response = await adapter.run({
      plan,
      unit: dispatch.units[0],
      deadlineAt: Date.now() + 5000,
      signal: new AbortController().signal,
      requestId: 'req-2',
      stateRevision: 1,
    });
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.reason).toBe('invalid-response');
      expect(response.detail).toContain('abstains');
    }
  });

  test('a pre-cancelled request never runs', async () => {
    const controller = new AbortController();
    controller.abort();
    const response = await adapter.run(request({ signal: controller.signal }));
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.reason).toBe('cancelled');
    }
  });
});

describe('systemone dialect adapter', () => {
  const endpoints = {
    decision: 'http://127.0.0.1:11434/v1/systemone',
    version: 'http://127.0.0.1:11434/api/version',
  };

  /** Builds a request for the pilot plan. */
  const request = (overrides?: { deadlineAt?: number; signal?: AbortSignal }) => {
    const plan = pilotPlan();
    const dispatch = buildDecisionDispatch({ plan, context: 'I want to buy a lantern' });
    if (!dispatch.ok) {
      throw new Error('dispatch failed');
    }
    return {
      plan,
      unit: dispatch.units[0],
      deadlineAt: overrides?.deadlineAt ?? Date.now() + 5000,
      signal: overrides?.signal ?? new AbortController().signal,
      requestId: 'req-1',
      stateRevision: 7,
    };
  };

  test('the default transport calls fetch with the global receiver', async () => {
    const stub = {
      async fetch(this: unknown) {
        expect(this).toBe(globalThis);
        return Response.json({ version: 'test-runtime' });
      },
    };
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(stub.fetch);
    try {
      const adapter = createSystemOneDecisionAdapter({
        endpoints,
        model: 'nimble',
        languages: ['en'],
      });
      expect((await adapter.capability()).runtime).toBe('test-runtime');
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      fetch.mockRestore();
    }
  });

  test.each(['{', '{"model":"nimble","answers":[]}', '{"model":"nimble","answers":{"bad":null}}'])(
    'malformed response %s is invalid-response',
    async (body) => {
      const adapter = createSystemOneDecisionAdapter({
        endpoints,
        model: 'nimble',
        languages: ['en'],
        transport: { fetch: async () => ({ status: 200, text: async () => body }) },
      });
      const response = await adapter.run(request());
      expect(response.ok).toBe(false);
      if (!response.ok) {
        expect(response.reason).toBe('invalid-response');
      }
    },
  );

  test('a fetch failure remains backend-unavailable', async () => {
    const adapter = createSystemOneDecisionAdapter({
      endpoints,
      model: 'nimble',
      languages: ['en'],
      transport: {
        fetch: async () => {
          throw new Error('offline');
        },
      },
    });
    const response = await adapter.run(request());
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.reason).toBe('backend-unavailable');
    }
  });

  test('a probe cancelled by its caller aborts the transport', async () => {
    const controller = new AbortController();
    const adapter = createSystemOneDecisionAdapter({
      endpoints,
      model: 'nimble',
      languages: ['en'],
      transport: {
        fetch: async (_input, init) => {
          const pending = new Promise<never>((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('cancelled')), {
              once: true,
            });
          });
          controller.abort();
          return pending;
        },
      },
    });
    const capability = await adapter.capability({
      deadlineAt: Date.now() + 5000,
      signal: controller.signal,
    });
    expect(capability.ready).toBe(false);
    expect(capability.notReadyReason).toContain('cancelled');
  });

  test('provenance uses the probed runtime and the configured checkpoint', async () => {
    const plan = pilotPlan();
    const answers = Object.fromEntries(
      plan.questions.map((question) => [
        question.key,
        question.kind === 'boolean'
          ? { type: 'noul', value: true }
          : { type: 'choice', choice: question.options?.[0]?.key },
      ]),
    );
    const adapter = createSystemOneDecisionAdapter({
      endpoints,
      model: 'nimble',
      languages: ['en'],
      transport: stubTransport({
        routes: {
          // C-567: the runtime must now report a parseable version at or above
          // the dialect floor. C-566 accepted 'test-runtime' here because a
          // 200 on /api/version was enough to declare readiness, which is the
          // false-ready bug this test used to encode.
          '/api/version': { status: 200, body: { version: '0.36.1' } },
          '/v1/systemone': { status: 200, body: { model: 'nimble', answers } },
        },
      }),
    });
    const result = await runDecision({
      ...request(),
      plan,
      schema: pilotSchema,
      policy: pilotPolicy,
      adapter,
      context: 'buy a lantern',
    });
    expect(result.ok).toBe(true);
    expect(result.provenance.runtime).toBe('0.36.1');
    expect(result.provenance.checkpoint).toBe('nimble');
  });

  test('a runtime that does not implement the route is reported as not ready, not ready-on-assumption', async () => {
    const transport = stubTransport({ routes: {} });
    const adapter = createSystemOneDecisionAdapter({
      endpoints,
      model: 'nimble',
      languages: ['en'],
      transport,
    });
    const capability = await adapter.capability();
    expect(capability.ready).toBe(false);
    expect(capability.notReadyReason).toContain('404');
  });

  test('a runtime reporting a version is ready and the version is carried verbatim', async () => {
    const transport = stubTransport({
      routes: { '/api/version': { status: 200, body: { version: '0.35.0' } } },
    });
    const adapter = createSystemOneDecisionAdapter({
      endpoints,
      model: 'nimble',
      languages: ['en'],
      transport,
    });
    const capability = await adapter.capability();
    expect(capability.ready).toBe(true);
    expect(capability.runtime).toBe('0.35.0');
    expect(capability.checkpoint).toBe('nimble');
    expect(capability.dialect).toBe('jev-v1');
  });

  test('the request carries model, state and one entry per question', async () => {
    const plan = pilotPlan();
    const dispatch = buildDecisionDispatch({ plan, context: 'I want to buy a lantern' });
    if (!dispatch.ok) {
      throw new Error('dispatch failed');
    }
    const kindKey =
      plan.questions.find((question) => question.path[0] === 'commandKind')?.key ?? '';
    const urgentKey = plan.questions.find((question) => question.path[0] === 'urgent')?.key ?? '';
    const transport = stubTransport({
      routes: {
        '/v1/systemone': {
          status: 200,
          body: {
            model: 'nimble',
            answers: {
              [kindKey]: {
                type: 'choice',
                choice: 'o0',
                probabilities: { o0: 0.91, o1: 0.05, o2: 0.02, o3: 0.02 },
                confidence: 0.88,
              },
              [urgentKey]: {
                type: 'noul',
                value: false,
                probabilities: { true: 0.12, false: 0.88 },
              },
            },
            // biome-ignore lint/style/useNamingConvention: verbatim wire field names
            usage: { input_tokens: 120, output_tokens: 1 },
          },
        },
      },
    });
    const adapter = createSystemOneDecisionAdapter({
      endpoints,
      model: 'nimble',
      languages: ['en'],
      transport,
    });
    const response = await adapter.run({
      plan,
      unit: dispatch.units[0],
      deadlineAt: Date.now() + 5000,
      signal: new AbortController().signal,
      requestId: 'req-1',
      stateRevision: 7,
    });
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.checkpoint).toBe('nimble');
      expect(response.runtime).toBeUndefined();
      expect(response.answers.find((answer) => answer.questionKey === kindKey)?.optionKey).toBe(
        'o0',
      );
    }
    const sent = JSON.parse(transport.calls[0]?.body ?? '{}');
    expect(sent.model).toBe('nimble');
    expect(sent.state).toBe('I want to buy a lantern');
    expect(sent.questions[kindKey].type).toBe('choice');
    expect(Object.keys(sent.questions[kindKey].criteria)).toHaveLength(4);
    expect(sent.questions[urgentKey].type).toBe('noul');
    // The dialect reports the model's own distribution and confidence; the
    // module must not relabel either as a probability of correctness.
    const tradeKey = plan.questions
      .find((question) => question.path[0] === 'commandKind')
      ?.options?.find((option) => option.value === 'trade')?.key;
    expect(sent.questions[kindKey].criteria[tradeKey ?? '']).toBe(
      'The player wants to open the trade overlay.',
    );
    // Every criterion carries an authored description, never a bare key.
    for (const criteria of Object.values(sent.questions[kindKey].criteria)) {
      expect(String(criteria).length).toBeGreaterThan(12);
    }
  });

  test('a 404 on the decision route is reported as backend-unavailable, not as success', async () => {
    const transport = stubTransport({ routes: {} });
    const adapter = createSystemOneDecisionAdapter({
      endpoints,
      model: 'nimble',
      languages: ['en'],
      transport,
    });
    const response = await adapter.run(request());
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.reason).toBe('backend-unavailable');
      expect(response.detail).toContain('/v1/systemone');
    }
  });

  test('an unauthorized reply is reported as unauthorized', async () => {
    const transport = stubTransport({
      routes: { '/v1/systemone': { status: 401, body: { error: 'nope' } } },
    });
    const adapter = createSystemOneDecisionAdapter({
      endpoints,
      model: 'nimble',
      languages: ['en'],
      transport,
    });
    const response = await adapter.run(request());
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.reason).toBe('unauthorized');
    }
  });

  test('a partial answer set is refused rather than partially applied', async () => {
    const plan = pilotPlan();
    const transport = stubTransport({
      routes: { '/v1/systemone': { status: 200, body: { model: 'nimble', answers: {} } } },
    });
    const adapter = createSystemOneDecisionAdapter({
      endpoints,
      model: 'nimble',
      languages: ['en'],
      transport,
    });
    const dispatch = buildDecisionDispatch({ plan, context: 'I want to buy a lantern' });
    if (!dispatch.ok) {
      throw new Error('dispatch failed');
    }
    const response = await adapter.run({
      plan,
      unit: dispatch.units[0],
      deadlineAt: Date.now() + 5000,
      signal: new AbortController().signal,
      requestId: 'req-1',
      stateRevision: 7,
    });
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.reason).toBe('invalid-response');
    }
  });

  test('a deadline already in the past is refused before any request is sent', async () => {
    const transport = stubTransport({
      routes: { '/v1/systemone': { status: 200, body: { model: 'nimble', answers: {} } } },
    });
    const adapter = createSystemOneDecisionAdapter({
      endpoints,
      model: 'nimble',
      languages: ['en'],
      transport,
    });
    const response = await adapter.run(request({ deadlineAt: Date.now() - 1 }));
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.reason).toBe('deadline-exceeded');
    }
    expect(transport.calls).toHaveLength(0);
  });

  test('a cancellation is honoured and reported as cancelled', async () => {
    const controller = new AbortController();
    const transport = stubTransport({
      routes: { '/v1/systemone': { status: 200, body: { model: 'nimble', answers: {} } } },
    });
    const adapter = createSystemOneDecisionAdapter({
      endpoints,
      model: 'nimble',
      languages: ['en'],
      transport,
    });
    controller.abort();
    const response = await adapter.run(request({ signal: controller.signal }));
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.reason).toBe('cancelled');
    }
  });
});

describe('parseSystemOneResponse', () => {
  test('rejects a body that does not match the dialect', () => {
    expect(parseSystemOneResponse(null)).toBeUndefined();
    expect(parseSystemOneResponse([])).toBeUndefined();
    expect(parseSystemOneResponse({ hello: 'world' })).toBeUndefined();
  });

  test('rejects array answer maps and malformed entries, including unused ones', () => {
    expect(parseSystemOneResponse({ model: 'nimble', answers: [] })).toBeUndefined();
    for (const answer of [null, [], 1, 'choice', {}, { type: 1 }, new Date()]) {
      expect(
        parseSystemOneResponse({
          model: 'nimble',
          answers: { good: { type: 'noul', value: true }, bad: answer },
        }),
      ).toBeUndefined();
    }
  });

  test('accepts a well-formed body', () => {
    const parsed = parseSystemOneResponse({ model: 'nimble', answers: {} });
    expect(parsed?.model).toBe('nimble');
  });
});

describe('isUnsafeSegment', () => {
  test('callers can reject hostile path segments and allow ordinary names', () => {
    for (const segment of ['__proto__', 'constructor', 'prototype']) {
      expect(isUnsafeSegment(segment)).toBe(true);
    }
    expect(isUnsafeSegment('commandKind')).toBe(false);
  });
});
