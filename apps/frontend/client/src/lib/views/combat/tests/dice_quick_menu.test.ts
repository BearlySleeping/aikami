// apps/frontend/client/src/lib/views/combat/tests/dice_quick_menu.test.ts
// C-234 Dice Enhancement — unit tests for dice queuing and resolution logic
//
// Tests the state management operations used by DiceQuickMenu:
// - Queueing dice rolls
// - Removing queued rolls
// - Resolving (rolling) all queued dice
// - DICE_PRESETS structure

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DICE_PRESETS, type DiceNotation, type QueuedRoll } from '../types/combat_enhancements.ts';

// ── Helpers ───────────────────────────────────────────────────────────────

let rollCounter = 0;

const createQueuedRoll = (notation: DiceNotation, label?: string): QueuedRoll => ({
  id: `q-${++rollCounter}`,
  notation,
  label: label ?? notation.label,
  timestamp: Date.now(),
});

const simulateDiceRoll = (notation: DiceNotation): number => {
  let total = 0;
  for (let i = 0; i < notation.count; i++) {
    total += Math.floor(Math.random() * notation.sides) + 1;
  }
  return total;
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe('dice queuing operations', () => {
  let queue: QueuedRoll[] = [];

  beforeEach(() => {
    queue = [];
    rollCounter = 0;
  });

  afterEach(() => {
    queue = [];
  });

  test('should queue a dice roll', () => {
    const roll = createQueuedRoll({ count: 1, sides: 20, label: 'd20' }, 'Attack');
    queue = [...queue, roll];

    expect(queue).toHaveLength(1);
    expect(queue[0].notation.label).toBe('d20');
    expect(queue[0].label).toBe('Attack');
    expect(queue[0].id).toBeDefined();
    expect(queue[0].timestamp).toBeGreaterThan(0);
  });

  test('should queue multiple rolls', () => {
    const roll1 = createQueuedRoll({ count: 1, sides: 20, label: 'd20' }, 'Attack');
    const roll2 = createQueuedRoll({ count: 2, sides: 6, label: '2d6' }, 'Damage');
    queue = [...queue, roll1, roll2];

    expect(queue).toHaveLength(2);
  });

  test('should remove a queued roll by id', () => {
    const roll1 = createQueuedRoll({ count: 1, sides: 20, label: 'd20' });
    const roll2 = createQueuedRoll({ count: 2, sides: 6, label: '2d6' });
    queue = [roll1, roll2];

    queue = queue.filter((r) => r.id !== roll1.id);

    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe(roll2.id);
  });

  test('should remove the correct roll when multiple are in queue', () => {
    const rolls = [
      createQueuedRoll({ count: 1, sides: 4, label: 'd4' }),
      createQueuedRoll({ count: 1, sides: 8, label: 'd8' }),
      createQueuedRoll({ count: 1, sides: 12, label: 'd12' }),
    ];
    queue = [...rolls];

    // Remove middle roll
    queue = queue.filter((r) => r.id !== rolls[1].id);

    expect(queue).toHaveLength(2);
    expect(queue[0].id).toBe(rolls[0].id);
    expect(queue[1].id).toBe(rolls[2].id);
  });

  test('should clear all queued rolls on resolve', () => {
    queue = [
      createQueuedRoll({ count: 1, sides: 20, label: 'd20' }),
      createQueuedRoll({ count: 2, sides: 6, label: '2d6' }),
    ];

    // Resolve all
    const results = queue.map((roll) => {
      const total = simulateDiceRoll(roll.notation);
      return { rollId: roll.id, total };
    });

    queue = [];

    expect(queue).toHaveLength(0);
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.total).toBeGreaterThan(0);
    }
  });

  test('should handle empty queue gracefully', () => {
    const results = queue.map((roll) => simulateDiceRoll(roll.notation));
    expect(results).toHaveLength(0);
  });
});

describe('DICE_PRESETS', () => {
  test('should have exactly 8 presets', () => {
    expect(DICE_PRESETS).toHaveLength(8);
  });

  test('should include d20 preset', () => {
    const d20 = DICE_PRESETS.find((p) => p.label === 'd20');
    expect(d20).toBeDefined();
    expect(d20?.notation.sides).toBe(20);
    expect(d20?.notation.count).toBe(1);
  });

  test('should include 2d6 preset', () => {
    const twoD6 = DICE_PRESETS.find((p) => p.label === '2d6');
    expect(twoD6).toBeDefined();
    expect(twoD6?.notation.sides).toBe(6);
    expect(twoD6?.notation.count).toBe(2);
  });

  test('should have all valid notations', () => {
    for (const preset of DICE_PRESETS) {
      expect(preset.notation.count).toBeGreaterThan(0);
      expect(preset.notation.sides).toBeGreaterThan(0);
      expect(preset.notation.label).toBeTruthy();
      expect(preset.label).toBeTruthy();
    }
  });
});

describe('dice roll simulation', () => {
  test('should produce values within expected range for d20', () => {
    const notation: DiceNotation = { count: 1, sides: 20, label: 'd20' };
    for (let i = 0; i < 100; i++) {
      const result = simulateDiceRoll(notation);
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(20);
    }
  });

  test('should produce values within expected range for 2d6', () => {
    const notation: DiceNotation = { count: 2, sides: 6, label: '2d6' };
    for (let i = 0; i < 100; i++) {
      const result = simulateDiceRoll(notation);
      expect(result).toBeGreaterThanOrEqual(2);
      expect(result).toBeLessThanOrEqual(12);
    }
  });

  test('should produce values within expected range for d100', () => {
    const notation: DiceNotation = { count: 1, sides: 100, label: 'd100' };
    for (let i = 0; i < 100; i++) {
      const result = simulateDiceRoll(notation);
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(100);
    }
  });
});
