// packages/shared/schemas/src/lib/game/class_definition.test.ts
//
// Unit tests for ClassDefinition, ClassFeature, and AbilityActivation schemas.
//
// Contract: C-337 — AC-1: Class and ability definitions are validated content-pack data

import { describe, expect, it } from 'bun:test';
import { Value } from 'typebox/value';
import {
  AbilityActivationSchema,
  ClassDefinitionSchema,
  ClassFeatureSchema,
  SubclassDefinitionSchema,
} from './class_definition.ts';

describe('AbilityActivationSchema', () => {
  it('validates a correct activation', () => {
    const result = Value.Check(AbilityActivationSchema, {
      cost: 'action',
      usageLimit: 'per_rest',
      maxUses: 1,
      target: 'self',
      effectDice: '1d8+2',
      scalingStat: 'strength',
    });
    expect(result).toBe(true);
  });

  it('validates minimal activation (no optional fields)', () => {
    const result = Value.Check(AbilityActivationSchema, {
      cost: 'free',
      usageLimit: 'unlimited',
      maxUses: 1,
    });
    expect(result).toBe(true);
  });

  it('rejects unknown kind values for cost', () => {
    const result = Value.Check(AbilityActivationSchema, {
      cost: 'invalid_cost',
      usageLimit: 'per_rest',
      maxUses: 1,
    });
    expect(result).toBe(false);
  });

  it('rejects unknown usageLimit', () => {
    const result = Value.Check(AbilityActivationSchema, {
      cost: 'action',
      usageLimit: 'per_week',
      maxUses: 1,
    });
    expect(result).toBe(false);
  });

  it('rejects zero maxUses', () => {
    const result = Value.Check(AbilityActivationSchema, {
      cost: 'action',
      usageLimit: 'per_rest',
      maxUses: 0,
    });
    expect(result).toBe(false);
  });

  it('rejects unknown target', () => {
    const result = Value.Check(AbilityActivationSchema, {
      cost: 'action',
      usageLimit: 'per_rest',
      maxUses: 1,
      target: 'invalid_target',
    });
    expect(result).toBe(false);
  });

  it('rejects bad effectDice pattern', () => {
    const result = Value.Check(AbilityActivationSchema, {
      cost: 'action',
      usageLimit: 'per_rest',
      maxUses: 1,
      effectDice: 'abc',
    });
    expect(result).toBe(false);
  });

  it('validates all usage limit types', () => {
    const limits = ['per_rest', 'per_encounter', 'per_day', 'unlimited'] as const;
    for (const limit of limits) {
      const result = Value.Check(AbilityActivationSchema, {
        cost: 'action',
        usageLimit: limit,
        maxUses: 1,
      });
      expect(result).toBe(true);
    }
  });
});

describe('ClassFeatureSchema', () => {
  it('validates an active feature', () => {
    const result = Value.Check(ClassFeatureSchema, {
      id: 'fighter_second_wind',
      name: 'Second Wind',
      description: 'Heal 1d10 + level',
      level: 1,
      kind: 'active',
      activation: { cost: 'bonus_action', usageLimit: 'per_rest', maxUses: 1 },
    });
    expect(result).toBe(true);
  });

  it('validates a passive feature', () => {
    const result = Value.Check(ClassFeatureSchema, {
      id: 'fighter_fighting_style',
      name: 'Fighting Style',
      description: 'Reroll 1s and 2s',
      level: 1,
      kind: 'passive',
    });
    expect(result).toBe(true);
  });

  it('rejects unknown kind', () => {
    const result = Value.Check(ClassFeatureSchema, {
      id: 'test_feature',
      name: 'Test',
      description: 'Test description',
      level: 1,
      kind: 'unknown_kind',
    });
    expect(result).toBe(false);
  });

  it('rejects feature ID without underscore separator', () => {
    const result = Value.Check(ClassFeatureSchema, {
      id: 'secondwind', // missing underscore / class prefix
      name: 'Test',
      description: 'Test',
      level: 1,
      kind: 'passive',
    });
    expect(result).toBe(false);
  });

  it('validates feature with class_prefix pattern', () => {
    const result = Value.Check(ClassFeatureSchema, {
      id: 'rogue_cunning_action',
      name: 'Cunning Action',
      description: 'Bonus action to Dash, Disengage, or Hide',
      level: 2,
      kind: 'active',
      activation: { cost: 'bonus_action', usageLimit: 'unlimited', maxUses: 1 },
    });
    expect(result).toBe(true);
  });

  it('rejects level 0 (out of range)', () => {
    const result = Value.Check(ClassFeatureSchema, {
      id: 'test_feature',
      name: 'Test',
      description: 'Test',
      level: 0,
      kind: 'passive',
    });
    expect(result).toBe(false);
  });
});

