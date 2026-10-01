// packages/frontend/ai-gateway/tests/decision_policy.test.ts
//
// Contract C-566 AC-3: structural compatibility is not semantic opt-in.
//
// Every test here encodes the same refusal: a schema can be perfectly
// compilable and still be a task this module will not send anywhere. The
// failure being prevented is a preclassifier in front of every existing LLM
// call — technically compatible, semantically meaningless, and quietly worse
// than the call it replaced.

import { describe, expect, test } from 'bun:test';
import Type from 'typebox';
import {
  analyzeDecisionSchema,
  bindDecisionPolicy,
  type DecisionIncompatibilityCode,
  type DecisionPlan,
  type DecisionTaskPolicy,
  resolveBooleanPolicy,
} from '../src/lib/decision/index.ts';

/** Two-field schema: one choice, one boolean, with authored descriptions. */
const schema = Type.Object(
  {
    action: Type.Union([Type.Literal('attack'), Type.Literal('heal'), Type.Literal('flee')]),
    target: Type.Union([Type.Literal('enemy'), Type.Literal('ally')]),
    urgent: Type.Boolean(),
  },
  { additionalProperties: false },
);

/** Compiles the shared schema, asserting success. */
const plan = (): DecisionPlan => {
  const analysis = analyzeDecisionSchema({ schema });
  if (!analysis.ok) {
    throw new Error('compile failed');
  }
  return analysis.plan;
};

/** Binding failure codes. */
const codes = (
  policy: DecisionTaskPolicy,
  supportedLanguages?: readonly ('en' | 'multi')[],
): DecisionIncompatibilityCode[] => {
  const binding = bindDecisionPolicy({ plan: plan(), policy, supportedLanguages });
  if (binding.ok) {
    throw new Error('expected binding failure');
  }
  return binding.reasons.map((reason) => reason.code);
};

/** A fully-authored policy; individual tests degrade exactly one field. */
const fullPolicy = (overrides?: Partial<DecisionTaskPolicy>): DecisionTaskPolicy => ({
  task: 'combat-action',
  enabled: true,
  language: 'en',
  instructions:
    'Decide which combat action the player message implies, given the current encounter.',
  fieldInstructions: {
    action: 'Which combat action does the player message imply right now?',
    target: 'Which combatant does that action apply to?',
    urgent: 'Does the player message read as time-critical in this encounter?',
  },
  optionDescriptions: {
    action: {
      attack: 'Attack the nearest living hostile combatant.',
      heal: 'Restore health to the most wounded ally.',
      flee: 'Withdraw from the encounter entirely.',
    },
    target: {
      enemy: 'A hostile combatant on the opposing side.',
      ally: 'An allied combatant on the player side.',
    },
  },
  ...overrides,
});

