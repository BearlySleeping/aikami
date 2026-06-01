import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  PersonaCreateSchema,
  PersonaSchema,
  PersonaSheetSchema,
  PersonaUpdateSchema,
} from './persona.ts';

describe('PersonaSheetSchema', () => {
  const validPersonaData = {
    name: 'Hero Character',
    race: 'Human',
    class: 'Paladin',
    level: 5,
    experiencePoints: 2500,
    abilityScores: {
      strength: 16,
      dexterity: 12,
      constitution: 14,
      intelligence: 10,
      wisdom: 14,
      charisma: 16,
    },
    hitPoints: 45,
    armorClass: 18,
    speed: 30,
    alignment: 'Lawful Good',
    background: 'Soldier',
    proficiencies: ['Athletics', 'Persuasion'],
    languages: ['Common', 'Celestial'],
    equipment: ['Longsword', 'Shield', 'Plate Armor'],
    inventory: ['Holy Symbol', 'Healing Potion'],
  };

  test('should parse valid persona sheet data', () => {
    const result = PersonaSheetSchema.parse(validPersonaData);
    expect(result.name).toBe('Hero Character');
    expect(result.level).toBe(5);
  });

  test('should parse optional fields when provided', () => {
    const dataWithOptional = {
      ...validPersonaData,
      personalityTraits: 'Brave and honorable',
      ideals: 'Protect the innocent',
      bonds: 'Oath to the king',
      flaws: 'Too trusting',
    };
    const result = PersonaSheetSchema.parse(dataWithOptional);
    expect(result.personalityTraits).toBe('Brave and honorable');
  });
});

describe('PersonaSchema', () => {
  const validPersonaData = {
    id: 'persona-123',
    name: 'Hero Character',
    race: 'Human',
    class: 'Paladin',
    level: 5,
    experiencePoints: 2500,
    abilityScores: {
      strength: 16,
      dexterity: 12,
      constitution: 14,
      intelligence: 10,
      wisdom: 14,
      charisma: 16,
    },
    hitPoints: 45,
    armorClass: 18,
    speed: 30,
    alignment: 'Lawful Good',
    background: 'Soldier',
    proficiencies: ['Athletics', 'Persuasion'],
    languages: ['Common', 'Celestial'],
    equipment: ['Longsword', 'Shield', 'Plate Armor'],
    inventory: ['Holy Symbol', 'Healing Potion'],
    avatarUrl: 'https://example.com/avatar.png',
    uid: 'user-123',
  };

  test('should parse valid persona data', () => {
    const result = PersonaSchema.parse(validPersonaData);
    expect(result.id).toBe('persona-123');
    expect(result.avatarUrl).toBe('https://example.com/avatar.png');
    expect(result.uid).toBe('user-123');
  });

  test('should parse with optional fields undefined', () => {
    const { avatarUrl, uid, ...rest } = validPersonaData;
    const result = PersonaSchema.parse(rest);
    expect(result.avatarUrl).toBeUndefined();
    expect(result.uid).toBeUndefined();
  });

  test('should reject invalid avatarUrl format', () => {
    const invalidData = {
      ...validPersonaData,
      avatarUrl: 'not-a-url',
    };
    expect(() => PersonaSchema.parse(invalidData)).toThrow(z.ZodError);
  });
});

describe('PersonaCreateSchema', () => {
  test('should parse valid persona create data', () => {
    const validData = {
      name: 'New Persona',
      race: 'Elf',
      class: 'Ranger',
      level: 1,
      experiencePoints: 0,
      abilityScores: {
        strength: 10,
        dexterity: 16,
        constitution: 12,
        intelligence: 10,
        wisdom: 14,
        charisma: 10,
      },
      hitPoints: 10,
      armorClass: 12,
      speed: 35,
      alignment: 'Neutral Good',
      background: 'Outlander',
      proficiencies: ['Stealth', 'Survival'],
      languages: ['Common', 'Elvish'],
      equipment: ['Longbow', 'Arrow'],
      inventory: [],
    };
    const result = PersonaCreateSchema.parse(validData);
    expect(result.name).toBe('New Persona');
  });

  test('should reject when required fields missing', () => {
    const invalidData = { name: 'Incomplete Persona' };
    expect(() => PersonaCreateSchema.parse(invalidData)).toThrow(z.ZodError);
  });
});

describe('PersonaUpdateSchema', () => {
  test('should parse valid persona update data', () => {
    const validData = {
      updatedAt: { seconds: 1700000000, nanoseconds: 0 },
      name: 'Updated Name',
      race: 'Human',
      class: 'Paladin',
      level: 6,
      experiencePoints: 3000,
      abilityScores: {
        strength: 16,
        dexterity: 12,
        constitution: 14,
        intelligence: 10,
        wisdom: 14,
        charisma: 16,
      },
      hitPoints: 50,
      armorClass: 18,
      speed: 30,
      alignment: 'Lawful Good',
      background: 'Soldier',
      proficiencies: ['Athletics'],
      languages: ['Common'],
      equipment: ['Longsword'],
      inventory: [],
    };
    const result = PersonaUpdateSchema.parse(validData);
    expect(result.name).toBe('Updated Name');
    expect(result.level).toBe(6);
  });
});
