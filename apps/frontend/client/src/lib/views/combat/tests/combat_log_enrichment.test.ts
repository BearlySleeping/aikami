// apps/frontend/client/src/lib/views/combat/tests/combat_log_enrichment.test.ts
// C-234 Log Enrichment — unit tests for regex-based dice/damage parsing
//
// Tests:
// - parseDiceFromLog(): dice roll extraction, advantage, crit/fumble
// - parseDamageFromLog(): damage value, type, target
// - parseDiceNotation(): notation string parsing
// - inferDiceLabelFromValue(): dice label inference

import { describe, expect, test } from 'bun:test';
import {
  inferDiceLabelFromValue,
  parseDamageFromLog,
  parseDiceFromLog,
  parseDiceNotation,
} from '../utils/dice_notation.ts';

// ---------------------------------------------------------------------------
// parseDiceFromLog
// ---------------------------------------------------------------------------

describe('parseDiceFromLog', () => {
  test('should extract dice roll from player hit message', () => {
    const result = parseDiceFromLog('Player rolls 18 (+5 = 23) to hit for 12 slashing damage');

    expect(result).toBeDefined();
    expect(result?.diceValue).toBe(18);
    expect(result?.advantage).toBeUndefined();
    expect(result?.disadvantage).toBeUndefined();
    expect(result?.isCritical).toBeUndefined();
    expect(result?.isFumble).toBeUndefined();
  });

  test('should extract dice roll from enemy attack message', () => {
    const result = parseDiceFromLog('Goblin rolls 5 (+2 = 7) — Miss!');

    expect(result).toBeDefined();
    expect(result?.diceValue).toBe(5);
    expect(result?.isFumble).toBeFalsy(); // Not nat 1, just a miss
  });

  test('should detect critical hit', () => {
    const result = parseDiceFromLog('Critical hit! Player rolls 20 for 30 piercing damage');

    expect(result).toBeDefined();
    expect(result?.diceValue).toBe(20);
    expect(result?.isCritical).toBe(true);
  });

  test('should detect fumble/miss', () => {
    const result = parseDiceFromLog('Player fumbles! rolls 1 — Critical Miss!');

    expect(result).toBeDefined();
    expect(result?.diceValue).toBe(1);
    expect(result?.isFumble).toBe(true);
  });

  test('should detect advantage in roll', () => {
    const result = parseDiceFromLog('Player rolls 15 with advantage for 10 slashing damage');

    expect(result).toBeDefined();
    expect(result?.diceValue).toBe(15);
    expect(result?.advantage).toBe(true);
  });

  test('should detect disadvantage in roll', () => {
    const result = parseDiceFromLog('Player rolls 4 with disadvantage — Miss!');

    expect(result).toBeDefined();
    expect(result?.diceValue).toBe(4);
    expect(result?.disadvantage).toBe(true);
  });

  test('should return undefined for non-dice text', () => {
    const result = parseDiceFromLog('The goblin cackles menacingly');

    expect(result).toBeUndefined();
  });

  test('should return undefined for empty string', () => {
    const result = parseDiceFromLog('');

    expect(result).toBeUndefined();
  });

  test('should return undefined for special characters only', () => {
    const result = parseDiceFromLog('🎲 System message');

    expect(result).toBeUndefined();
  });

  test('should parse simple numeric dice value', () => {
    const result = parseDiceFromLog('Player rolls 10 to hit');

    expect(result).toBeDefined();
    expect(result?.diceValue).toBe(10);
  });

  test('should detect nat 20 as critical', () => {
    const result = parseDiceFromLog('Enemy rolls 20 — nat 20! Critical hit!');

    expect(result).toBeDefined();
    expect(result?.diceValue).toBe(20);
    expect(result?.isCritical).toBe(true);
  });

  test('should detect nat 1 as fumble', () => {
    const result = parseDiceFromLog('Player rolls 1 — nat 1! Critical fumble!');

    expect(result).toBeDefined();
    expect(result?.diceValue).toBe(1);
    expect(result?.isFumble).toBe(true);
  });

  test('should handle mock dice roll format', () => {
    const result = parseDiceFromLog('🎲 d20: 15');

    expect(result).toBeDefined();
    expect(result?.diceValue).toBe(15);
  });

  test('should handle dice roll with advantage and bonus damage', () => {
    const result = parseDiceFromLog('Enemy rolls 18 (+4 = 22) with advantage for 15 fire damage');

    expect(result).toBeDefined();
    expect(result?.diceValue).toBe(18);
    expect(result?.advantage).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseDamageFromLog
// ---------------------------------------------------------------------------

describe('parseDamageFromLog', () => {
  test('should extract damage value and type', () => {
    const result = parseDamageFromLog('Player rolls 18 for 12 slashing damage');

    expect(result.damageValue).toBe(12);
    expect(result.damageType).toBe('slashing');
  });

  test('should extract fire damage', () => {
    const result = parseDamageFromLog('Enemy casts fire breath for 22 fire damage');

    expect(result.damageValue).toBe(22);
    expect(result.damageType).toBe('fire');
  });

  test('should extract multiple damage types', () => {
    const types = [
      'slashing',
      'piercing',
      'bludgeoning',
      'fire',
      'cold',
      'lightning',
      'acid',
      'poison',
      'necrotic',
      'radiant',
      'psychic',
      'force',
      'thunder',
    ];

    for (const type of types) {
      const result = parseDamageFromLog(`Deals 15 ${type} damage`);
      expect(result.damageType).toBe(type);
      expect(result.damageValue).toBe(15);
    }
  });

  test('should extract target name', () => {
    const result = parseDamageFromLog('Player attacks the Goblin for 12 slashing damage');

    expect(result.targetName).toBe('the Goblin');
  });

  test('should handle no damage data', () => {
    const result = parseDamageFromLog('Player takes a defensive stance');

    expect(result.damageValue).toBeUndefined();
    expect(result.damageType).toBeUndefined();
    expect(result.targetName).toBeUndefined();
  });

  test('should handle empty string', () => {
    const result = parseDamageFromLog('');

    expect(result.damageValue).toBeUndefined();
    expect(result.damageType).toBeUndefined();
  });

  test('should parse damage with dmg abbreviation', () => {
    const result = parseDamageFromLog('Player deals 15 DMG to the enemy');

    expect(result.damageValue).toBe(15);
  });

  test('should handle damage value at start of text', () => {
    const result = parseDamageFromLog('22 damage to the enemy');

    expect(result.damageValue).toBe(22);
  });

  test('should extract target after attacks/hits/strikes', () => {
    const tests = [
      { text: 'Player hits the goblin for 10 damage', target: 'the goblin' },
      { text: 'Player attacks the dragon', target: 'the dragon' },
      { text: 'Player strikes the skeleton for 15 piercing damage', target: 'the skeleton' },
    ];

    for (const { text, target } of tests) {
      const result = parseDamageFromLog(text);
      expect(result.targetName).toBe(target);
    }
  });
});

// ---------------------------------------------------------------------------
// parseDiceNotation
// ---------------------------------------------------------------------------

describe('parseDiceNotation', () => {
  test('should parse "d20"', () => {
    const result = parseDiceNotation('d20');

    expect(result).toBeDefined();
    expect(result?.count).toBe(1);
    expect(result?.sides).toBe(20);
    expect(result?.label).toBe('d20');
  });

  test('should parse "2d6"', () => {
    const result = parseDiceNotation('2d6');

    expect(result).toBeDefined();
    expect(result?.count).toBe(2);
    expect(result?.sides).toBe(6);
    expect(result?.label).toBe('2d6');
  });

  test('should parse "1d100"', () => {
    const result = parseDiceNotation('1d100');

    expect(result).toBeDefined();
    expect(result?.count).toBe(1);
    expect(result?.sides).toBe(100);
    expect(result?.label).toBe('d100');
  });

  test('should parse uppercase "D20"', () => {
    const result = parseDiceNotation('D20');

    expect(result).toBeDefined();
    expect(result?.count).toBe(1);
    expect(result?.sides).toBe(20);
  });

  test('should return undefined for "foo"', () => {
    const result = parseDiceNotation('foo');

    expect(result).toBeUndefined();
  });

  test('should return undefined for empty string', () => {
    const result = parseDiceNotation('');

    expect(result).toBeUndefined();
  });

  test('should return undefined for negative values', () => {
    const result = parseDiceNotation('-1d20');

    expect(result).toBeUndefined();
  });

  test('should handle whitespace in input', () => {
    const result = parseDiceNotation('  d20  ');

    expect(result).toBeDefined();
    expect(result?.sides).toBe(20);
  });

  test('should parse "3d8"', () => {
    const result = parseDiceNotation('3d8');

    expect(result).toBeDefined();
    expect(result?.count).toBe(3);
    expect(result?.sides).toBe(8);
    expect(result?.label).toBe('3d8');
  });
});

// ---------------------------------------------------------------------------
// inferDiceLabelFromValue
// ---------------------------------------------------------------------------

describe('inferDiceLabelFromValue', () => {
  test('should infer d4 for values 1-4', () => {
    expect(inferDiceLabelFromValue(3)).toBe('d4');
  });

  test('should infer d6 for values 5-6', () => {
    expect(inferDiceLabelFromValue(6)).toBe('d6');
  });

  test('should infer d20 for values 13-20', () => {
    expect(inferDiceLabelFromValue(17)).toBe('d20');
  });

  test('should infer d100 for values 21-100', () => {
    expect(inferDiceLabelFromValue(50)).toBe('d100');
  });

  test('should return undefined for value 0', () => {
    const result = inferDiceLabelFromValue(0);
    expect(result).toBeUndefined();
  });

  test('should return undefined for value > 100', () => {
    const result = inferDiceLabelFromValue(101);
    expect(result).toBeUndefined();
  });

  test('should return d4 for value 1', () => {
    expect(inferDiceLabelFromValue(1)).toBe('d4');
  });
});