describe('ClassDefinitionSchema', () => {
  it('validates a complete class definition', () => {
    const result = Value.Check(ClassDefinitionSchema, {
      id: 'fighter',
      name: 'Fighter',
      description: 'A master of martial combat',
      hitDie: 'd10',
      hpPerLevel: 6,
      primaryAbility: 'strength',
      savingThrowProficiencies: ['strength', 'constitution'],
      skillProficiencyChoices: ['Athletics', 'Acrobatics'],
      skillProficiencyCount: 2,
      weaponProficiencies: ['simple', 'martial'],
      armorProficiencies: ['light', 'medium', 'heavy'],
      features: {
        '1': [
          {
            id: 'fighter_second_wind',
            name: 'Second Wind',
            description: 'Heal',
            level: 1,
            kind: 'active',
            activation: { cost: 'bonus_action', usageLimit: 'per_rest', maxUses: 1 },
          },
        ],
        '2': [],
        '3': [
          {
            id: 'fighter_improved_critical',
            name: 'Improved Critical',
            description: 'Crit on 19-20',
            level: 3,
            kind: 'passive',
          },
        ],
      },
      subclassChoiceLevel: 3,
      subclasses: [],
    });
    expect(result).toBe(true);
  });

  it('allows dead levels (empty feature array)', () => {
    const levelKey = '2';
    const result = Value.Check(ClassDefinitionSchema, {
      id: 'test_class',
      name: 'Test Class',
      description: 'Test',
      hitDie: 'd8',
      hpPerLevel: 5,
      primaryAbility: 'strength',
      savingThrowProficiencies: ['strength', 'constitution'],
      skillProficiencyChoices: ['Athletics'],
      skillProficiencyCount: 1,
      weaponProficiencies: ['simple'],
      armorProficiencies: ['light'],
      features: {
        '1': [
          { id: 'test_feature_a', name: 'A', description: 'Feature A', level: 1, kind: 'passive' },
        ],
        '2': [],
      },
      subclassChoiceLevel: 0,
      subclasses: [],
    });
    expect(result).toBe(true);
  });

  it('rejects saving throws with wrong count', () => {
    const result = Value.Check(ClassDefinitionSchema, {
      id: 'test',
      name: 'Test',
      description: 'Test',
      hitDie: 'd8',
      hpPerLevel: 5,
      primaryAbility: 'strength',
      savingThrowProficiencies: ['strength'], // only 1, needs 2
      skillProficiencyChoices: ['Athletics'],
      skillProficiencyCount: 1,
      weaponProficiencies: ['simple'],
      armorProficiencies: ['light'],
      features: {},
      subclassChoiceLevel: 0,
      subclasses: [],
    });
    expect(result).toBe(false);
  });
});

describe('SubclassDefinitionSchema', () => {
  it('validates a subclass', () => {
    const result = Value.Check(SubclassDefinitionSchema, {
      id: 'champion',
      name: 'Champion',
      description: 'The archetypal Champion',
      features: {},
    });
    expect(result).toBe(true);
  });

  it('validates subclass with features', () => {
    const result = Value.Check(SubclassDefinitionSchema, {
      id: 'evoker',
      name: 'Evoker',
      description: 'Master of evocation magic',
      features: {
        '2': [
          {
            id: 'wizard_evoker_sculpt',
            name: 'Sculpt Spells',
            description: 'Protect allies',
            level: 2,
            kind: 'passive',
          },
        ],
      },
    });
    expect(result).toBe(true);
  });
});
