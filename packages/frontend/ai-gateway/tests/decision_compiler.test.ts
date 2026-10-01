// packages/frontend/ai-gateway/tests/decision_compiler.test.ts
//
// Contract C-566 AC-1/AC-2: the schema compiler accepts exactly what it can
// enforce and rejects everything else.
//
// Every rejection case here exists because the alternative is a plan that looks
// compatible and produces a value the original schema refuses. A compiler that
// is lenient about constraints is worse than no compiler, because it moves the
// failure from a clear rejection to a wrong game state.

import { describe, expect, test } from 'bun:test';
import Type from 'typebox';
import type { DecisionIncompatibilityCode } from '../src/lib/decision/index.ts';
import { analyzeDecisionSchema, DECISION_COMPILER_VERSION } from '../src/lib/decision/index.ts';

/** Compiles and returns the rejection codes, asserting failure. */
const rejectCodes = (
  schema: unknown,
  limits?: Record<string, number>,
): DecisionIncompatibilityCode[] => {
  const analysis = analyzeDecisionSchema({ schema, limits });
  if (analysis.ok) {
    throw new Error('expected rejection but the schema compiled');
  }
  return analysis.reasons.map((reason) => reason.code);
};

/** Compiles and returns the plan, asserting success. */
const compile = (schema: unknown) => {
  const analysis = analyzeDecisionSchema({ schema });
  if (!analysis.ok) {
    throw new Error(`expected success but got ${JSON.stringify(analysis.reasons)}`);
  }
  return analysis.plan;
};

describe('analyzeDecisionSchema — accepted shapes', () => {
  test('boolean property becomes a boolean question', () => {
    const schema = Type.Object(
      { battle: Type.Boolean({ description: 'Does this describe a combat encounter?' }) },
      { additionalProperties: false },
    );
    const plan = compile(schema);
    expect(plan.questions).toHaveLength(1);
    expect(plan.questions[0]?.kind).toBe('boolean');
    expect(plan.questions[0]?.path).toEqual(['battle']);
    expect(plan.compilerVersion).toBe(DECISION_COMPILER_VERSION);
  });

  test('TypeBox anyOf-of-const becomes a choice with the exact literals preserved', () => {
    const schema = Type.Object(
      {
        kind: Type.Union([
          Type.Literal('trade'),
          Type.Literal('recruit'),
          Type.Literal('presentEvidence'),
        ]),
      },
      { additionalProperties: false },
    );
    const plan = compile(schema);
    const options = plan.questions[0]?.options ?? [];
    expect(options.map((option) => option.value).sort()).toEqual([
      'presentEvidence',
      'recruit',
      'trade',
    ]);
  });

  test('JSON Schema enum preserves exact strings, numbers and booleans', () => {
    const schema = {
      type: 'object',
      properties: { tier: { type: 'string', enum: ['bronze', 'iron', 'silver'] } },
      required: ['tier'],
      additionalProperties: false,
    };
    const plan = compile(schema);
    expect(plan.questions[0]?.options?.map((option) => option.value)).toEqual([
      'bronze',
      'iron',
      'silver',
    ]);
  });

  test('a two-value boolean union is a boolean question, not a two-option choice', () => {
    const schema = {
      type: 'object',
      properties: {
        engaged: {
          anyOf: [
            { type: 'boolean', const: true },
            { type: 'boolean', const: false },
          ],
        },
      },
      required: ['engaged'],
      additionalProperties: false,
    };
    expect(compile(schema).questions[0]?.kind).toBe('boolean');
  });

  test('singleton const is a schema-pinned constant, never a question', () => {
    const schema = {
      type: 'object',
      properties: {
        kind: { type: 'string', const: 'trade' },
        phase: { type: 'string', const: 'player' },
      },
      required: ['kind', 'phase'],
      additionalProperties: false,
    };
    const plan = compile(schema);
    expect(plan.questions).toHaveLength(0);
    expect(plan.constants).toEqual([
      { path: ['kind'], value: 'trade' },
      { path: ['phase'], value: 'player' },
    ]);
  });

  test('singleton enum is a constant too', () => {
    const schema = {
      type: 'object',
      properties: { verdict: { type: 'string', enum: ['only'] } },
      required: ['verdict'],
      additionalProperties: false,
    };
    const plan = compile(schema);
    expect(plan.questions).toHaveLength(0);
    expect(plan.constants).toEqual([{ path: ['verdict'], value: 'only' }]);
  });

  test('nested closed objects produce stable nested paths', () => {
    const schema = {
      type: 'object',
      properties: {
        command: {
          type: 'object',
          properties: { kind: { type: 'string', enum: ['trade', 'recruit'] } },
          required: ['kind'],
          additionalProperties: false,
        },
      },
      required: ['command'],
      additionalProperties: false,
    };
    expect(compile(schema).questions[0]?.path).toEqual(['command', 'kind']);
  });

  test('local $ref is resolved', () => {
    const schema = {
      // biome-ignore lint/style/useNamingConvention: verbatim JSON Schema keyword
      $defs: { Skill: { type: 'string', enum: ['Persuasion', 'Intimidation'] } },
      type: 'object',
      properties: { skill: { $ref: '#/$defs/Skill' } },
      required: ['skill'],
      additionalProperties: false,
    };
    expect(compile(schema).questions[0]?.options?.map((option) => option.value)).toEqual([
      'Intimidation',
      'Persuasion',
    ]);
  });

  test('legacy #/definitions pointer is resolved', () => {
    const schema = {
      // biome-ignore lint/style/useNamingConvention: verbatim JSON Schema keyword
      definitions: { Skill: { type: 'string', enum: ['A', 'B'] } },
      type: 'object',
      properties: { skill: { $ref: '#/definitions/Skill' } },
      required: ['skill'],
      additionalProperties: false,
    };
    expect(compile(schema).questions[0]?.kind).toBe('choice');
  });

  test('an empty closed object is a constant, not a zero-option question', () => {
    const schema = { type: 'object', properties: {}, required: [], additionalProperties: false };
    const plan = compile(schema);
    expect(plan.questions).toHaveLength(0);
  });
});

