type AbilityKey =
  | 'strength'
  | 'dexterity'
  | 'constitution'
  | 'intelligence'
  | 'wisdom'
  | 'charisma';

type AbilityScore = {
  value: number;
  modifier: number;
};

type AbilityScores = Record<AbilityKey, AbilityScore>;

type Skill = {
  name: string;
  ability: AbilityKey;
  proficient: boolean;
  expertise: boolean;
  modifier: number;
};

type SavingThrow = {
  ability: AbilityKey;
  proficient: boolean;
  modifier: number;
};

type CharacterTraits = {
  personalityTraits: string;
  ideals: string;
  bonds: string;
  flaws: string;
};

type NarrativeTraits = {
  likes: string[];
  temptations: string[];
  keys: string[];
};

type CharacterSheet = {
  abilities: AbilityScores;
  skills: Skill[];
  savingThrows: SavingThrow[];
  traits: CharacterTraits;
  narrativeTraits: NarrativeTraits;
  proficiencyBonus: number;
  level: number;
  xp: number;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
};

export const STANDARD_SKILLS: Omit<Skill, 'modifier'>[] = [
  { name: 'Acrobatics', ability: 'dexterity' },
  { name: 'Animal Handling', ability: 'wisdom' },
  { name: 'Arcana', ability: 'intelligence' },
  { name: 'Athletics', ability: 'strength' },
  { name: 'Deception', ability: 'charisma' },
  { name: 'History', ability: 'intelligence' },
  { name: 'Insight', ability: 'wisdom' },
  { name: 'Intimidation', ability: 'charisma' },
  { name: 'Investigation', ability: 'intelligence' },
  { name: 'Medicine', ability: 'wisdom' },
  { name: 'Nature', ability: 'intelligence' },
  { name: 'Perception', ability: 'wisdom' },
  { name: 'Performance', ability: 'charisma' },
  { name: 'Persuasion', ability: 'charisma' },
  { name: 'Religion', ability: 'intelligence' },
  { name: 'Sleight of Hand', ability: 'dexterity' },
  { name: 'Stealth', ability: 'dexterity' },
  { name: 'Survival', ability: 'wisdom' },
];

export function computeModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function computeProficiencyBonus(level: number): number {
  return Math.floor((level - 1) / 4) + 2;
}

export function computeSkillModifier(
  abilityMod: number,
  proficient: boolean,
  pb: number,
  expertise: boolean,
): number {
  return abilityMod + (proficient ? pb * (expertise ? 2 : 1) : 0);
}

export function computeSaveModifier(abilityMod: number, proficient: boolean, pb: number): number {
  return abilityMod + (proficient ? pb : 0);
}

export function serializeForAi(_sheet: CharacterSheet): string {
  // Implementation to be added
  return '';
}

export function validateSheetJson(_json: string): { data?: CharacterSheet; error?: string } {
  // Implementation to be added
  return {};
}

export type {
  AbilityKey,
  AbilityScore,
  AbilityScores,
  CharacterSheet,
  CharacterTraits,
  NarrativeTraits,
  SavingThrow,
  Skill,
};
