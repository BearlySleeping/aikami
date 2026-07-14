import { beforeEach, describe, expect, test } from 'bun:test';

// $state, $derived, and @aikami/frontend/services mock are provided by test_preload.ts

import type { DiceServiceInterface } from './dice_service.svelte.ts';

describe('DiceService', () => {
  let diceService: DiceServiceInterface;

  beforeEach(async () => {
    const mod = await import('./dice_service.svelte.ts');
    diceService = mod.diceService;
    diceService.history.length = 0;
  });

  test('roll should return a number within the specified sides', () => {
    const sides = 6;
    for (let i = 0; i < 20; i++) {
      const result = diceService.roll(sides);
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(sides);
    }
    expect(diceService.history.length).toBe(20);
  });

  test('rollD20 should return correct structure and calculate total', () => {
    const result = diceService.rollD20(5);
    expect(result).toHaveProperty('natural');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('isCriticalSuccess');
    expect(result).toHaveProperty('isCriticalFailure');
  });

  test('rollCheck should correctly determine success or failure', () => {
    const dc = 15;
    const modifier = 5;
    const originalRandom = Math.random;

    Math.random = () => 0.5;
    let result = diceService.rollCheck(modifier, dc);
    expect(result.success).toBe(true);

    Math.random = () => 0.1;
    result = diceService.rollCheck(modifier, dc);
    expect(result.success).toBe(false);

    Math.random = originalRandom;
  });

  describe('rollNotation', () => {
    test('d20 should return a value between 1 and 20', () => {
      for (let i = 0; i < 50; i++) {
        const result = diceService.rollNotation({ count: 1, sides: 20, label: '1d20' });
        expect(result).toBeGreaterThanOrEqual(1);
        expect(result).toBeLessThanOrEqual(20);
      }
    });

    test('2d6 should return a value between 2 and 12', () => {
      for (let i = 0; i < 50; i++) {
        const result = diceService.rollNotation({ count: 2, sides: 6, label: '2d6' });
        expect(result).toBeGreaterThanOrEqual(2);
        expect(result).toBeLessThanOrEqual(12);
      }
    });

    test('d100 should return a value between 1 and 100', () => {
      for (let i = 0; i < 50; i++) {
        const result = diceService.rollNotation({ count: 1, sides: 100, label: '1d100' });
        expect(result).toBeGreaterThanOrEqual(1);
        expect(result).toBeLessThanOrEqual(100);
      }
    });

    test('should push result to history', () => {
      const beforeLength = diceService.history.length;
      diceService.rollNotation({ count: 1, sides: 20, label: '1d20' });
      expect(diceService.history.length).toBe(beforeLength + 1);
    });

    test('should push multiple results to history for multiple calls', () => {
      const beforeLength = diceService.history.length;
      diceService.rollNotation({ count: 1, sides: 20 });
      diceService.rollNotation({ count: 1, sides: 20 });
      diceService.rollNotation({ count: 1, sides: 20 });
      expect(diceService.history.length).toBe(beforeLength + 3);
    });

    test('4d6 should return a value between 4 and 24', () => {
      for (let i = 0; i < 50; i++) {
        const result = diceService.rollNotation({ count: 4, sides: 6, label: '4d6' });
        expect(result).toBeGreaterThanOrEqual(4);
        expect(result).toBeLessThanOrEqual(24);
      }
    });
  });
});
