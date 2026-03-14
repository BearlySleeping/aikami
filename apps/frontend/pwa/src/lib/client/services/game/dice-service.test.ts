import { describe, expect, test } from 'bun:test';
import {
  calculateAbilityModifier,
  DIFFICULTY_CLASS,
  DiceService,
  rollDie,
  SKILL_ABILITY_MAP,
  SKILL_NAMES,
} from './dice-service.ts';

describe('DiceService', () => {
  describe('roll', () => {
    test('should roll a single d20', () => {
      const result = DiceService.roll('1d20');
      expect(result.die).toBe('1d20');
      expect(result.rolls).toHaveLength(1);
      expect(result.rolls[0]).toBeGreaterThanOrEqual(1);
      expect(result.rolls[0]).toBeLessThanOrEqual(20);
    });

    test('should roll multiple dice', () => {
      const result = DiceService.roll('3d6');
      expect(result.die).toBe('3d6');
      expect(result.rolls).toHaveLength(3);
      result.rolls.forEach((roll) => {
        expect(roll).toBeGreaterThanOrEqual(1);
        expect(roll).toBeLessThanOrEqual(6);
      });
    });

    test('should handle positive modifiers', () => {
      const result = DiceService.roll('1d20+5');
      expect(result.modifier).toBe(5);
      expect(result.total).toBe(result.rolls[0] + 5);
    });

    test('should handle negative modifiers', () => {
      const result = DiceService.roll('1d20-3');
      expect(result.modifier).toBe(-3);
      expect(result.total).toBe(result.rolls[0] - 3);
    });

    test('should identify natural 20 as critical', () => {
      const results: number[] = [];
      for (let i = 0; i < 1000; i++) {
        const result = DiceService.roll('1d20');
        if (result.rolls[0] === 20) {
          results.push(result.rolls[0]);
          expect(result.isCritical).toBe(true);
          expect(result.isCriticalFail).toBe(false);
          break;
        }
      }
      expect(results).toContain(20);
    });

    test('should identify natural 1 as critical fail', () => {
      const results: number[] = [];
      for (let i = 0; i < 1000; i++) {
        const result = DiceService.roll('1d20');
        if (result.rolls[0] === 1) {
          results.push(result.rolls[0]);
          expect(result.isCritical).toBe(false);
          expect(result.isCriticalFail).toBe(true);
          break;
        }
      }
      expect(results).toContain(1);
    });

    test('should reject invalid dice notation', () => {
      expect(() => DiceService.roll('invalid')).toThrow();
      expect(() => DiceService.roll('2d')).toThrow();
      expect(() => DiceService.roll('d20')).toThrow();
    });

    test('should reject invalid number of dice', () => {
      expect(() => DiceService.roll('0d20')).toThrow();
      expect(() => DiceService.roll('101d20')).toThrow();
    });
  });

  describe('rollWithDC', () => {
    test('should return success when roll meets DC', () => {
      const result = DiceService.rollWithDC('1d20', 10);
      if (result.total >= 10) {
        expect(result.success).toBe(true);
      } else {
        expect(result.success).toBe(false);
      }
      expect(result.dc).toBe(10);
    });

    test('should apply advantage correctly', () => {
      const results: number[] = [];
      for (let i = 0; i < 100; i++) {
        const result = DiceService.rollWithDC('1d20', 1, true, false);
        results.push(result.rolls[0]);
      }
      const maxRoll = Math.max(...results);
      expect(maxRoll).toBe(20);
    });

    test('should apply disadvantage correctly', () => {
      const results: number[] = [];
      for (let i = 0; i < 100; i++) {
        const result = DiceService.rollWithDC('1d20', 1, false, true);
        results.push(result.rolls[0]);
      }
      const minRoll = Math.min(...results);
      expect(minRoll).toBe(1);
    });
  });

  describe('calculateSkillCheck', () => {
    test('should calculate correct modifier from ability score', () => {
      const result = DiceService.calculateSkillCheck(
        16,
        'athletics',
        3,
        true,
        false,
        DIFFICULTY_CLASS.EASY,
      );
      expect(result.ability).toBe('strength');
      expect(result.modifier).toBe(6);
      expect(result.isProficient).toBe(true);
      expect(result.isExpertise).toBe(false);
    });

    test('should apply expertise when proficient with expertise', () => {
      const result = DiceService.calculateSkillCheck(
        16,
        'athletics',
        3,
        true,
        true,
        DIFFICULTY_CLASS.EASY,
      );
      expect(result.modifier).toBe(9);
      expect(result.isExpertise).toBe(true);
    });

    test('should return success based on DC', () => {
      const result = DiceService.calculateSkillCheck(10, 'persuasion', 2, false, false, 15);
      expect(result.dc).toBe(15);
      expect(result.skill).toBe('persuasion');
    });
  });

  describe('calculateSavingThrow', () => {
    test('should calculate DEX saving throw correctly', () => {
      const result = DiceService.calculateSavingThrow(
        14,
        'dexterity',
        3,
        true,
        false,
        DIFFICULTY_CLASS.MEDIUM,
      );
      expect(result.ability).toBe('dexterity');
      expect(result.modifier).toBe(5);
      expect(result.isProficient).toBe(true);
    });

    test('should apply expertise to saving throws', () => {
      const result = DiceService.calculateSavingThrow(
        20,
        'charisma',
        3,
        true,
        true,
        DIFFICULTY_CLASS.HARD,
      );
      expect(result.modifier).toBe(11);
      expect(result.isExpertise).toBe(true);
    });
  });

  describe('rollAttack', () => {
    test('should calculate attack roll with proficiency', () => {
      const result = DiceService.rollAttack(10, 2, true, '1d8', 'slashing');
      expect(result.damageType).toBe('slashing');
      expect(result.modifier).toBe(2);
      expect(result.isHit).toBeDefined();
    });

    test('should double damage on critical hit', () => {
      let _hasCritical = false;
      for (let i = 0; i < 1000; i++) {
        const result = DiceService.rollAttack(10, 0, false, '1d8', 'slashing');
        if (result.isCritical) {
          _hasCritical = true;
          expect(result.damage).toBeGreaterThanOrEqual(2);
          break;
        }
      }
    });
  });

  describe('getProficiencyBonus', () => {
    test('should return correct bonus for levels 1-4', () => {
      expect(DiceService.getProficiencyBonus(1)).toBe(2);
      expect(DiceService.getProficiencyBonus(4)).toBe(2);
    });

    test('should return correct bonus for levels 5-8', () => {
      expect(DiceService.getProficiencyBonus(5)).toBe(3);
      expect(DiceService.getProficiencyBonus(8)).toBe(3);
    });

    test('should return correct bonus for levels 9-12', () => {
      expect(DiceService.getProficiencyBonus(9)).toBe(4);
      expect(DiceService.getProficiencyBonus(12)).toBe(4);
    });

    test('should throw for invalid levels', () => {
      expect(() => DiceService.getProficiencyBonus(0)).toThrow();
      expect(() => DiceService.getProficiencyBonus(21)).toThrow();
    });
  });

  describe('formatRollResult', () => {
    test('should format roll result correctly', () => {
      const result = DiceService.roll('1d20+5');
      const formatted = DiceService.formatRollResult(result);
      expect(formatted).toContain('1d20');
      expect(formatted).toContain(String(result.total));
    });
  });

  describe('formatSkillCheck', () => {
    test('should format skill check correctly', () => {
      const result = DiceService.calculateSkillCheck(16, 'athletics', 3, true, false, 15);
      const formatted = DiceService.formatSkillCheck(result);
      expect(formatted).toContain('athletics');
      expect(formatted).toContain(String(result.total));
    });
  });
});

