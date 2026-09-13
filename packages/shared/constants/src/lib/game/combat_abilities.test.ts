// packages/shared/constants/src/lib/game/combat_abilities.test.ts
//
// Contract: C-516 AC-3 — every catalog entry is schema-valid, the catalog does
// not silently diverge from `CLASS_REGISTRY`, and an unknown ability resolves
// to `undefined` (a typed `abilityUnknown` in the kernel) rather than throwing.

import { describe, expect, test } from 'bun:test';
import { CombatAbilityDefinitionSchema } from '@aikami/schemas';
import { Value } from 'typebox/value';
import { CLASS_REGISTRY } from './classes.ts';
import {
  BASIC_COMBAT_ABILITIES,
  BASIC_MELEE_ABILITY_ID,
  COMBAT_ABILITY_IDS_BY_CLASS,
  getCombatAbility,
  resolveCombatAbilityIds,
  UNMAPPED_CLASS_FEATURE_IDS,
} from './combat_abilities.ts';

const classNameFor = (classId: string) =>
  CLASS_REGISTRY[classId as keyof typeof CLASS_REGISTRY]?.name ?? classId;

describe('C-516 AC-3: the production ability catalog is schema-valid and complete', () => {
  test('contains basic_melee', () => {
    expect(BASIC_COMBAT_ABILITIES[BASIC_MELEE_ABILITY_ID]).toBeDefined();
    expect(BASIC_COMBAT_ABILITIES[BASIC_MELEE_ABILITY_ID]?.kind).toBe('melee_attack');
  });

  test('every entry passes CombatAbilityDefinitionSchema', () => {
    for (const [abilityId, ability] of Object.entries(BASIC_COMBAT_ABILITIES)) {
      expect(Value.Check(CombatAbilityDefinitionSchema, ability)).toBe(true);
      expect(ability.abilityId).toBe(abilityId);
    }
  });

  test('damage dice and damage type are always set together', () => {
    for (const ability of Object.values(BASIC_COMBAT_ABILITIES)) {
      const hasDice = ability.damageDice !== null;
      const hasType = ability.damageType !== null;
      expect(hasDice).toBe(hasType);
    }
  });

  test('every active class feature is either mapped or explicitly unmapped', () => {
    for (const [classId, definition] of Object.entries(CLASS_REGISTRY)) {
      for (const feature of Object.values(definition.features).flat()) {
        if (feature.kind === 'passive') {
          continue;
        }
        const mapped = BASIC_COMBAT_ABILITIES[feature.id] !== undefined;
        const forgiven = UNMAPPED_CLASS_FEATURE_IDS.includes(feature.id);
        expect(
          mapped || forgiven,
          `${classNameFor(classId)} feature "${feature.id}" is neither mapped nor listed as unmapped`,
        ).toBe(true);
        // An unmapped feature must never still be granted to its class.
        if (forgiven) {
          expect(COMBAT_ABILITY_IDS_BY_CLASS[classId] ?? []).not.toContain(feature.id);
        }
      }
    }
  });

  test('a mapped class ability keeps the registry name (no divergence)', () => {
    for (const [classId, definition] of Object.entries(CLASS_REGISTRY)) {
      for (const feature of Object.values(definition.features).flat()) {
        const ability = BASIC_COMBAT_ABILITIES[feature.id];
        if (ability === undefined) {
          continue;
        }
        expect(ability.name).toBe(feature.name);
        expect(CLASS_REGISTRY[classId as keyof typeof CLASS_REGISTRY]).toBeDefined();
      }
    }
  });

  test('unmapped ids are unique and actually exist in the registry', () => {
    const allFeatureIds = Object.values(CLASS_REGISTRY)
      .flatMap((definition) => Object.values(definition.features).flat())
      .map((feature) => feature.id);
    expect(new Set(UNMAPPED_CLASS_FEATURE_IDS).size).toBe(UNMAPPED_CLASS_FEATURE_IDS.length);
    for (const featureId of UNMAPPED_CLASS_FEATURE_IDS) {
      expect(allFeatureIds).toContain(featureId);
    }
  });

  test('an unknown ability is not a throw — it is undefined', () => {
    expect(getCombatAbility('not_a_real_ability')).toBeUndefined();
    expect(getCombatAbility('')).toBeUndefined();
  });

  test('every class is granted basic_melee plus its own abilities only', () => {
    const rogueIds = resolveCombatAbilityIds(['rogue']);
    expect(rogueIds).toContain(BASIC_MELEE_ABILITY_ID);
    expect(rogueIds).not.toContain('wizard_fireball');
    expect(resolveCombatAbilityIds(['wizard'])).toContain('wizard_fireball');
  });

  test('an unknown class still yields basic_melee', () => {
    expect(resolveCombatAbilityIds([])).toEqual([BASIC_MELEE_ABILITY_ID]);
    expect(resolveCombatAbilityIds(['barbarian'])).toEqual([BASIC_MELEE_ABILITY_ID]);
  });
});
