// packages/shared/utils/src/lib/rules/__tests__/combat_intent_parser.test.ts
//
// C-525 (Combat-05) deterministic offline parser coverage.
//
//   AC-6  with AI unavailable, ordinary move/attack/ability/defend/end-turn
//         instructions parse deterministically into schema-valid, selector-only
//         intent; anything unreadable is a typed refusal rather than a guess
//   AC-8  free text is capped and never becomes an id/coordinate/dice value
//
// Contract: C-525 AC-6, AC-8

import { describe, expect, it } from 'bun:test';
import { ActionIntentSchema, COMBAT_INTENT_BOUNDS } from '@aikami/schemas';
import type { IntentStep } from '@aikami/types';
import { Value } from 'typebox/value';
import { parseCombatIntent } from '../combat_intent_parser';

const parse = (text: string) =>
  parseCombatIntent({
    intentId: 'intent-1',
    encounterId: 'emberwatch-encounter-1',
    actorId: 'player-hero',
    basedOnRevision: 4,
    text,
  });

const stepsOf = (text: string): IntentStep[] => {
  const result = parse(text);
  if (!result.ok) {
    throw new Error(`expected an intent for "${text}" (got ${result.reason})`);
  }
  return result.intent.steps;
};

// ---------------------------------------------------------------------------
// AC-6: ordinary instructions parse deterministically
// ---------------------------------------------------------------------------

describe('parseCombatIntent — ordinary instructions (AC-6)', () => {
  it('reads a move-to-the-nearest-enemy instruction', () => {
    expect(stepsOf('move to the nearest enemy')).toEqual([
      {
        kind: 'move',
        destination: {
          kind: 'relative',
          relativeTo: { kind: 'nearest_hostile' },
          band: 'reach',
          direction: 'toward',
        },
      },
    ]);
  });

  it('reads a retreat as a move to safety', () => {
    expect(stepsOf('retreat to somewhere safe')).toEqual([
      { kind: 'move', destination: { kind: 'nearest_safe' } },
    ]);
  });

  it('reads a plain attack as the basic melee against the nearest hostile', () => {
    expect(stepsOf('attack the nearest enemy')).toEqual([
      {
        kind: 'use_ability',
        ability: { kind: 'tag', value: 'basic_melee' },
        target: { kind: 'nearest_hostile' },
      },
    ]);
  });

  it('reads a named ability, trimming the phrase to the ability name', () => {
    expect(stepsOf('use my heavy melee attack on the nearest enemy')[0]).toEqual({
      kind: 'use_ability',
      ability: { kind: 'tag', value: 'heavy_melee' },
      target: { kind: 'nearest_hostile' },
    });
    expect(stepsOf('cast fireball')[0]).toEqual({
      kind: 'use_ability',
      ability: { kind: 'tag', value: 'fireball' },
      target: { kind: 'nearest_hostile' },
    });
  });

  it('reads a ranged ability as a ranged attack', () => {
    expect(stepsOf('shoot the nearest enemy')[0]).toEqual({
      kind: 'use_ability',
      ability: { kind: 'tag', value: 'ranged_attack' },
      target: { kind: 'nearest_hostile' },
    });
  });

  it('keeps a damage type on strongest-ability selectors', () => {
    expect(stepsOf('use my strongest fire attack')[0]).toEqual({
      kind: 'use_ability',
      ability: { kind: 'strongest', damageType: 'fire' },
      target: { kind: 'nearest_hostile' },
    });
    expect(stepsOf('use my most damaging fire attack')[0]).toEqual({
      kind: 'use_ability',
      ability: { kind: 'strongest', damageType: 'fire' },
      target: { kind: 'nearest_hostile' },
    });
  });

  it('reads an explicitly named target', () => {
    expect(stepsOf('attack the goblin archer')[0]).toEqual({
      kind: 'use_ability',
      ability: { kind: 'tag', value: 'basic_melee' },
      target: { kind: 'explicit', namedRef: 'goblin archer' },
    });
  });

  it('reads defend, wait and end turn', () => {
    expect(stepsOf('defend')).toEqual([{ kind: 'defend' }]);
    expect(stepsOf('hold position')).toEqual([{ kind: 'wait' }]);
    expect(stepsOf('end my turn')).toEqual([{ kind: 'end_turn' }]);
  });

  it('reads the architecture example instruction', () => {
    // §7.2's motivating example: two clauses, compiled to a single command in
    // Combat-05 (the compiler reports the partial).
    const steps = stepsOf('move to the nearest enemy and use my melee attack');
    expect(steps[0]?.kind).toBe('use_ability');
  });

  it('is deterministic for the same text', () => {
    const text = 'attack the nearest enemy';
    expect(JSON.stringify(parse(text))).toBe(JSON.stringify(parse(text)));
  });
});

// ---------------------------------------------------------------------------
// AC-6 / AC-8: refusals, bounds and schema validity
// ---------------------------------------------------------------------------

describe('parseCombatIntent — refusals and bounds (AC-6, AC-8)', () => {
  it('returns a typed unparseable for text it cannot read', () => {
    expect(parse('tell me a joke about goblins')).toEqual({ ok: false, reason: 'unparseable' });
    expect(parse('   ')).toEqual({ ok: false, reason: 'unparseable' });
  });

  it('refuses reserved object affordances instead of inventing an interaction', () => {
    expect(parse('throw the barrel at the goblin')).toEqual({ ok: false, reason: 'refused' });
    expect(parse('open the door')).toEqual({ ok: false, reason: 'refused' });
  });

  it('caps rawText at COMBAT_INTENT_BOUNDS.rawTextChars', () => {
    const result = parse(`defend ${'a'.repeat(5000)}`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.intent.rawText?.length).toBe(COMBAT_INTENT_BOUNDS.rawTextChars);
    }
  });

  it('marks its output as deterministic fallback and echoes no ids or coordinates', () => {
    const result = parse('move toward emberwatch:goblin-1 at x 12 y 34');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.intent.source).toBe('fallback_parser');
      const serialized = JSON.stringify(result.intent.steps);
      expect(serialized).not.toContain('"x"');
      expect(serialized).not.toContain('"y"');
      expect(serialized).not.toContain('goblin-1');
      expect(serialized).not.toContain('12');
      expect(serialized).not.toContain('34');
    }
  });

  it('always produces a schema-valid intent envelope', () => {
    for (const text of [
      'move to the nearest enemy',
      'retreat',
      'attack the nearest enemy',
      'use my heavy melee attack',
      'defend',
      'wait',
      'end my turn',
    ]) {
      const result = parse(text);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Value.Check(ActionIntentSchema, result.intent)).toBe(true);
      }
    }
  });
});