describe('analyzeDecisionSchema — key-order invariance', () => {
  test('property order does not change the plan', () => {
    const first = {
      type: 'object',
      properties: { alpha: { type: 'string', enum: ['x', 'y'] }, beta: { type: 'boolean' } },
      required: ['alpha', 'beta'],
      additionalProperties: false,
    };
    const second = {
      type: 'object',
      properties: { beta: { type: 'boolean' }, alpha: { type: 'string', enum: ['x', 'y'] } },
      required: ['beta', 'alpha'],
      additionalProperties: false,
    };
    const a = compile(first);
    const b = compile(second);
    expect(a.questions.map((question) => question.key)).toEqual(
      b.questions.map((question) => question.key),
    );
    expect(a.questions.map((question) => question.path)).toEqual(
      b.questions.map((question) => question.path),
    );
    expect(a.constants).toEqual(b.constants);
    expect(a.groups).toEqual(b.groups);
  });

  test('option declaration order does not change option keys or values', () => {
    const first = {
      type: 'object',
      properties: { tier: { type: 'string', enum: ['bronze', 'iron', 'silver'] } },
      required: ['tier'],
      additionalProperties: false,
    };
    const second = {
      type: 'object',
      properties: { tier: { type: 'string', enum: ['silver', 'bronze', 'iron'] } },
      required: ['tier'],
      additionalProperties: false,
    };
    expect(compile(first).questions).toEqual(compile(second).questions);
  });
});

