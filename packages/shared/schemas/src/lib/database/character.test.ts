import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { BaseCharacterSheetSchema } from './character.ts';
import { DEFAULT_SAVING_THROWS, DEFAULT_SKILLS } from './skills.ts';

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

  test('should have default skills', () => {
    const result = BaseCharacterSheetSchema.parse(validCharacterData);
    expect(result.skills).toEqual(DEFAULT_SKILLS);
  });

  test('should have default saving throws', () => {
    const result = BaseCharacterSheetSchema.parse(validCharacterData);
    expect(result.savingThrows).toEqual(DEFAULT_SAVING_THROWS);
  });

  test('should parse custom skills', () => {
    const customSkills = [
      {
        name: 'Acrobatics',
        ability: 'dexterity',
        isProficient: true,
        isExpertise: false,
      },
      {
        name: 'Persuasion',
        ability: 'charisma',
        isProficient: true,
        isExpertise: true,
      },
    ];
    const data = { ...validCharacterData, skills: customSkills };
    const result = BaseCharacterSheetSchema.parse(data);
    expect(result.skills).toHaveLength(2);
    expect(result.skills[0].isProficient).toBe(true);
    expect(result.skills[1].isExpertise).toBe(true);
  });

  test('should parse appearance fields', () => {
    const appearance = {
      avatarUrl: 'https://example.com/avatar.png',
      portraitUrl: 'https://example.com/portrait.png',
      physicalDescription: 'Tall and wise, with long grey beard',
      age: 'Ageless',
      height: '7\'2"',
      weight: '180 lbs',
      eyeColor: 'Grey',
      hairColor: 'White',
      skinColor: 'Fair',
      distinguishingMarks: 'Flowing grey robes',
    };
    const data = { ...validCharacterData, appearance };
    const result = BaseCharacterSheetSchema.parse(data);
    expect(result.appearance?.avatarUrl).toBe('https://example.com/avatar.png');
    expect(result.appearance?.physicalDescription).toBe('Tall and wise, with long grey beard');
    expect(result.appearance?.eyeColor).toBe('Grey');
  });

  test('should parse optional appearance fields', () => {
    const appearance = {
      physicalDescription: 'Tall wizard',
    };
    const data = { ...validCharacterData, appearance };
    const result = BaseCharacterSheetSchema.parse(data);
    expect(result.appearance?.physicalDescription).toBe('Tall wizard');
    expect(result.appearance?.avatarUrl).toBeUndefined();
  });

  test('should parse optional subclass', () => {
    const data = { ...validCharacterData, subclass: 'Divine Soul' };
    const result = BaseCharacterSheetSchema.parse(data);
    expect(result.subclass).toBe('Divine Soul');
  });

  test('should parse optional hitPointsMax', () => {
    const data = { ...validCharacterData, hitPointsMax: 60 };
    const result = BaseCharacterSheetSchema.parse(data);
    expect(result.hitPointsMax).toBe(60);
  });

  test('should have default temporaryHitPoints', () => {
    const result = BaseCharacterSheetSchema.parse(validCharacterData);
    expect(result.temporaryHitPoints).toBe(0);
  });
});
