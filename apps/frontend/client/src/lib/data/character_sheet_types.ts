// apps/frontend/client/src/lib/data/character_sheet_types.ts
//
// Type definitions for the D&D-style Character Sheet system.
// Contract: C-232 Character Sheet & Traits System

// ── Ability Scores ──────────────────────────────────────

export type AbilityKey =
  | 'strength'
  | 'dexterity'
  | 'constitution'
  | 'intelligence'
  | 'wisdom'
  | 'charisma';

export const ABILITY_KEYS: readonly AbilityKey[] = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
] as const;

export const ABILITY_LABELS: Record<AbilityKey, string> = {
  strength: 'STR',
  dexterity: 'DEX',
  constitution: 'CON',
  intelligence: 'INT',
  wisdom: 'WIS',
  charisma: 'CHA',
} as const;

export type AbilityScore = {
  value: number; // 3–20 (standard D&D range)
  modifier: number; // Computed: floor((value - 10) / 2)
};

export type AbilityScores = Record<AbilityKey, AbilityScore>;

// ── Skills ──────────────────────────────────────────────

export type Skill = {
  name: string;
  ability: AbilityKey;
  isProficient: boolean;
  isExpertise: boolean; // Double proficiency bonus (rogue/bard feature)
  modifier: number; // Computed: abilityMod + (isProficient ? pb : 0) * (isExpertise ? 2 : 1)
};

// Standard D&D 5e SRD skills — 18 skills mapped to abilities
export const STANDARD_SKILLS: readonly Omit<Skill, 'modifier'>[] = [
  { name: 'Acrobatics', ability: 'dexterity', isProficient: false, isExpertise: false },
  { name: 'Animal Handling', ability: 'wisdom', isProficient: false, isExpertise: false },
  { name: 'Arcana', ability: 'intelligence', isProficient: false, isExpertise: false },
  { name: 'Athletics', ability: 'strength', isProficient: false, isExpertise: false },
  { name: 'Deception', ability: 'charisma', isProficient: false, isExpertise: false },
  { name: 'History', ability: 'intelligence', isProficient: false, isExpertise: false },
  { name: 'Insight', ability: 'wisdom', isProficient: false, isExpertise: false },
  { name: 'Intimidation', ability: 'charisma', isProficient: false, isExpertise: false },
  { name: 'Investigation', ability: 'intelligence', isProficient: false, isExpertise: false },
  { name: 'Medicine', ability: 'wisdom', isProficient: false, isExpertise: false },
  { name: 'Nature', ability: 'intelligence', isProficient: false, isExpertise: false },
  { name: 'Perception', ability: 'wisdom', isProficient: false, isExpertise: false },
  { name: 'Performance', ability: 'charisma', isProficient: false, isExpertise: false },
  { name: 'Persuasion', ability: 'charisma', isProficient: false, isExpertise: false },
  { name: 'Religion', ability: 'intelligence', isProficient: false, isExpertise: false },
  { name: 'Sleight of Hand', ability: 'dexterity', isProficient: false, isExpertise: false },
  { name: 'Stealth', ability: 'dexterity', isProficient: false, isExpertise: false },
  { name: 'Survival', ability: 'wisdom', isProficient: false, isExpertise: false },
] as const;

// ── Saving Throws ───────────────────────────────────────

export type SavingThrow = {
  ability: AbilityKey;
  isProficient: boolean;
  modifier: number; // Computed: abilityMod + (isProficient ? pb : 0)
};

// ── Traits ──────────────────────────────────────────────

export type CharacterTraits = {
  personalityTraits: string;
  ideals: string;
  bonds: string;
  flaws: string;
};

// ── Narrative Traits ─────────────────═══════════════════

export type NarrativeTraits = {
  likes: string[]; // ["Gold", "Ancient Lore", "Flattery"]
  temptations: string[]; // ["Power", "Revenge", "Forbidden Knowledge"]
  keys: string[]; // ["Lost Sister", "The Crown of Aldren"]
};

// ── Full Character Sheet ─═══════════════════════════════

export type CharacterSheet = {
  abilities: AbilityScores;
  skills: Skill[];
  savingThrows: SavingThrow[];
  traits: CharacterTraits;
  narrativeTraits: NarrativeTraits;
  proficiencyBonus: number;

  // Inherited from existing PersonaData / GameStateService:
  level: number;
  xp: number;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;

  // ── Class Progression (C-337) ──

  /** Class definition ID ("fighter", "wizard", etc.) */
  classId?: string;
  /** Feature IDs the character has unlocked */
  classFeatures?: string[];
  /** Feature IDs currently slotted on the hotbar (max 6) */
  hotbarSlots?: string[];
};

// ── Defaults ────────────────────────────────────────────

export const DEFAULT_ABILITY_SCORE = 10;

export const DEFAULT_TRAITS: CharacterTraits = {
  personalityTraits: '',
  ideals: '',
  bonds: '',
  flaws: '',
};

export const DEFAULT_NARRATIVE_TRAITS: NarrativeTraits = {
  likes: [],
  temptations: [],
  keys: [],
};

export const createDefaultAbilities = (): AbilityScores => {
  const abilities = {} as AbilityScores;
  for (const key of ABILITY_KEYS) {
    abilities[key] = { value: DEFAULT_ABILITY_SCORE, modifier: 0 };
  }
  return abilities;
};

export const createDefaultSavingThrows = (): SavingThrow[] =>
  ABILITY_KEYS.map((key) => ({ ability: key, isProficient: false, modifier: 0 }));

export const createDefaultSkills = (): Skill[] =>
  STANDARD_SKILLS.map((s) => ({ ...s, modifier: 0 }));

export const createDefaultSheet = (): CharacterSheet => ({
  abilities: createDefaultAbilities(),
  skills: createDefaultSkills(),
  savingThrows: createDefaultSavingThrows(),
  traits: { ...DEFAULT_TRAITS },
  narrativeTraits: { ...DEFAULT_NARRATIVE_TRAITS },
  proficiencyBonus: 2,
  level: 1,
  xp: 0,
  hp: 10,
  maxHp: 10,
  attack: 0,
  defense: 10,
});