describe('analyzeDecisionSchema — rejected shapes', () => {
  test('arbitrary string, number and integer properties are rejected', () => {
    expect(
      rejectCodes({
        type: 'object',
        properties: {
          name: { type: 'string' },
          amount: { type: 'number' },
          roll: { type: 'integer', minimum: 5 },
        },
        required: ['name', 'amount', 'roll'],
        additionalProperties: false,
      }),
    ).toContain('unsupported-property-type');
  });

  test('arrays are rejected, including bounded ones', () => {
    expect(
      rejectCodes({
        type: 'object',
        properties: {
          steps: { type: 'array', items: { type: 'boolean' }, minItems: 1, maxItems: 8 },
        },
        required: ['steps'],
        additionalProperties: false,
      }),
    ).toEqual(['unsupported-array']);
  });

  test('an optional field is rejected because absence is not a primitive', () => {
    expect(
      rejectCodes({
        type: 'object',
        properties: { battle: { type: 'boolean' }, enemy: { type: 'string' } },
        required: ['battle'],
        additionalProperties: false,
      }),
    ).toEqual(['optional-field']);
  });

  test('a nullable field is rejected', () => {
    expect(
      rejectCodes({
        type: 'object',
        properties: { kind: { anyOf: [{ type: 'string', const: 'trade' }, { type: 'null' }] } },
        required: ['kind'],
        additionalProperties: false,
      }),
    ).toEqual(['nullable-field']);
  });

  test('an open record is rejected', () => {
    expect(
      rejectCodes({
        type: 'object',
        properties: { battle: { type: 'boolean' } },
        required: ['battle'],
      }),
    ).toEqual(['open-record']);
    expect(
      rejectCodes({
        type: 'object',
        properties: { battle: { type: 'boolean' } },
        required: ['battle'],
        additionalProperties: { type: 'string' },
      }),
    ).toEqual(['open-record']);
  });

  test('an unimplemented constraint is refused rather than dropped', () => {
    const reasons = rejectCodes({
      type: 'object',
      properties: { battle: { type: 'boolean' }, note: { type: 'string', minLength: 3 } },
      required: ['battle', 'note'],
      additionalProperties: false,
    });
    expect(reasons).toContain('unsupported-property-type');
  });

  test('an extra keyword on an otherwise compilable node is refused', () => {
    const reasons = rejectCodes({
      type: 'object',
      properties: { engaged: { type: 'boolean', pattern: '^true$' } },
      required: ['engaged'],
      additionalProperties: false,
    });
    expect(reasons).toEqual(['unsupported-constraint']);
  });

  test('an enum narrowed by an extra keyword is refused, never narrowed silently', () => {
    const reasons = rejectCodes({
      type: 'object',
      properties: { tier: { enum: ['iron', 'silver'], minLength: 3 } },
      required: ['tier'],
      additionalProperties: false,
    });
    expect(reasons).toEqual(['unsupported-constraint']);
  });

  test('conditional schemas are refused', () => {
    for (const keyword of ['allOf', 'oneOf', 'not', 'if']) {
      const reasons = rejectCodes({
        type: 'object',
        properties: {
          battle: {
            type: 'boolean',
            [keyword]: keyword === 'if' ? { type: 'boolean' } : [{ type: 'boolean' }],
          },
        },
        required: ['battle'],
        additionalProperties: false,
      });
      expect(reasons).toContain('unsupported-constraint');
    }
  });

  test('a union of object variants is refused rather than partially compiled', () => {
    const reasons = rejectCodes(
      Type.Union([
        Type.Object({ kind: Type.Literal('trade') }, { additionalProperties: false }),
        Type.Object({ kind: Type.Literal('recruit') }, { additionalProperties: false }),
      ]),
    );
    expect(reasons).toContain('unsupported-property-type');
  });

  test('a union with one non-literal branch is refused', () => {
    const reasons = rejectCodes({
      type: 'object',
      properties: { kind: { anyOf: [{ type: 'string', const: 'trade' }, { type: 'string' }] } },
      required: ['kind'],
      additionalProperties: false,
    });
    expect(reasons).toContain('unsupported-property-type');
  });

  test('heterogeneous literal options are refused rather than coerced', () => {
    expect(
      rejectCodes({
        type: 'object',
        properties: { tier: { enum: ['iron', 3, true] } },
        required: ['tier'],
        additionalProperties: false,
      }),
    ).toEqual(['mixed-choice-types']);
  });

  test('an empty enum is refused', () => {
    expect(
      rejectCodes({
        type: 'object',
        properties: { tier: { enum: [] } },
        required: ['tier'],
        additionalProperties: false,
      }),
    ).toEqual(['empty-choice']);
  });

  test('a schema node that constrains nothing is refused', () => {
    expect(
      rejectCodes({
        type: 'object',
        properties: { anything: {} },
        required: ['anything'],
        additionalProperties: false,
      }),
    ).toEqual(['unsupported-constraint']);
  });

  test('a required property with no schema is refused', () => {
    expect(
      rejectCodes({
        type: 'object',
        properties: { battle: { type: 'boolean' } },
        required: ['battle', 'ghost'],
        additionalProperties: false,
      }),
    ).toEqual(['unsupported-constraint']);
  });

  test('an external $ref is refused', () => {
    expect(
      rejectCodes({
        type: 'object',
        properties: { skill: { $ref: 'https://example.com/skill.json' } },
        required: ['skill'],
        additionalProperties: false,
      }),
    ).toEqual(['external-reference']);
  });

  test('an unresolvable local $ref is refused', () => {
    expect(
      rejectCodes({
        type: 'object',
        properties: { skill: { $ref: '#/$defs/Missing' } },
        required: ['skill'],
        additionalProperties: false,
      }),
    ).toEqual(['external-reference']);
  });

  test('a $ref cycle is refused instead of overflowing the stack', () => {
    const schema = {
      // biome-ignore lint/style/useNamingConvention: verbatim JSON Schema keyword
      $defs: { A: { $ref: '#/$defs/B' }, B: { $ref: '#/$defs/A' } },
      type: 'object',
      properties: { skill: { $ref: '#/$defs/A' } },
      required: ['skill'],
      additionalProperties: false,
    };
    expect(rejectCodes(schema)).toEqual(['circular-reference']);
  });

  test('a self-referential $ref is refused', () => {
    const schema = {
      $defs: {
        // biome-ignore lint/style/useNamingConvention: verbatim JSON Schema definition name
        A: {
          type: 'object',
          properties: { self: { $ref: '#/$defs/A' } },
          required: ['self'],
          additionalProperties: false,
        },
      },
      type: 'object',
      properties: { node: { $ref: '#/$defs/A' } },
      required: ['node'],
      additionalProperties: false,
    };
    expect(rejectCodes(schema)).toContain('circular-reference');
  });

  test('a $ref narrowed by a sibling constraint is refused', () => {
    const schema = {
      // biome-ignore lint/style/useNamingConvention: verbatim JSON Schema keyword
      $defs: { Skill: { type: 'string', enum: ['A', 'B'] } },
      type: 'object',
      properties: { skill: { $ref: '#/$defs/Skill', enum: ['A'] } },
      required: ['skill'],
      additionalProperties: false,
    };
    expect(rejectCodes(schema)).toEqual(['unsupported-constraint']);
  });

  test('hostile property names are refused', () => {
    for (const name of ['__proto__', 'constructor', 'prototype']) {
      const schema = {
        type: 'object',
        properties: { [name]: { type: 'boolean' } },
        required: [name],
        additionalProperties: false,
      };
      const analysis = analyzeDecisionSchema({ schema });
      // JSON.parse-free construction must not let the literal reach Object.keys
      // through the prototype; either way it must never become a question.
      if (analysis.ok) {
        expect(analysis.plan.questions).toHaveLength(0);
      } else {
        expect(analysis.reasons[0]?.code).toBe('unsafe-property-name');
      }
    }
  });

  test('a hostile name nested inside a real object is refused', () => {
    const schema = JSON.parse(
      '{"type":"object","properties":{"inner":{"type":"object","properties":{"__proto__":{"type":"boolean"}},"required":["__proto__"],"additionalProperties":false}},"required":["inner"],"additionalProperties":false}',
    );
    expect(rejectCodes(schema)).toEqual(['unsafe-property-name']);
  });

  test('a non-object root is refused', () => {
    expect(rejectCodes('nope')).toEqual(['unsupported-root-kind']);
    expect(rejectCodes(null)).toEqual(['unsupported-root-kind']);
    expect(rejectCodes([{ type: 'boolean' }])).toEqual(['unsupported-root-kind']);
  });
});