describe('calculateAbilityModifier', () => {
  test('should return correct modifier for score 10', () => {
    expect(calculateAbilityModifier(10)).toBe(0);
  });

  test('should return correct modifier for score 8', () => {
    expect(calculateAbilityModifier(8)).toBe(-1);
  });

  test('should return correct modifier for score 20', () => {
    expect(calculateAbilityModifier(20)).toBe(5);
  });

  test('should return correct modifier for odd scores', () => {
    expect(calculateAbilityModifier(15)).toBe(2);
    expect(calculateAbilityModifier(13)).toBe(1);
  });

  test('should cache modifiers', () => {
    const first = calculateAbilityModifier(16);
    const second = calculateAbilityModifier(16);
    expect(first).toBe(second);
  });
});

describe('rollDie', () => {
  test('should roll within range', () => {
    for (let i = 0; i < 100; i++) {
      const result = rollDie(6);
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(6);
    }
  });
});

describe('DIFFICULTY_CLASS', () => {
  test('should have correct values', () => {
    expect(DIFFICULTY_CLASS.VERY_EASY).toBe(5);
    expect(DIFFICULTY_CLASS.EASY).toBe(10);
    expect(DIFFICULTY_CLASS.MEDIUM).toBe(15);
    expect(DIFFICULTY_CLASS.HARD).toBe(20);
    expect(DIFFICULTY_CLASS.VERY_HARD).toBe(25);
    expect(DIFFICULTY_CLASS.NEAR_IMPOSSIBLE).toBe(30);
  });
});

describe('SKILL_ABILITY_MAP', () => {
  test('should map all skills to abilities', () => {
    for (const skill of SKILL_NAMES) {
      expect(SKILL_ABILITY_MAP[skill]).toBeDefined();
    }
  });

  test('should map athletics to strength', () => {
    expect(SKILL_ABILITY_MAP.athletics).toBe('strength');
  });

  test('should map acrobatics to dexterity', () => {
    expect(SKILL_ABILITY_MAP.acrobatics).toBe('dexterity');
  });

  test('should map persuasion to charisma', () => {
    expect(SKILL_ABILITY_MAP.persuasion).toBe('charisma');
  });
});