describe('bindDecisionPolicy — opt-in', () => {
  test('a task that has not opted in is refused even when the schema compiles', () => {
    expect(codes(fullPolicy({ enabled: false }))).toEqual(['semantic-opt-in-required']);
  });

  test('instructions that merely echo the task id are refused', () => {
    expect(codes(fullPolicy({ instructions: 'combat-action' }))).toEqual([
      'missing-task-instructions',
    ]);
  });

  test('instructions that are too short to mean anything are refused', () => {
    expect(codes(fullPolicy({ instructions: 'pick' }))).toEqual(['missing-task-instructions']);
  });

  test('an instruction that only repeats a field name is refused as opaque', () => {
    expect(
      codes(
        fullPolicy({ fieldInstructions: { ...fullPolicy().fieldInstructions, action: 'action' } }),
      ),
    ).toEqual(['opaque-field-name']);
    expect(
      codes(
        fullPolicy({ fieldInstructions: { ...fullPolicy().fieldInstructions, action: 'Action ' } }),
      ),
    ).toEqual(['opaque-field-name']);
  });

  test('a field with neither an instruction nor a schema description is refused', () => {
    const bare = Type.Object({ mystery: Type.Boolean() }, { additionalProperties: false });
    const analysis = analyzeDecisionSchema({ schema: bare });
    if (!analysis.ok) {
      throw new Error('compile failed');
    }
    const binding = bindDecisionPolicy({
      plan: analysis.plan,
      policy: {
        task: 'mystery',
        enabled: true,
        instructions: 'Decide whether the mystery flag applies to this message.',
      },
    });
    expect(binding.ok).toBe(false);
    if (!binding.ok) {
      expect(binding.reasons[0]?.code).toBe('missing-field-instructions');
    }
  });

  test('a schema-authored description is accepted as the instruction', () => {
    const described = Type.Object(
      {
        battle: Type.Boolean({
          description: 'Does the message describe the start of a combat encounter?',
        }),
      },
      { additionalProperties: false },
    );
    const analysis = analyzeDecisionSchema({ schema: described });
    if (!analysis.ok) {
      throw new Error('compile failed');
    }
    const binding = bindDecisionPolicy({
      plan: analysis.plan,
      policy: {
        task: 'battle-trigger',
        enabled: true,
        instructions: 'Decide whether this message begins a combat encounter.',
      },
    });
    expect(binding.ok).toBe(true);
    if (binding.ok) {
      expect(binding.plan.questions[0]?.instructions).toBe(
        'Does the message describe the start of a combat encounter?',
      );
    }
  });

  test('an option without a description is refused', () => {
    const base = fullPolicy().optionDescriptions;
    expect(
      codes(
        fullPolicy({
          optionDescriptions: { ...base, action: { attack: base?.action?.attack ?? '' } },
        }),
      ),
    ).toEqual(['missing-option-descriptions']);
  });
});

describe('bindDecisionPolicy — language', () => {
  test('a language the checkpoint does not declare is refused', () => {
    expect(codes(fullPolicy({ language: 'multi' }), ['en'])).toEqual(['unsupported-language']);
  });

  test('a declared language is accepted', () => {
    const binding = bindDecisionPolicy({
      plan: plan(),
      policy: fullPolicy(),
      supportedLanguages: ['en', 'multi'],
    });
    expect(binding.ok).toBe(true);
  });

  test('an unrecognised language tag is refused', () => {
    expect(codes(fullPolicy({ language: 'fr' as never }))).toEqual(['unsupported-language']);
  });
});