describe('analyzeDecisionSchema — bounds', () => {
  const wideChoice = (count: number) => ({
    type: 'object',
    properties: {
      tier: { type: 'string', enum: Array.from({ length: count }, (_, index) => `t${index}`) },
    },
    required: ['tier'],
    additionalProperties: false,
  });

  test('option limit is enforced', () => {
    expect(rejectCodes(wideChoice(9), { maxOptions: 8 })).toEqual(['option-limit-exceeded']);
  });

  test('question limit is enforced', () => {
    const schema = {
      type: 'object',
      properties: {
        a: { type: 'boolean' },
        b: { type: 'boolean' },
        c: { type: 'boolean' },
      },
      required: ['a', 'b', 'c'],
      additionalProperties: false,
    };
    expect(rejectCodes(schema, { maxQuestions: 2 })).toEqual(['question-limit-exceeded']);
  });

  test('depth limit is enforced', () => {
    const schema = {
      type: 'object',
      properties: {
        a: {
          type: 'object',
          properties: { b: { type: 'boolean' } },
          required: ['b'],
          additionalProperties: false,
        },
      },
      required: ['a'],
      additionalProperties: false,
    };
    expect(rejectCodes(schema, { maxDepth: 0 })).toEqual(['depth-limit-exceeded']);
  });

  test('union branch limit is enforced', () => {
    const branches = Array.from({ length: 5 }, (_, index) => ({
      type: 'string',
      const: `v${index}`,
    }));
    const schema = {
      type: 'object',
      properties: { kind: { anyOf: branches } },
      required: ['kind'],
      additionalProperties: false,
    };
    expect(rejectCodes(schema, { maxUnionBranches: 4 })).toEqual(['union-branch-limit-exceeded']);
  });

  test('reasons name the offending property path', () => {
    const analysis = analyzeDecisionSchema({
      schema: {
        type: 'object',
        properties: {
          outer: {
            type: 'object',
            properties: { inner: { type: 'string' } },
            required: ['inner'],
            additionalProperties: false,
          },
        },
        required: ['outer'],
        additionalProperties: false,
      },
    });
    expect(analysis.ok).toBe(false);
    if (!analysis.ok) {
      expect(analysis.reasons[0]?.path).toEqual(['outer', 'inner']);
    }
  });
});
