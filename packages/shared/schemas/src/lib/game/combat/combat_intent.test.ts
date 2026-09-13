// packages/shared/schemas/src/lib/game/combat/combat_intent.test.ts
//
// C-525 AC-1: the intent envelope is typed, bounded, selector-only and closed.
//
//   AC-1  valid envelopes pass; unknown `kind`/extra props are rejected; free
//         text is capped through `COMBAT_INTENT_BOUNDS`; no field accepts a raw
//         id, coordinate, dice value, HP or hidden-entity reference
//   AC-8  hostile text cannot smuggle structure or unbounded content
//
// Contract: C-525 AC-1, AC-8

import { describe, expect, it } from 'bun:test';
import { Value } from 'typebox/value';
import {
  AbilitySelectorSchema,
  ActionIntentSchema,
  ClarificationRequestSchema,
  COMBAT_INTENT_BOUNDS,
  CompiledPlanSchema,
  EntitySelectorSchema,
  IntentInterpreterResultSchema,
  IntentStepSchema,
  LocationSelectorSchema,
  TrustedAbilityInputSchema,
  TrustedCellInputSchema,
} from './combat_intent';

// ── Fixtures ───────────────────────────────────────────────────────────

const validIntent = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  intentId: 'intent-1',
  encounterId: 'emberwatch-encounter-1',
  actorId: 'player-hero',
  basedOnRevision: 3,
  source: 'player_language',
  steps: [
    {
      kind: 'use_ability',
      ability: { kind: 'tag', value: 'basic_melee' },
      target: { kind: 'nearest_hostile' },
    },
  ],
  rawText: 'move to the nearest enemy and use my melee attack',
  ...overrides,
});

const validPlan = (): Record<string, unknown> => ({
  planId: 'intent-1:0',
  intentId: 'intent-1',
  encounterId: 'emberwatch-encounter-1',
  actorId: 'player-hero',
  basedOnRevision: 3,
  command: {
    kind: 'useAbility',
    combatantId: 'player-hero',
    abilityId: 'basic_melee',
    targetIds: ['emberwatch:goblin-1'],
  },
  forecast: {
    actionCost: 'action',
    affectedCells: [{ x: 1, y: 0 }],
    affectedEntityIds: ['emberwatch:goblin-1'],
    reactionRisks: [],
    objectiveEffects: [],
    warnings: [],
  },
  assumptions: ['target resolved by stable id order'],
  warnings: [],
});

// ── AC-1: valid envelopes ──────────────────────────────────────────────

describe('ActionIntentSchema (AC-1)', () => {
  it('accepts a selector-only intent envelope', () => {
    expect(Value.Check(ActionIntentSchema, validIntent())).toBe(true);
  });

  it('accepts a deterministic fallback intent with a bounded fallback list', () => {
    const intent = validIntent({
      source: 'fallback_parser',
      steps: [{ kind: 'move', destination: { kind: 'nearest_safe' } }],
      fallback: [{ kind: 'defend' }],
    });
    expect(Value.Check(ActionIntentSchema, intent)).toBe(true);
  });

  it('accepts every IntentStep variant', () => {
    const steps: unknown[] = [
      { kind: 'move', destination: { kind: 'nearest_safe' } },
      {
        kind: 'move',
        destination: {
          kind: 'relative',
          relativeTo: { kind: 'explicit', namedRef: 'the goblin' },
          band: 'melee',
          direction: 'toward',
        },
        stopAt: 'reach',
      },
      {
        kind: 'use_ability',
        ability: { kind: 'strongest', damageType: 'fire' },
        target: { kind: 'last_attacker' },
      },
      {
        kind: 'use_ability',
        ability: { kind: 'tag', value: 'bow_shot' },
        target: { kind: 'previous_target' },
      },
      { kind: 'defend' },
      { kind: 'wait' },
      { kind: 'end_turn' },
    ];
    for (const step of steps) {
      expect(Value.Check(IntentStepSchema, step)).toBe(true);
    }
  });

  it('accepts every EntitySelector / LocationSelector / AbilitySelector variant', () => {
    for (const selector of [
      { kind: 'nearest_hostile' },
      { kind: 'nearest_ally' },
      { kind: 'last_attacker' },
      { kind: 'previous_target' },
      { kind: 'explicit', namedRef: 'Goblin Scout' },
    ]) {
      expect(Value.Check(EntitySelectorSchema, selector)).toBe(true);
    }
    for (const selector of [
      { kind: 'nearest_safe' },
      {
        kind: 'relative',
        relativeTo: { kind: 'nearest_ally' },
        band: 'ranged',
        direction: 'away',
      },
    ]) {
      expect(Value.Check(LocationSelectorSchema, selector)).toBe(true);
    }
    for (const selector of [
      { kind: 'tag', value: 'basic_melee' },
      { kind: 'strongest' },
      { kind: 'strongest', damageType: 'slashing' },
    ]) {
      expect(Value.Check(AbilitySelectorSchema, selector)).toBe(true);
    }
  });

  it('accepts a compiled plan that carries a C-509 command and a forecast', () => {
    expect(Value.Check(CompiledPlanSchema, validPlan())).toBe(true);
  });
});

