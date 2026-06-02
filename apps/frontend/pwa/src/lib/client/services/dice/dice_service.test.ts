import { beforeEach, describe, expect, mock, test } from 'bun:test';

(globalThis as { $state: <T>(val: T) => T; $derived: <T>(val: T) => T }).$state = (val) => val;
(globalThis as { $state: <T>(val: T) => T; $derived: <T>(val: T) => T }).$derived = (val) => val;

mock.module('@aikami/frontend/services', () => {
  return {
    BaseFrontendClass: class BaseFrontendClass {},
  };
});

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
});
