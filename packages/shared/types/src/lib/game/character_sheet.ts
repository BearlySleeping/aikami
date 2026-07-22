// packages/shared/types/src/lib/game/character_sheet.ts
//
// UI-layer character sheet types — derived from @aikami/schemas with
// computed modifier fields. These are the runtime types used by the
// character sheet ViewModels and helpers, not the persistence format.
//
// Contract: C-232 Character Sheet & Traits System

import type { AbilityKey, NarrativeTraits, SavingThrowData, SkillData } from '@aikami/schemas';
import {
  ABILITY_KEYS,
  ABILITY_LABELS,
  DEFAULT_ABILITY_SCORE,
  DEFAULT_NARRATIVE_TRAITS,
  DEFAULT_SAVING_THROWS,
  DEFAULT_SKILLS,
} from '@aikami/schemas';

export type { AbilityKey, NarrativeTraits, SavingThrowData, SkillData };
export {
  ABILITY_KEYS,
  ABILITY_LABELS,
  DEFAULT_ABILITY_SCORE,
  DEFAULT_NARRATIVE_TRAITS,
  DEFAULT_SAVING_THROWS,
  DEFAULT_SKILLS,
};

// ── Computed types (modifier added) ─────────────────────────────────────

/** An ability score with its computed modifier. */
export type AbilityScore = {
  value: number;
  modifier: number;
};

/** Complete ability score record with computed modifiers. */
export type AbilityScores = Record<AbilityKey, AbilityScore>;

/** A skill with its computed total modifier. */
export type CharacterSkill = SkillData & {
  modifier: number;
};

/** A saving throw with its computed total modifier. */
export type CharacterSavingThrow = SavingThrowData & {
  modifier: number;
};

// ── Traits ──────────────────────────────────────────────────────────────

/** Character personality/background traits. */
export type CharacterTraits = {
  personalityTraits: string;
  ideals: string;
  bonds: string;
  flaws: string;
};

/** Default empty traits for character creation. */
export const DEFAULT_TRAITS: CharacterTraits = {
  personalityTraits: '',
  ideals: '',
  bonds: '',
  flaws: '',
} as const;

// ── Standard skills alias (pre-existing consumer compat) ───────────────

/** @deprecated Use DEFAULT_SKILLS instead */
export const STANDARD_SKILLS = DEFAULT_SKILLS;

// ── Full Character Sheet (UI runtime type) ─────────────────────────────

/**
 * Runtime character sheet used by the UI layer.
 *
 * Extends the persistence schema with computed modifiers, and
 * gameplay-specific fields (attack, defense) not present in the
 * stored BaseCharacterSheet.
 */
export type GameCharacterSheet = {
  abilities: AbilityScores;
  skills: CharacterSkill[];
  savingThrows: CharacterSavingThrow[];
  traits: CharacterTraits;
  narrativeTraits: NarrativeTraits;
  proficiencyBonus: number;
  level: number;
  xp: number;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  classId?: string;
  classFeatures?: string[];
  hotbarSlots?: string[];
};