// ── AC-1: closed shapes ────────────────────────────────────────────────

describe('intent envelope is closed (AC-1)', () => {
  it('rejects an unknown step kind', () => {
    const intent = validIntent({
      steps: [{ kind: 'teleport', destination: { kind: 'nearest_safe' } }],
    });
    expect(Value.Check(ActionIntentSchema, intent)).toBe(false);
  });

  it('rejects an unknown extra property on the envelope and on a step', () => {
    expect(Value.Check(ActionIntentSchema, validIntent({ plan: 'x' }))).toBe(false);
    expect(
      Value.Check(ActionIntentSchema, validIntent({ steps: [{ kind: 'defend', damage: 999 }] })),
    ).toBe(false);
  });

  it('rejects an unknown source literal', () => {
    expect(Value.Check(ActionIntentSchema, validIntent({ source: 'model' }))).toBe(false);
  });

  it('rejects an empty step list (an intent must express something)', () => {
    expect(Value.Check(ActionIntentSchema, validIntent({ steps: [] }))).toBe(false);
  });

  it('rejects extra properties on a nested selector', () => {
    const intent = validIntent({
      steps: [
        {
          kind: 'use_ability',
          ability: { kind: 'tag', value: 'basic_melee', damage: 12 },
          target: { kind: 'nearest_hostile' },
        },
      ],
    });
    expect(Value.Check(ActionIntentSchema, intent)).toBe(false);
  });
});

// ── AC-1 / AC-8: bounds ────────────────────────────────────────────────

describe('COMBAT_INTENT_BOUNDS caps every free-text field (AC-1, AC-8)', () => {
  it('rejects rawText longer than the bound', () => {
    const oversized = 'a'.repeat(COMBAT_INTENT_BOUNDS.rawTextChars + 1);
    expect(Value.Check(ActionIntentSchema, validIntent({ rawText: oversized }))).toBe(false);
  });

  it('accepts rawText exactly at the bound', () => {
    const atBound = 'a'.repeat(COMBAT_INTENT_BOUNDS.rawTextChars);
    expect(Value.Check(ActionIntentSchema, validIntent({ rawText: atBound }))).toBe(true);
  });

  it('rejects more steps than the bound', () => {
    const steps = Array.from({ length: COMBAT_INTENT_BOUNDS.steps + 1 }, () => ({
      kind: 'defend',
    }));
    expect(Value.Check(ActionIntentSchema, validIntent({ steps }))).toBe(false);
  });

  it('rejects more fallback steps than the bound', () => {
    const fallback = Array.from({ length: COMBAT_INTENT_BOUNDS.fallbackSteps + 1 }, () => ({
      kind: 'defend',
    }));
    expect(Value.Check(ActionIntentSchema, validIntent({ fallback }))).toBe(false);
  });

  it('rejects an oversized named reference', () => {
    const namedRef = 'x'.repeat(COMBAT_INTENT_BOUNDS.namedRefChars + 1);
    expect(Value.Check(EntitySelectorSchema, { kind: 'explicit', namedRef })).toBe(false);
  });

  it('rejects a clarification with more options than the bound and with fewer than two', () => {
    const option = (index: number) => ({
      optionId: `option-${index}`,
      labelKey: `combat.clarify.option${index}`,
      steps: [{ kind: 'defend' }],
    });
    const tooMany = {
      questionKey: 'combat.clarify.target',
      options: Array.from({ length: COMBAT_INTENT_BOUNDS.clarificationOptions + 1 }, (_, i) =>
        option(i),
      ),
    };
    expect(Value.Check(ClarificationRequestSchema, tooMany)).toBe(false);
    const tooFew = { questionKey: 'combat.clarify.target', options: [option(0)] };
    expect(Value.Check(ClarificationRequestSchema, tooFew)).toBe(false);
  });
});