describe('bindDecisionPolicy — correlated fields', () => {
  const correlations = [
    {
      paths: [['action'], ['target']],
      mode: 'combination' as const,
      legalTuples: [
        ['attack', 'enemy'],
        ['heal', 'ally'],
      ],
    },
  ];

  test('uncorrelated fields become one independent group by default', () => {
    const binding = bindDecisionPolicy({ plan: plan(), policy: fullPolicy() });
    expect(binding.ok).toBe(true);
    if (binding.ok) {
      expect(binding.groups).toHaveLength(1);
      expect(binding.groups[0]?.dispatch).toBe('independent');
    }
  });

  test('an undeclared correlation is refused rather than answered independently', () => {
    expect(
      codes(fullPolicy({ correlations: [{ paths: [['action'], ['target']], mode: 'reject' }] })),
    ).toEqual(['correlated-fields-unsupported']);
  });

  test('combination mode expands into one bounded legal-combination question', () => {
    const binding = bindDecisionPolicy({ plan: plan(), policy: fullPolicy({ correlations }) });
    expect(binding.ok).toBe(true);
    if (binding.ok) {
      const question = binding.plan.questions.find((candidate) => candidate.kind === 'combination');
      expect(question).toBeDefined();
      expect(
        question?.combinationOptions?.map((option) => option.values.map((entry) => entry.value)),
      ).toEqual([
        ['attack', 'enemy'],
        ['heal', 'ally'],
      ]);
      expect(question?.combinationOptions?.[0]?.values).toHaveLength(2);
      expect(binding.groups[0]?.dispatch).toBe('combination');
      // The two original questions are gone; they cannot be answered apart.
      expect(
        binding.plan.questions.filter((candidate) => candidate.path[0] === 'target'),
      ).toHaveLength(0);
    }
  });

  test('an unbounded expansion is refused before it reaches the wire', () => {
    const wide = Type.Object(
      {
        action: Type.Union(Array.from({ length: 9 }, (_, index) => Type.Literal(`a${index}`))),
        target: Type.Union(Array.from({ length: 9 }, (_, index) => Type.Literal(`t${index}`))),
      },
      { additionalProperties: false },
    );
    const analysis = analyzeDecisionSchema({ schema: wide, limits: { maxOptions: 16 } });
    if (!analysis.ok) {
      throw new Error('compile failed');
    }
    const describeAll = (prefix: string): Record<string, string> =>
      Object.fromEntries(
        Array.from({ length: 9 }, (_, index) => [
          `o${index}`,
          `Option ${prefix}${index} for the wide schema.`,
        ]),
      );
    const binding = bindDecisionPolicy({
      plan: analysis.plan,
      policy: fullPolicy({
        limits: { maxCombinations: 16 },
        fieldInstructions: {
          action: 'Which of the nine actions does the message imply?',
          target: 'Which of the nine targets does that action apply to?',
          urgent: 'Does the message read as time-critical in this encounter?',
        },
        optionDescriptions: { action: describeAll('action'), target: describeAll('target') },
        correlations: [{ paths: [['action'], ['target']], mode: 'combination' }],
      }),
    });
    expect(binding.ok).toBe(false);
    if (!binding.ok) {
      expect(binding.reasons[0]?.code).toBe('combination-limit-exceeded');
    }
  });

  test('staged mode is refused until legal tuples can be enforced', () => {
    expect(
      codes(fullPolicy({ correlations: [{ paths: [['action'], ['target']], mode: 'staged' }] })),
    ).toEqual(['correlated-fields-unsupported']);
  });

  test('combination mode requires explicit matching legal tuples', () => {
    for (const legalTuples of [undefined, [], [['heal', 'missing']]]) {
      expect(
        codes(
          fullPolicy({
            correlations: [{ paths: [['action'], ['target']], mode: 'combination', legalTuples }],
          }),
        ),
      ).toEqual(['correlated-fields-unsupported']);
    }
  });

  test('a correlation containing a boolean refuses an empty combination', () => {
    const binding = bindDecisionPolicy({
      plan: plan(),
      policy: fullPolicy({
        correlations: [
          { paths: [['action'], ['urgent']], mode: 'combination', legalTuples: [['attack', true]] },
        ],
      }),
    });
    expect(binding.ok).toBe(false);
    if (!binding.ok) {
      expect(binding.reasons[0]?.code).toBe('correlated-fields-unsupported');
      expect(binding.reasons[0]?.detail).toContain('only choice fields');
    }
  });
});

describe('resolveBooleanPolicy', () => {
  test('a task with no declared policy gets a conservative default, not 0.5', () => {
    const policy = resolveBooleanPolicy({ task: 'x', enabled: true });
    expect(policy.acceptProbability).toBeGreaterThan(0.5);
    expect(policy.fallback).toBe('reject');
  });

  test('a task may declare its own thresholds', () => {
    const policy = resolveBooleanPolicy(
      fullPolicy({
        booleanPolicy: { acceptProbability: 0.7, confidentProbability: 0.9, fallback: 'llm' },
      }),
    );
    expect(policy).toEqual({ acceptProbability: 0.7, confidentProbability: 0.9, fallback: 'llm' });
  });

  test('an inverted or out-of-range threshold is refused at binding time', () => {
    expect(
      codes(
        fullPolicy({
          booleanPolicy: { acceptProbability: 0.9, confidentProbability: 0.6, fallback: 'reject' },
        }),
      ),
    ).toEqual(['invalid-boolean-policy']);
    expect(
      codes(
        fullPolicy({
          booleanPolicy: { acceptProbability: 0.2, confidentProbability: 1.4, fallback: 'reject' },
        }),
      ),
    ).toEqual(['invalid-boolean-policy']);
    expect(
      codes(
        fullPolicy({
          booleanPolicy: {
            acceptProbability: Number.NaN,
            confidentProbability: 0.9,
            fallback: 'reject',
          },
        }),
      ),
    ).toEqual(['invalid-boolean-policy']);
  });
});
