import { z } from 'zod';

export const DIFFICULTY_CLASS = {
  VERY_EASY: 5,
  EASY: 10,
  MEDIUM: 15,
  HARD: 20,
  VERY_HARD: 25,
  NEAR_IMPOSSIBLE: 30,
} as const;

export type DifficultyClass = (typeof DIFFICULTY_CLASS)[keyof typeof DIFFICULTY_CLASS];

export const AbilityTypeSchema = z.enum([
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
]);

export type AbilityType = z.infer<typeof AbilityTypeSchema>;

export const SKILL_NAMES = [
  'athletics',
  'acrobatics',
  'sleight of hand',
  'stealth',
  'arcana',
  'history',
  'investigation',
  'medicine',
  'nature',
  'perception',
  'religion',
  'survival',
  'animal handling',
  'insight',
  'deception',
  'intimidation',
  'performance',
  'persuasion',
] as const;

export type SkillName = (typeof SKILL_NAMES)[number];

export const SKILL_ABILITY_MAP: Record<SkillName, AbilityType> = {
  athletics: 'strength',
  acrobatics: 'dexterity',
  'sleight of hand': 'dexterity',
  stealth: 'dexterity',
  arcana: 'intelligence',
  history: 'intelligence',
  investigation: 'intelligence',
  medicine: 'wisdom',
  nature: 'intelligence',
  perception: 'wisdom',
  religion: 'intelligence',
  survival: 'wisdom',
  'animal handling': 'wisdom',
  insight: 'wisdom',
  deception: 'charisma',
  intimidation: 'charisma',
  performance: 'charisma',
  persuasion: 'charisma',
};

export const ABILITY_MODIFIER_CACHE: Record<number, number> = {};

export function calculateAbilityModifier(score: number): number {
  if (ABILITY_MODIFIER_CACHE[score] !== undefined) {
    return ABILITY_MODIFIER_CACHE[score];
  }
  const modifier = Math.floor((score - 10) / 2);
  ABILITY_MODIFIER_CACHE[score] = modifier;
  return modifier;
}

export function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

export type RollResult = {
  die: string;
  rolls: number[];
  total: number;
  modifier: number;
  success: boolean;
  isCritical: boolean;
  isCriticalFail: boolean;
  dc?: number;
};

export type SkillCheckResult = RollResult & {
  skill: SkillName;
  ability: AbilityType;
  proficiencyBonus: number;
  isProficient: boolean;
  isExpertise: boolean;
};

export type SavingThrowResult = RollResult & {
  ability: AbilityType;
  proficiencyBonus: number;
  isProficient: boolean;
  isExpertise: boolean;
};

export type AttackRollResult = RollResult & {
  isHit: boolean;
  damage?: number;
  damageType?: string;
};

export class DiceService {
  static roll(dice: string): RollResult {
    const match = dice.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
    if (!match) {
      throw new Error(`Invalid dice notation: ${dice}`);
    }

    const numDice = parseInt(match[1], 10);
    const numSides = parseInt(match[2], 10);
    const flatModifier = match[3] ? parseInt(match[3], 10) : 0;

    if (numDice < 1 || numDice > 100) {
      throw new Error('Number of dice must be between 1 and 100');
    }
    if (numSides < 2 || numSides > 100) {
      throw new Error('Number of sides must be between 2 and 100');
    }

    const rolls: number[] = [];
    for (let i = 0; i < numDice; i++) {
      rolls.push(rollDie(numSides));
    }

    const diceTotal = rolls.reduce((sum, roll) => sum + roll, 0);
    const total = diceTotal + flatModifier;

    const isD20 = numSides === 20 && numDice === 1;
    const naturalRoll = rolls[0];
    const isCritical = isD20 && naturalRoll === 20;
    const isCriticalFail = isD20 && naturalRoll === 1;

    return {
      die: dice,
      rolls,
      total,
      modifier: flatModifier,
      success: false,
      isCritical,
      isCriticalFail,
    };
  }

  static rollWithDC(dice: string, dc: number, advantage = false, disadvantage = false): RollResult {
    let result: RollResult;

    if (advantage && !disadvantage) {
      const roll1 = DiceService.roll(dice);
      const roll2 = DiceService.roll(dice);
      result = roll1.total >= roll2.total ? roll1 : roll2;
    } else if (disadvantage && !advantage) {
      const roll1 = DiceService.roll(dice);
      const roll2 = DiceService.roll(dice);
      result = roll1.total <= roll2.total ? roll1 : roll2;
    } else {
      result = DiceService.roll(dice);
    }

    result.success = result.total >= dc;
    result.dc = dc;

    return result;
  }

  static calculateSkillCheck(
    abilityScore: number,
    skill: SkillName,
    proficiencyBonus: number,
    isProficient: boolean,
    isExpertise: boolean,
    dc?: number,
    advantage = false,
    disadvantage = false,
  ): SkillCheckResult {
    const ability = SKILL_ABILITY_MAP[skill];
    const abilityModifier = calculateAbilityModifier(abilityScore);

    let proficiency = 0;
    if (isExpertise) {
      proficiency = proficiencyBonus * 2;
    } else if (isProficient) {
      proficiency = proficiencyBonus;
    }

    const totalModifier = abilityModifier + proficiency;
    const dice = '1d20';
    const baseRoll = DiceService.roll(dice);

    let finalRoll: RollResult;
    if (advantage && !disadvantage) {
      const roll1 = DiceService.roll(dice);
      const roll2 = DiceService.roll(dice);
      finalRoll = roll1.total >= roll2.total ? roll1 : roll2;
    } else if (disadvantage && !advantage) {
      const roll1 = DiceService.roll(dice);
      const roll2 = DiceService.roll(dice);
      finalRoll = roll1.total <= roll2.total ? roll1 : roll2;
    } else {
      finalRoll = DiceService.roll(dice);
    }

    const total = finalRoll.rolls[0] + totalModifier;

    return {
      die: dice,
      rolls: finalRoll.rolls,
      total,
      modifier: totalModifier,
      success: dc !== undefined ? total >= dc : false,
      isCritical: finalRoll.isCritical,
      isCriticalFail: finalRoll.isCriticalFail,
      dc,
      skill,
      ability,
      proficiencyBonus,
      isProficient,
      isExpertise,
    };
  }