// ── AC-1 / AC-8: no ids, coordinates, dice or mechanics ────────────────

describe('the model-facing envelope cannot carry mechanics (AC-1, AC-8)', () => {
  it('rejects a step that carries a resolved target id', () => {
    const intent = validIntent({
      steps: [
        {
          kind: 'use_ability',
          ability: { kind: 'tag', value: 'basic_melee' },
          target: { kind: 'nearest_hostile' },
          targetIds: ['emberwatch:goblin-1'],
        },
      ],
    });
    expect(Value.Check(ActionIntentSchema, intent)).toBe(false);
  });

  it('rejects a step that carries a coordinate, a dice value or HP', () => {
    for (const extra of [{ cell: { x: 1, y: 2 } }, { naturalRoll: 20 }, { hp: 4 }]) {
      const intent = validIntent({ steps: [{ kind: 'defend', ...extra }] });
      expect(Value.Check(ActionIntentSchema, intent)).toBe(false);
    }
  });

  it('rejects a target selector that names a combatant id instead of a selector kind', () => {
    const intent = validIntent({
      steps: [
        {
          kind: 'use_ability',
          ability: { kind: 'tag', value: 'basic_melee' },
          target: { kind: 'emberwatch:goblin-1' },
        },
      ],
    });
    expect(Value.Check(ActionIntentSchema, intent)).toBe(false);
  });
});

// ── Interpreter result + trusted UI inputs ─────────────────────────────

describe('IntentInterpreterResultSchema (AC-1, AC-2)', () => {
  it('accepts the success, refusal and ambiguous variants', () => {
    expect(Value.Check(IntentInterpreterResultSchema, { ok: true, intent: validIntent() })).toBe(
      true,
    );
    expect(Value.Check(IntentInterpreterResultSchema, { ok: false, reason: 'unparseable' })).toBe(
      true,
    );
    expect(Value.Check(IntentInterpreterResultSchema, { ok: false, reason: 'refused' })).toBe(true);
    expect(
      Value.Check(IntentInterpreterResultSchema, {
        ok: false,
        reason: 'ambiguous',
        clarification: {
          questionKey: 'combat.clarify.target',
          options: [
            { optionId: 'a', labelKey: 'combat.clarify.a', steps: [{ kind: 'defend' }] },
            { optionId: 'b', labelKey: 'combat.clarify.b', steps: [{ kind: 'wait' }] },
          ],
        },
      }),
    ).toBe(true);
  });

  it('rejects an ambiguous result without a clarification and an unknown reason', () => {
    expect(Value.Check(IntentInterpreterResultSchema, { ok: false, reason: 'ambiguous' })).toBe(
      false,
    );
    expect(Value.Check(IntentInterpreterResultSchema, { ok: false, reason: 'hallucinated' })).toBe(
      false,
    );
  });
});

describe('trusted UI inputs stay outside the model-facing envelope (AC-1)', () => {
  it('accepts an exact cell and an exact ability id', () => {
    expect(Value.Check(TrustedCellInputSchema, { kind: 'cell', cell: { x: 2, y: 3 } })).toBe(true);
    expect(
      Value.Check(TrustedAbilityInputSchema, { kind: 'ability', abilityId: 'basic_melee' }),
    ).toBe(true);
  });

  it('rejects extra properties on trusted inputs', () => {
    expect(
      Value.Check(TrustedCellInputSchema, { kind: 'cell', cell: { x: 2, y: 3 }, actor: 'x' }),
    ).toBe(false);
  });
});
