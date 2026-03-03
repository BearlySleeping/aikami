import { describe, expect, test } from 'bun:test';
import { getActionSuggestionsSimple } from './action-suggester.ts';

describe('ActionSuggester', () => {
  describe('getActionSuggestionsSimple', () => {
    test('should return combat suggestions for combat messages', () => {
      const lastMessages = ['We see a goblin', 'The enemy attacks!', 'I draw my sword'];
      const result = getActionSuggestionsSimple(lastMessages, 'You are in a dungeon', 'Warrior');

      expect(result.aggressive).toBeDefined();
      expect(result.diplomatic).toBeDefined();
      expect(result.creative).toBeDefined();
      expect(result.aggressive.toLowerCase()).toContain('attack');
    });

    test('should return social suggestions for NPC messages', () => {
      const lastMessages = ['Hello traveler', 'The guard asks what your business is'];
      const result = getActionSuggestionsSimple(lastMessages, 'You meet a guard', 'Rogue');

      expect(result.aggressive).toBeDefined();
      expect(result.diplomatic).toBeDefined();
      expect(result.creative).toBeDefined();
    });

    test('should return puzzle suggestions for puzzle messages', () => {
      const lastMessages = ['You find a locked door', 'There are strange symbols on the wall'];
      const result = getActionSuggestionsSimple(
        lastMessages,
        'You are in a mysterious room',
        'Wizard',
      );

      expect(result.aggressive).toBeDefined();
      expect(result.diplomatic).toBeDefined();
      expect(result.creative).toBeDefined();
    });

    test('should handle empty messages', () => {
      const result = getActionSuggestionsSimple([], 'You are in a tavern', 'Bard');

      expect(result.aggressive).toBeDefined();
      expect(result.diplomatic).toBeDefined();
      expect(result.creative).toBeDefined();
    });

    test('should return generic suggestions when no context matches', () => {
      const lastMessages = ['I look around'];
      const result = getActionSuggestionsSimple(lastMessages, 'You are in a forest', 'Ranger');

      expect(result.aggressive).toBeDefined();
      expect(result.diplomatic).toBeDefined();
      expect(result.creative).toBeDefined();
    });
  });
});
