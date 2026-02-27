import { describe, expect, test } from 'bun:test';

interface TestCharacter {
  name: string;
  description: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  creator_notes?: string;
  system_prompt?: string;
  post_history_instructions?: string;
  alternate_greetings?: string[];
  tags?: string[];
  creator?: string;
  character_version?: string;
  extensions?: Record<string, unknown>;
}

describe('Character type', () => {
  test('should have required fields', () => {
    const character: TestCharacter = {
      name: 'Test Character',
      description: 'A test character',
    };

    expect(character.name).toBe('Test Character');
    expect(character.description).toBe('A test character');
  });

  test('should have optional fields', () => {
    const character: TestCharacter = {
      name: 'RPG Character',
      description: 'A brave warrior',
      personality: 'Brave, Loyal',
      scenario: 'In a dungeon',
      first_mes: 'Greetings, traveler!',
      mes_example: 'I am ready for adventure!',
      creator_notes: 'Created for testing',
      system_prompt: 'You are a helpful NPC',
      post_history_instructions: 'Remember previous conversations',
      alternate_greetings: ['Hello!', 'Welcome!'],
      tags: ['warrior', 'npc', 'friendly'],
      creator: 'Test Creator',
      character_version: '1.0',
      extensions: { customField: 'value' },
    };

    expect(character.personality).toBe('Brave, Loyal');
    expect(character.alternate_greetings).toHaveLength(2);
    expect(character.extensions?.customField).toBe('value');
  });

  test('should allow empty optional fields', () => {
    const character: TestCharacter = {
      name: 'Minimal Character',
      description: 'Minimal description',
    };

    expect(character.personality).toBeUndefined();
    expect(character.alternate_greetings).toBeUndefined();
    expect(character.extensions).toBeUndefined();
  });
});

describe('Character file detection', () => {
  test('should detect PNG file type', () => {
    const pngFile = new File(['fake png'], 'character.png', { type: 'image/png' });
    expect(pngFile.type).toBe('image/png');
  });

  test('should detect JSON file type', () => {
    const jsonFile = new File(['{}'], 'character.json', { type: 'application/json' });
    expect(jsonFile.type).toContain('application/json');
  });

  test('should distinguish between PNG and JSON', () => {
    const pngFile = new File(['fake png'], 'character.png', { type: 'image/png' });
    const jsonFile = new File(['{}'], 'character.json', { type: 'application/json' });

    expect(pngFile.type).not.toBe(jsonFile.type);
    expect(pngFile.type).toBe('image/png');
    expect(jsonFile.type).toContain('application/json');
  });
});
