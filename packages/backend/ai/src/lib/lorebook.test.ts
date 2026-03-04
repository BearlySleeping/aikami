import { describe, expect, test } from 'bun:test';
import { LorebookService, type LorebookEntry } from './lorebook.ts';

describe('LorebookService', () => {
  const mockEntries: LorebookEntry[] = [
    {
      id: 'king',
      keywords: ['king', 'monarch'],
      content: 'The king is old.',
      priority: 10,
    },
    {
      id: 'kingdom',
      keywords: ['kingdom'],
      content: 'The kingdom is vast.',
      priority: 5,
    },
    {
      id: 'secret',
      keywords: ['secret', 'hidden'],
      content: 'There is a hidden door.',
      priority: 20,
    },
  ];

  test('should activate entries based on keywords', () => {
    const service = new LorebookService(mockEntries);
    const result = service.scan('The king has a secret.');

    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).toContain('king');
    expect(result.map((e) => e.id)).toContain('secret');
  });

  test('should sort activated entries by priority (descending)', () => {
    const service = new LorebookService(mockEntries);
    const result = service.scan('The king has a secret in the kingdom.');

    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('secret'); // Priority 20
    expect(result[1].id).toBe('king');   // Priority 10
    expect(result[2].id).toBe('kingdom'); // Priority 5
  });

  test('should limit entries by character count', () => {
    const service = new LorebookService(mockEntries);
    // "There is a hidden door." is 23 chars.
    // "The king is old." is 16 chars.
    // Total: 39 chars.
    
    const result = service.scan('The king has a secret.', { maxCharacters: 30 });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('secret');
  });

  test('should format activated entries for prompt injection', () => {
    const service = new LorebookService(mockEntries);
    const activated = service.scan('The king.');
    const formatted = service.formatForPrompt(activated);

    expect(formatted).toContain('Relevant World Information:');
    expect(formatted).toContain('[Lore: king]');
    expect(formatted).toContain('The king is old.');
  });

  test('should return empty string when no entries are activated', () => {
    const service = new LorebookService(mockEntries);
    const activated = service.scan('Hello world.');
    const formatted = service.formatForPrompt(activated);

    expect(formatted).toBe('');
  });
});
