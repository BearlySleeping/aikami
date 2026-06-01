import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { NpcCreateSchema, NpcSchema, NpcSheetSchema, NpcUpdateSchema } from './npc.ts';

describe('NpcSheetSchema', () => {
  test('should parse valid NPC sheet data', () => {
    const validData = {
      name: 'Goblin King',
      race: 'Goblin',
      class: 'Warrior',
      level: 3,
      experiencePoints: 1000,
      abilityScores: {
        strength: 14,
        dexterity: 12,
        constitution: 12,
        intelligence: 8,
        wisdom: 10,
        charisma: 6,
      },
      hitPoints: 20,
      armorClass: 14,
      speed: 30,
      alignment: 'Chaotic Evil',
      background: 'Soldier',
      proficiencies: ['Intimidation'],
      languages: ['Common', 'Goblin'],
      equipment: ['Scimitar', 'Shield'],
      inventory: ['Gold coins'],
      isFriendly: false,
    };
    const result = NpcSheetSchema.parse(validData);
    expect(result.name).toBe('Goblin King');
    expect(result.isFriendly).toBe(false);
  });

  test('should default isFriendly to true', () => {
    const validData = {
      name: 'Friendly Merchant',
      race: 'Human',
      class: 'Merchant',
      level: 1,
      experiencePoints: 0,
      abilityScores: {
        strength: 10,
        dexterity: 10,
        constitution: 10,
        intelligence: 12,
        wisdom: 12,
        charisma: 14,
      },
      hitPoints: 10,
      armorClass: 10,
      speed: 30,
      alignment: 'Neutral Good',
      background: 'Merchant',
      proficiencies: [],
      languages: ['Common'],
      equipment: [],
      inventory: [],
    };
    const result = NpcSheetSchema.parse(validData);
    expect(result.isFriendly).toBe(true);
  });
});

describe('NpcSchema', () => {
  const validNpcData = {
    id: 'npc-123',
    name: 'Goblin King',
    race: 'Goblin',
    class: 'Warrior',
    level: 3,
    experiencePoints: 1000,
    abilityScores: {
      strength: 14,
      dexterity: 12,
      constitution: 12,
      intelligence: 8,
      wisdom: 10,
      charisma: 6,
    },
    hitPoints: 20,
    armorClass: 14,
    speed: 30,
    alignment: 'Chaotic Evil',
    background: 'Soldier',
    proficiencies: ['Intimidation'],
    languages: ['Common', 'Goblin'],
    equipment: ['Scimitar', 'Shield'],
    inventory: ['Gold coins'],
    isFriendly: false,
    avatarUrl: 'https://example.com/goblin.png',
  };

  test('should parse valid NPC data', () => {
    const result = NpcSchema.parse(validNpcData);
    expect(result.id).toBe('npc-123');
    expect(result.avatarUrl).toBe('https://example.com/goblin.png');
  });

  test('should parse with optional avatarUrl', () => {
    const { avatarUrl, ...rest } = validNpcData;
    const result = NpcSchema.parse(rest);
    expect(result.avatarUrl).toBeUndefined();
  });
});

describe('NpcCreateSchema', () => {
  test('should parse valid NPC create data', () => {
    const validData = {
      name: 'New NPC',
      race: 'Human',
      class: 'Mage',
      level: 1,
      experiencePoints: 0,
      abilityScores: {
        strength: 8,
        dexterity: 10,
        constitution: 10,
        intelligence: 14,
        wisdom: 12,
        charisma: 10,
      },
      hitPoints: 8,
      armorClass: 10,
      speed: 30,
      alignment: 'Neutral',
      background: 'Sage',
      proficiencies: [],
      languages: ['Common'],
      equipment: [],
      inventory: [],
      isFriendly: true,
    };
    const result = NpcCreateSchema.parse(validData);
    expect(result.name).toBe('New NPC');
  });
});

describe('NpcUpdateSchema', () => {
  test('should parse valid NPC update data', () => {
    const validData = {
      updatedAt: { seconds: 1700000000, nanoseconds: 0 },
      name: 'Updated NPC Name',
      race: 'Goblin',
      class: 'Warrior',
      level: 5,
      experiencePoints: 1500,
      abilityScores: {
        strength: 14,
        dexterity: 12,
        constitution: 12,
        intelligence: 8,
        wisdom: 10,
        charisma: 6,
      },
      hitPoints: 25,
      armorClass: 14,
      speed: 30,
      alignment: 'Chaotic Evil',
      background: 'Soldier',
      proficiencies: ['Intimidation'],
      languages: ['Common', 'Goblin'],
      equipment: ['Scimitar'],
      inventory: ['Gold coins'],
      isFriendly: false,
    };
    const result = NpcUpdateSchema.parse(validData);
    expect(result.name).toBe('Updated NPC Name');
    expect(result.level).toBe(5);
  });
});
