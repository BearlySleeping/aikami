import { describe, expect, test } from 'bun:test';
import { classifyIntentSimple } from './intent-classifier.ts';

describe('IntentClassifier', () => {
  describe('classifyIntentSimple', () => {
    test('should return none for non-roll messages', () => {
      const result = classifyIntentSimple('Hello, how are you?');
      expect(result.requiresRoll).toBe(false);
      expect(result.action).toBe('none');
    });

    test('should detect attack action', () => {
      const result = classifyIntentSimple('I attack the goblin');
      expect(result.requiresRoll).toBe(true);
      expect(result.action).toBe('attack');
    });

    test('should detect athletics skill', () => {
      const result = classifyIntentSimple('I try to climb the wall');
      expect(result.requiresRoll).toBe(true);
      expect(result.action).toBe('skill-check');
      expect(result.skill).toBe('athletics');
    });

    test('should detect stealth skill', () => {
      const result = classifyIntentSimple('I want to sneak past the guards');
      expect(result.requiresRoll).toBe(true);
      expect(result.action).toBe('skill-check');
      expect(result.skill).toBe('stealth');
    });

    test('should detect persuasion skill', () => {
      const result = classifyIntentSimple('Can I persuade the merchant?');
      expect(result.requiresRoll).toBe(true);
      expect(result.action).toBe('skill-check');
      expect(result.skill).toBe('persuasion');
    });

    test('should detect deception skill', () => {
      const result = classifyIntentSimple('I try to lie to the guard');
      expect(result.requiresRoll).toBe(true);
      expect(result.action).toBe('skill-check');
      expect(result.skill).toBe('deception');
    });

    test('should detect perception skill', () => {
      const result = classifyIntentSimple('I want to look for traps');
      expect(result.requiresRoll).toBe(true);
      expect(result.action).toBe('skill-check');
      expect(result.skill).toBe('perception');
    });

    test('should detect saving throw', () => {
      const result = classifyIntentSimple('I need to make a constitution save');
      expect(result.requiresRoll).toBe(true);
      expect(result.action).toBe('saving-throw');
    });

    test('should detect arcana skill', () => {
      const result = classifyIntentSimple('I try to identify the magical item');
      expect(result.requiresRoll).toBe(true);
      expect(result.action).toBe('skill-check');
      expect(result.skill).toBe('arcana');
    });

    test('should handle try to phrases', () => {
      const result = classifyIntentSimple('I try to pick the lock');
      expect(result.requiresRoll).toBe(true);
      expect(result.action).toBe('skill-check');
    });

    test('should handle I want to phrases', () => {
      const result = classifyIntentSimple('I want to intimidate the enemy');
      expect(result.requiresRoll).toBe(true);
      expect(result.action).toBe('skill-check');
      expect(result.skill).toBe('intimidation');
    });

    test('should handle can I phrases', () => {
      const result = classifyIntentSimple('Can I convince them to help us?');
      expect(result.requiresRoll).toBe(true);
      expect(result.action).toBe('skill-check');
      expect(result.skill).toBe('persuasion');
    });

    test('should default to skill-check when no specific skill detected', () => {
      const result = classifyIntentSimple('I try to do something');
      expect(result.requiresRoll).toBe(true);
      expect(result.action).toBe('skill-check');
    });

    test('should detect strength ability', () => {
      const result = classifyIntentSimple('I try to lift the heavy boulder');
      expect(result.requiresRoll).toBe(true);
      expect(result.ability).toBe('strength');
    });

    test('should detect insight skill', () => {
      const result = classifyIntentSimple('I want to read his intentions');
      expect(result.requiresRoll).toBe(true);
      expect(result.action).toBe('skill-check');
      expect(result.skill).toBe('insight');
    });

    test('should detect investigation skill', () => {
      const result = classifyIntentSimple('I search the room for clues');
      expect(result.requiresRoll).toBe(true);
      expect(result.action).toBe('skill-check');
      expect(result.skill).toBe('investigation');
    });
  });
});