  static calculateSavingThrow(
    abilityScore: number,
    ability: AbilityType,
    proficiencyBonus: number,
    isProficient: boolean,
    isExpertise: boolean,
    dc?: number,
    advantage = false,
    disadvantage = false,
  ): SavingThrowResult {
    const abilityModifier = calculateAbilityModifier(abilityScore);

    let proficiency = 0;
    if (isExpertise) {
      proficiency = proficiencyBonus * 2;
    } else if (isProficient) {
      proficiency = proficiencyBonus;
    }

    const totalModifier = abilityModifier + proficiency;
    const dice = '1d20';

    let finalRoll: RollResult;
    if (advantage && !disadvantage) {
      const roll1 = DiceService.roll(dice);
      const roll2 = DiceService.roll(dice);
      finalRoll = roll1.total >= roll2.total ? roll1 : roll2;
    } else if (disadvantage && !advantage) {
      const roll1 = DiceService.roll(dice);
      const roll2 = DiceService.roll(dice);
      finalRoll = roll1.total <= roll2.total ? roll1 : roll2;
    } else {
      finalRoll = DiceService.roll(dice);
    }

    const total = finalRoll.rolls[0] + totalModifier;

    return {
      die: dice,
      rolls: finalRoll.rolls,
      total,
      modifier: totalModifier,
      success: dc !== undefined ? total >= dc : false,
      isCritical: finalRoll.isCritical,
      isCriticalFail: finalRoll.isCriticalFail,
      dc,
      ability,
      proficiencyBonus,
      isProficient,
      isExpertise,
    };
  }

  static rollAttack(
    abilityScore: number,
    proficiencyBonus: number,
    isProficient: boolean,
    damageDie: string,
    damageType: string,
    advantage = false,
    disadvantage = false,
  ): AttackRollResult {
    const abilityModifier = calculateAbilityModifier(abilityScore);
    const proficiency = isProficient ? proficiencyBonus : 0;
    const totalModifier = abilityModifier + proficiency;

    const dice = '1d20';
    let attackRoll: RollResult;
    if (advantage && !disadvantage) {
      const roll1 = DiceService.roll(dice);
      const roll2 = DiceService.roll(dice);
      attackRoll = roll1.total >= roll2.total ? roll1 : roll2;
    } else if (disadvantage && !advantage) {
      const roll1 = DiceService.roll(dice);
      const roll2 = DiceService.roll(dice);
      attackRoll = roll1.total <= roll2.total ? roll1 : roll2;
    } else {
      attackRoll = DiceService.roll(dice);
    }

    const total = attackRoll.rolls[0] + totalModifier;
    const damageRoll = DiceService.roll(damageDie);
    const damageTotal = attackRoll.isCritical ? damageRoll.total * 2 : damageRoll.total;

    return {
      die: dice,
      rolls: attackRoll.rolls,
      total,
      modifier: totalModifier,
      success: false,
      isCritical: attackRoll.isCritical,
      isCriticalFail: attackRoll.isCriticalFail,
      isHit: attackRoll.isCritical || (!attackRoll.isCriticalFail && total >= 10),
      damage: damageTotal,
      damageType,
    };
  }

  static getProficiencyBonus(level: number): number {
    if (level < 1 || level > 20) {
      throw new Error('Level must be between 1 and 20');
    }
    return Math.ceil(level / 4) + 1;
  }

  static formatRollResult(result: RollResult): string {
    let message = `Rolled ${result.die}: [${result.rolls.join(', ')}]`;
    if (result.modifier !== 0) {
      message += ` ${result.modifier >= 0 ? '+' : ''}${result.modifier}`;
    }
    message += ` = **${result.total}**`;

    if (result.isCritical) {
      message += ' (CRITICAL SUCCESS!)';
    } else if (result.isCriticalFail) {
      message += ' (CRITICAL FAIL!)';
    } else if (result.dc !== undefined) {
      message += result.success ? ' - Success!' : ' - Failed!';
    }

    return message;
  }

  static formatSkillCheck(result: SkillCheckResult): string {
    let message = `**${result.skill}** check (`;
    message += `${result.ability} ${result.modifier >= 0 ? '+' : ''}${result.modifier}`;
    message += `): [${result.rolls.join(', ')}] + ${result.modifier} = **${result.total}**`;

    if (result.isCritical) {
      message += ' (CRITICAL SUCCESS!)';
    } else if (result.isCriticalFail) {
      message += ' (CRITICAL FAIL!)';
    } else if (result.dc !== undefined) {
      message += result.success ? ` (DC ${result.dc} - Success!)` : ` (DC ${result.dc} - Failed!)`;
    }

    return message;
  }
}

export const diceService = DiceService;
