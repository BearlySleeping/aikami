// packages/frontend/ai-gateway/tests/decision_runner.test.ts
//
// Contract C-566 AC-6: the runner is the only accept/abstain authority.
//
// Each test below pins one way a decision must NOT be silently made: not on a
// disabled task, not on an unready backend, not on a language the checkpoint
// does not declare, not on truncated input, and not on a probability that no
// measured calibration supports.

import { describe, expect, test } from 'bun:test';
import Type from 'typebox';
import {
  analyzeDecisionSchema,
  bindDecisionPolicy,
  createDeterministicDecisionAdapter,
  type DecisionAbstentionReason,
  type DecisionAdapter,
  type DecisionPlan,
  type DecisionTaskPolicy,
  runDecision,
} from '../src/lib/decision/index.ts';

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
  booleanPolicy: { acceptProbability: 0.9, confidentProbability: 0.98, fallback: 'reject' },
};

/** Bound pilot plan. */
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

/** Baseline adapter that answers the pilot with authored lexicon rules. */
const pilotAdapter = (): DecisionAdapter =>
  createDeterministicDecisionAdapter({
    rules: {
      rules: {
        commandKind: [{ match: ['buy', 'sell', 'trade', 'shop'], value: 'trade', weight: 1 }],
        urgent: [
          { match: ['now', 'quickly', 'hurry'], booleanValue: true, weight: 1 },
          { match: ['later', 'someday'], booleanValue: false, weight: 1 },
        ],
      },
    },
  });

/** Runs the pilot with sensible defaults, overriding whatever the test needs. */
const run = (overrides?: {
  policy?: DecisionTaskPolicy;
  adapter?: DecisionAdapter;
  context?: string;
  deadlineAt?: number;
  signal?: AbortSignal;
}) =>
  runDecision({
    plan: pilotPlan(),
    schema: pilotSchema,
    policy: overrides?.policy ?? pilotPolicy,
    adapter: overrides?.adapter ?? pilotAdapter(),
    context: overrides?.context ?? 'I would like to buy a lantern now',
    deadlineAt: overrides?.deadlineAt ?? Date.now() + 5000,
    signal: overrides?.signal ?? new AbortController().signal,
    requestId: 'req-1',
    stateRevision: 12,
  });

/** The abstention reason, asserting the call abstained. */
const reasonOf = async (
  promise: Promise<Awaited<ReturnType<typeof run>>>,
  expected: DecisionAbstentionReason,
): Promise<void> => {
  const result = await promise;
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe(expected);
  }
};

/** An adapter that is not ready, to model an absent or unprobed backend. */
const notReadyAdapter = (): DecisionAdapter => ({
  backendId: 'not-ready',
  dialect: 'test',
  capability: async () => ({
    backendId: 'not-ready',
    dialect: 'test',
    ready: false,
    notReadyReason: 'no sample inference has succeeded',
    primitives: ['boolean', 'choice'],
    maxOptions: 8,
    maxQuestions: 4,
    maxContextBytes: 1000,
    languages: ['en'],
  }),
  run: async () => {
    throw new Error('must not run an unready backend');
  },
});

describe('runDecision — acceptance', () => {
  test('an accepted decision returns the value and full provenance', async () => {
    const result = await run();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.commandKind).toBe('trade');
      expect(result.value.urgent).toBe(true);
      expect(result.provenance.backendId).toBe('deterministic-baseline');
      expect(result.provenance.outcome).toBe('accepted');
      expect(result.provenance.timings.totalMs).toBeGreaterThanOrEqual(0);
    }
  });

  test('a cached plan is recorded in provenance', async () => {
    const result = await runDecision({
      plan: pilotPlan(),
      schema: pilotSchema,
      policy: pilotPolicy,
      adapter: pilotAdapter(),
      context: 'I would like to buy a lantern now',
      deadlineAt: Date.now() + 5000,
      signal: new AbortController().signal,
      requestId: 'req-2',
      stateRevision: 12,
      planCacheHit: true,
    });
    if (result.ok) {
      expect(result.provenance.planCacheHit).toBe(true);
    }
  });
});

