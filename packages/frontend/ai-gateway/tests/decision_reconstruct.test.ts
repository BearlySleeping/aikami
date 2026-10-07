// packages/frontend/ai-gateway/tests/decision_reconstruct.test.ts
//
// Contract C-566 AC-2: reconstruction restores exact values and refuses
// everything else.
//
// The invariant under test is that a decision backend can only ever move the
// game between states the ORIGINAL schema already allows. Anything a backend
// invents — a question it was never asked, an option that does not exist, a
// probability outside [0,1], a value the game rules reject — must be a typed
// failure, never a plausible-looking object.

import { describe, expect, test } from 'bun:test';
import Type from 'typebox';
import {
  analyzeDecisionSchema,
  bindDecisionPolicy,
  type DecisionPlan,
  type DecisionTaskPolicy,
  reconstructDecisionValue,
} from '../src/lib/decision/index.ts';

/** Builds a bound plan, asserting both stages succeed. */
const boundPlan = (schema: unknown, policy: DecisionTaskPolicy): DecisionPlan => {
  const analysis = analyzeDecisionSchema({ schema });
  if (!analysis.ok) {
    throw new Error(`compile failed: ${JSON.stringify(analysis.reasons)}`);
  }
  const binding = bindDecisionPolicy({ plan: analysis.plan, policy });
  if (!binding.ok) {
    throw new Error(`bind failed: ${JSON.stringify(binding.reasons)}`);
  }
  return binding.plan;
};

/** The mixed schema used across reconstruction tests. */
const mixedSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal('trade'),
      Type.Literal('recruit'),
      Type.Literal('presentEvidence'),
      Type.Literal('skillCheck'),
    ]),
    urgent: Type.Boolean(),
    phase: Type.Literal('player'),
  },
  { additionalProperties: false },
);

/** Policy with authored instructions and descriptions for `mixedSchema`. */
const mixedPolicy = (overrides?: Partial<DecisionTaskPolicy>): DecisionTaskPolicy => ({
  task: 'dialogue-command-kind',
  enabled: true,
  instructions: 'Decide which dialogue command the player message asks for.',
  fieldInstructions: {
    kind: 'Which dialogue command does the player message request?',
    urgent: 'Does the player message read as time-critical right now?',
  },
  optionDescriptions: {
    kind: {
      trade: 'The player wants to open the trade overlay.',
      recruit: 'The player asks the NPC to join the party.',
      presentEvidence: 'The player hands over a piece of evidence.',
      skillCheck: 'The player asks for a d20 skill check.',
    },
  },
  ...overrides,
});

/** Question key for one property path in a bound plan. */
const kindQuestionKey = (plan: DecisionPlan, path: readonly string[]): string => {
  const question = plan.questions.find((candidate) => candidate.path.join('.') === path.join('.'));
  if (question === undefined) {
    throw new Error(`no question for ${path.join('.')}`);
  }
  return question.key;
};

/** Option key for a literal in a bound plan question. */
const optionKeyFor = (plan: DecisionPlan, path: readonly string[], value: string): string => {
  const question = plan.questions.find((candidate) => candidate.path.join('.') === path.join('.'));
  const option = question?.options?.find((candidate) => candidate.value === value);
  if (option === undefined) {
    throw new Error(`no option ${value} on ${path.join('.')}`);
  }
  return option.key;
};

