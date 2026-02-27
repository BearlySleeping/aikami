import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { BaseCharacterSheetSchema } from './character.ts';

describe('BaseCharacterSheetSchema', () => {
  const validCharacterData = {
    name: 'Gandalf',
    race: 'Maia',
    class: 'Wizard',
    level: 10,
    experiencePoints: 5000,
    abilityScores: {
      strength: 10,
      dexterity: 12,
      constitution: 14,
      intelligence: 20,
      wisdom: 18,
      charisma: 16,
    },
    hitPoints: 50,
    armorClass: 12,
    speed: 30,
    alignment: 'Chaotic Good',
    background: 'Sage',
    proficiencies: ['Arcana', 'History'],
    languages: ['Common', 'Sindarin', 'Valarin'],
    equipment: ['Staff', 'Robe', 'Hat'],
    inventory: ['Potion of Healing', 'Spellbook'],
  };

  test('should parse valid character data', () => {
    const result = BaseCharacterSheetSchema.parse(validCharacterData);
    expect(result.name).toBe('Gandalf');
    expect(result.race).toBe('Maia');
    expect(result.level).toBe(10);
  });

  test('should parse optional fields when provided', () => {
    const dataWithOptional = {
      ...validCharacterData,
      personalityTraits: 'Wise and mysterious',
      ideals: 'Help the weak',
      bonds: 'Friendship with hobbits',
      flaws: 'Tends to be cryptic',
      notes: 'A powerful wizard',
    };
    const result = BaseCharacterSheetSchema.parse(dataWithOptional);
    expect(result.personalityTraits).toBe('Wise and mysterious');
    expect(result.notes).toBe('A powerful wizard');
  });

  test('should reject missing required fields', () => {
    const invalidData = {
      name: 'Gandalf',
      race: 'Maia',
    };
    expect(() => BaseCharacterSheetSchema.parse(invalidData)).toThrow(z.ZodError);
  });

  test('should accept ability scores outside D&D range', () => {
    const data = {
      ...validCharacterData,
      abilityScores: {
        strength: 50,
        dexterity: 12,
        constitution: 14,
        intelligence: 20,
        wisdom: 18,
        charisma: 16,
      },
    };
    const result = BaseCharacterSheetSchema.parse(data);
    expect(result.abilityScores.strength).toBe(50);
  });

  test('should accept negative hit points', () => {
    const data = {
      ...validCharacterData,
      hitPoints: -5,
    };
    const result = BaseCharacterSheetSchema.parse(data);
    expect(result.hitPoints).toBe(-5);
  });

  test('should reject non-integer level', () => {
    const invalidData = {
      ...validCharacterData,
      level: 5.5,
    };
    expect(() => BaseCharacterSheetSchema.parse(invalidData)).toThrow(z.ZodError);
  });
});