describe('runDecision — refusals', () => {
  test('a task that has not opted in never reaches the backend', async () => {
    await reasonOf(run({ policy: { ...pilotPolicy, enabled: false } }), 'disabled-by-policy');
  });

  test('an unready backend is never called', async () => {
    await reasonOf(run({ adapter: notReadyAdapter() }), 'backend-unavailable');
  });

  test('a language the checkpoint does not declare is refused', async () => {
    const adapter = createDeterministicDecisionAdapter({
      backendId: 'english-only',
      rules: { rules: {} },
    });
    const result = await runDecision({
      plan: pilotPlan(),
      schema: pilotSchema,
      policy: { ...pilotPolicy, language: 'multi' },
      adapter: {
        ...adapter,
        capability: async () => ({ ...(await adapter.capability()), languages: ['en'] }),
      },
      context: 'I would like to buy a lantern now',
      deadlineAt: Date.now() + 5000,
      signal: new AbortController().signal,
      requestId: 'req-3',
      stateRevision: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('language-unsupported');
    }
  });

  test('an oversize context is refused before dispatch, never truncated', async () => {
    await reasonOf(
      run({
        context: 'x'.repeat(10_000),
        policy: { ...pilotPolicy, limits: { maxContextBytes: 100 } },
      }),
      'context-too-large',
    );
  });

  test('a pre-cancelled call abstains as cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await reasonOf(run({ signal: controller.signal }), 'cancelled');
  });

  test('a boolean below the task accept threshold abstains rather than guessing', async () => {
    // Only one urgent rule matches, so the boolean has no opposing evidence
    // and the adapter reports full confidence. Force an uncalibrated backend
    // instead by overriding its answer.
    const adapter = pilotAdapter();
    const hedged: DecisionAdapter = {
      ...adapter,
      run: async (request) => {
        const response = await adapter.run(request);
        if (!response.ok) {
          return response;
        }
        return {
          ...response,
          answers: response.answers.map((answer) =>
            answer.booleanValue === undefined
              ? answer
              : { ...answer, probabilities: { true: 0.55, false: 0.45 } },
          ),
        };
      },
    };
    await reasonOf(run({ adapter: hedged }), 'below-accept-threshold');
  });

  test('a boolean with no reported probability is accepted, not invented into a threshold failure', async () => {
    const adapter = pilotAdapter();
    const silent: DecisionAdapter = {
      ...adapter,
      run: async (request) => {
        const response = await adapter.run(request);
        if (!response.ok) {
          return response;
        }
        return {
          ...response,
          answers: response.answers.map((answer) =>
            answer.booleanValue === undefined
              ? answer
              : { questionKey: answer.questionKey, booleanValue: answer.booleanValue },
          ),
        };
      },
    };
    const result = await run({ adapter: silent });
    expect(result.ok).toBe(true);
  });

  test('a backend answer that fails the original schema abstains as invalid-response', async () => {
    const adapter = pilotAdapter();
    const tampered: DecisionAdapter = {
      ...adapter,
      run: async (request) => {
        const response = await adapter.run(request);
        if (!response.ok) {
          return response;
        }
        return {
          ...response,
          answers: response.answers.map((answer) =>
            answer.optionKey === undefined ? answer : { ...answer, optionKey: 'not-a-real-option' },
          ),
        };
      },
    };
    await reasonOf(run({ adapter: tampered }), 'invalid-response');
  });

  test('a domain-invalid but schema-valid value abstains', async () => {
    const result = await runDecision({
      plan: pilotPlan(),
      schema: pilotSchema,
      policy: pilotPolicy,
      adapter: pilotAdapter(),
      context: 'I would like to buy a lantern now',
      deadlineAt: Date.now() + 5000,
      signal: new AbortController().signal,
      requestId: 'req-4',
      stateRevision: 1,
      domainValidate: (value) => value.commandKind !== 'trade',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid-response');
    }
  });
});
