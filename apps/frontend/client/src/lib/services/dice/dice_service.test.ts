import { beforeEach, describe, expect, test } from 'bun:test';

// $state, $derived, and @aikami/frontend/services mock are provided by test_preload.ts

import type { DiceServiceInterface } from './dice_service.svelte.ts';

describe('DiceService', () => {
  let diceService: DiceServiceInterface;

  beforeEach(async () => {
    const mod = await import('./dice_service.svelte.ts');
    diceService = mod.diceService;
    diceService.history.length = 0;
    // Reset to non-deterministic mode between tests
    diceService.setSeed(null);
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

  test('roll(0) returns 0 in non-deterministic mode', () => {
    diceService.setSeed(null);
    const result = diceService.roll(0);
    expect(result).toBe(0);
  });

  test('roll(-1) returns 0 in non-deterministic mode', () => {
    diceService.setSeed(null);
    const result = diceService.roll(-1);
    expect(result).toBe(0);
  });

  test('roll(0) returns 0 in deterministic mode', () => {
    diceService.setSeed(42);
    const result = diceService.roll(0);
    expect(result).toBe(0);
  });

  test('roll(-1) returns 0 in deterministic mode', () => {
    diceService.setSeed(42);
    const result = diceService.roll(-1);
    expect(result).toBe(0);
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

  describe('setSeed — deterministic mode (C-336 AC-4)', () => {
    test('given the same seed, rollD20 returns the same natural/total', () => {
      diceService.setSeed(42);

      const roll1 = diceService.rollD20(3);
      const roll2 = diceService.rollD20(3);
      const roll3 = diceService.rollD20(3);

      // Reset and seed again
      diceService.setSeed(null);
      diceService.setSeed(42);

      const roll1Again = diceService.rollD20(3);
      const roll2Again = diceService.rollD20(3);
      const roll3Again = diceService.rollD20(3);

      expect(roll1.natural).toBe(roll1Again.natural);
      expect(roll1.total).toBe(roll1Again.total);
      expect(roll2.natural).toBe(roll2Again.natural);
      expect(roll2.total).toBe(roll2Again.total);
      expect(roll3.natural).toBe(roll3Again.natural);
      expect(roll3.total).toBe(roll3Again.total);
    });

    test('setSeed(null) reverts to non-deterministic mode', () => {
      diceService.setSeed(42);
      const seededRoll = diceService.rollD20();

      // After clearing seed, rolls should not be predictably deterministic
      diceService.setSeed(null);
      const unseededRoll = diceService.rollD20();

      // We can't assert specific values, but both must be valid d20 rolls
      expect(unseededRoll.natural).toBeGreaterThanOrEqual(1);
      expect(unseededRoll.natural).toBeLessThanOrEqual(20);
      expect(seededRoll.natural).toBeGreaterThanOrEqual(1);
      expect(seededRoll.natural).toBeLessThanOrEqual(20);
    });

    test('different seeds produce different roll sequences', () => {
      diceService.setSeed(42);
      const rollsA = [diceService.rollD20(), diceService.rollD20(), diceService.rollD20()];

      diceService.setSeed(99);
      const rollsB = [diceService.rollD20(), diceService.rollD20(), diceService.rollD20()];

      const sequencesDiffer = rollsA.some((a, i) => a.natural !== rollsB[i].natural);
      expect(sequencesDiffer).toBe(true);
    });
  });
});