describe('reconstructDecisionValue — exact restoration', () => {
  test('restores strings, booleans and schema-pinned constants exactly', () => {
    const plan = boundPlan(mixedSchema, mixedPolicy());
    const result = reconstructDecisionValue({
      plan,
      schema: mixedSchema,
      answers: [
        {
          questionKey: kindQuestionKey(plan, ['kind']),
          optionKey: optionKeyFor(plan, ['kind'], 'skillCheck'),
        },
        { questionKey: kindQuestionKey(plan, ['urgent']), booleanValue: true },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ kind: 'skillCheck', urgent: true, phase: 'player' });
      // `urgent` must be a real boolean, never the string 'true'.
      expect(typeof result.value.urgent).toBe('boolean');
      expect(typeof result.value.kind).toBe('string');
    }
  });

  test('preserves numeric literals as numbers', () => {
    const schema = Type.Object(
      { tier: Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3)]) },
      { additionalProperties: false },
    );
    const plan = boundPlan(schema, {
      task: 'tier-pick',
      enabled: true,
      instructions: 'Choose the numeric tier that matches the described rank.',
      fieldInstructions: { tier: 'Which numeric tier matches the described rank?' },
      optionDescriptions: {
        tier: {
          1: 'Rank one, the lowest of the three.',
          2: 'Rank two, the middle of three.',
          3: 'Rank three, the highest of three.',
        },
      },
    });
    const result = reconstructDecisionValue({
      plan,
      schema,
      answers: [
        { questionKey: plan.questions[0]?.key ?? '', optionKey: optionKeyFor(plan, ['tier'], 2) },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tier).toBe(2);
      expect(typeof result.value.tier).toBe('number');
    }
  });

  test('rebuilds nested objects at the right depth', () => {
    const schema = Type.Object(
      {
        command: Type.Object(
          { kind: Type.Union([Type.Literal('trade'), Type.Literal('recruit')]) },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    );
    const plan = boundPlan(schema, {
      task: 'command-kind',
      enabled: true,
      instructions: 'Decide which dialogue command the player message asks for.',
      fieldInstructions: {
        // biome-ignore lint/style/useNamingConvention: encoded path key, see pathKeyFor
        command__kind: 'Which dialogue command does the player message request?',
      },
      optionDescriptions: {
        // biome-ignore lint/style/useNamingConvention: encoded path key, see pathKeyFor
        command__kind: {
          trade: 'The player wants to open the trade overlay.',
          recruit: 'The player asks the NPC to join.',
        },
      },
    });
    const result = reconstructDecisionValue({
      plan,
      schema,
      answers: [
        {
          questionKey: plan.questions[0]?.key ?? '',
          optionKey: optionKeyFor(plan, ['command', 'kind'], 'recruit'),
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ command: { kind: 'recruit' } });
    }
  });

  test('a property literally named with a dot does not collide with a nested path', () => {
    const schema = Type.Object(
      {
        'a.b': Type.Boolean(),
        a: Type.Object({ b: Type.Boolean() }, { additionalProperties: false }),
      },
      { additionalProperties: false },
    );
    const plan = boundPlan(schema, {
      task: 'dotted',
      enabled: true,
      instructions: 'Decide whether each dotted property is set for this message.',
      fieldInstructions: {
        // biome-ignore lint/style/useNamingConvention: encoded path key, see pathKeyFor
        a_b: 'Is the literal dotted property set for this message?',
        // biome-ignore lint/style/useNamingConvention: encoded path key, see pathKeyFor
        a__b: 'Is the nested property under a set for this message?',
      },
    });
    expect(plan.questions.map((question) => question.path)).toEqual([['a', 'b'], ['a.b']]);
  });
});

describe('reconstructDecisionValue — refusals', () => {
  const setup = () => {
    const plan = boundPlan(mixedSchema, mixedPolicy());
    const kindKey = plan.questions.find((question) => question.path[0] === 'kind')?.key ?? '';
    const urgentKey = plan.questions.find((question) => question.path[0] === 'urgent')?.key ?? '';
    return { plan, kindKey, urgentKey };
  };

  test('a missing answer is refused', () => {
    const { plan, kindKey } = setup();
    const result = reconstructDecisionValue({
      plan,
      schema: mixedSchema,
      answers: [{ questionKey: kindKey, optionKey: 'o0' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('missing-answer');
    }
  });

  test('an answer for a question that was never asked is refused', () => {
    const { plan, kindKey, urgentKey } = setup();
    const result = reconstructDecisionValue({
      plan,
      schema: mixedSchema,
      answers: [
        { questionKey: kindKey, optionKey: 'o0' },
        { questionKey: urgentKey, booleanValue: true },
        { questionKey: 'invented__deadbeef', optionKey: 'o0' },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('unknown-question-key');
    }
  });

  test('a missing option key is refused', () => {
    const { plan, kindKey, urgentKey } = setup();
    const result = reconstructDecisionValue({
      plan,
      schema: mixedSchema,
      answers: [{ questionKey: kindKey }, { questionKey: urgentKey, booleanValue: false }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('missing-option-key');
    }
  });

  test('an unknown option key is refused rather than guessed at', () => {
    const { plan, kindKey, urgentKey } = setup();
    const result = reconstructDecisionValue({
      plan,
      schema: mixedSchema,
      answers: [
        { questionKey: kindKey, optionKey: 'does-not-exist' },
        { questionKey: urgentKey, booleanValue: false },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('unknown-option-key');
    }
  });

  test('a non-boolean answer to a boolean question is refused', () => {
    const { plan, kindKey, urgentKey } = setup();
    const result = reconstructDecisionValue({
      plan,
      schema: mixedSchema,
      answers: [
        { questionKey: kindKey, optionKey: 'o0' },
        { questionKey: urgentKey, optionKey: 'o0' } as never,
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('ambiguous-answer');
    }
  });

  test('non-finite and out-of-range probabilities are refused', () => {
    const { plan, kindKey, urgentKey } = setup();
    for (const probabilities of [
      { o0: Number.NaN },
      { o0: 1.5 },
      { o0: -0.1 },
      { o0: Number.POSITIVE_INFINITY },
    ]) {
      const result = reconstructDecisionValue({
        plan,
        schema: mixedSchema,
        answers: [
          { questionKey: kindKey, optionKey: 'o0', probabilities },
          { questionKey: urgentKey, booleanValue: true },
        ],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('probability-out-of-range');
      }
    }
  });

  test('a value the original schema refuses is rejected at the final check', () => {
    // A plan compiled from a DIFFERENT schema answers its own questions
    // perfectly; only validating against the original schema catches the swap.
    const wrongPlan = boundPlan(
      Type.Object(
        { other: Type.Union([Type.Literal('x'), Type.Literal('y')]) },
        { additionalProperties: false },
      ),
      {
        task: 'other',
        enabled: true,
        instructions: 'Decide which of the two labels best describes the message.',
        fieldInstructions: { other: 'Which of the two labels best describes the message?' },
        optionDescriptions: {
          other: { x: 'The message matches label x best.', y: 'The message matches label y best.' },
        },
      },
    );
    const result = reconstructDecisionValue({
      plan: wrongPlan,
      schema: mixedSchema,
      answers: [
        {
          questionKey: wrongPlan.questions[0]?.key ?? '',
          optionKey: optionKeyFor(wrongPlan, ['other'], 'x'),
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('schema-validation-failed');
    }
  });

  test('a schema-valid but domain-invalid value is rejected by the caller validator', () => {
    const plan = boundPlan(mixedSchema, mixedPolicy());
    const result = reconstructDecisionValue({
      plan,
      schema: mixedSchema,
      answers: [
        {
          questionKey: plan.questions[0]?.key ?? '',
          optionKey: optionKeyFor(plan, ['kind'], 'skillCheck'),
        },
        { questionKey: plan.questions[1]?.key ?? '', booleanValue: true },
      ],
      domainValidate: (value) => value.kind !== 'skillCheck',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('schema-validation-failed');
      expect(result.failure.detail).toContain('domain validation');
    }
  });

  test('reconstruction does not pollute Object.prototype', () => {
    const before = (Object.prototype as Record<string, unknown>).polluted;
    const schema = Type.Object(
      { kind: Type.Union([Type.Literal('trade'), Type.Literal('recruit')]) },
      { additionalProperties: false },
    );
    const plan = boundPlan(schema, {
      task: 'pollution',
      enabled: true,
      instructions: 'Decide which dialogue command the player message asks for.',
      fieldInstructions: { kind: 'Which dialogue command does the player message request?' },
      optionDescriptions: {
        kind: { trade: 'Open the trade overlay.', recruit: 'Recruit the NPC.' },
      },
    });
    reconstructDecisionValue({
      plan,
      schema,
      answers: [
        {
          questionKey: plan.questions[0]?.key ?? '',
          optionKey: optionKeyFor(plan, ['kind'], 'trade'),
        },
      ],
    });
    expect((Object.prototype as Record<string, unknown>).polluted).toBe(before);
    expect(({} as Record<string, unknown>).kind).toBeUndefined();
  });

  test('an unsafe path in a hand-edited plan is refused', () => {
    const plan = boundPlan(mixedSchema, mixedPolicy());
    const tampered: DecisionPlan = {
      ...plan,
      questions: [{ key: 'forged', path: ['__proto__'], kind: 'boolean', groupId: 'independent' }],
      constants: [],
      groups: [{ id: 'independent', questionKeys: ['forged'], dispatch: 'independent' }],
    };
    const result = reconstructDecisionValue({
      plan: tampered,
      schema: Type.Object({ anything: Type.Boolean() }, { additionalProperties: false }),
      answers: [{ questionKey: 'forged', booleanValue: true }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('unsafe-property-path');
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
