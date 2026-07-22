// packages/shared/utils/src/lib/rules/character_sheet.ts
//
// Pure computation helpers for the Character Sheet system.
// No side effects, no Svelte reactivity — all functions are deterministic.
// Contract: C-232 Character Sheet & Traits System

import type { AbilityKey } from '@aikami/schemas';
import {
  ABILITY_KEYS,
  ABILITY_LABELS,
  DEFAULT_ABILITY_SCORE,
  DEFAULT_SKILLS,
} from '@aikami/schemas';
import type {
  AbilityScores,
  CharacterSavingThrow,
  CharacterSkill,
  CharacterTraits,
  GameCharacterSheet,
} from '@aikami/types';
import { DEFAULT_NARRATIVE_TRAITS, DEFAULT_TRAITS } from '@aikami/types';

// ── Modifier computation ─────────────────────────────────

/**
 * Compute D&D 5e ability modifier: floor((score - 10) / 2).
 * Clamped to scores 3–20 for safety.
 */
export const computeModifier = (score: number): number => {
  const clamped = Math.max(3, Math.min(20, Math.round(score)));
  return Math.floor((clamped - 10) / 2);
};

/**
 * Compute proficiency bonus from character level.
 * Level 1-4: +2, 5-8: +3, 9-12: +4, 13-16: +5, 17-20: +6.
 */
export const computeProficiencyBonus = (level: number): number => {
  const clamped = Math.max(1, Math.min(20, Math.round(level)));
  return Math.floor((clamped - 1) / 4) + 2;
};

/**
 * Compute a skill's total modifier:
 * abilityMod + (isProficient ? pb : 0) * (isExpertise ? 2 : 1)
 */
export const computeSkillModifier = (
  abilityMod: number,
  isProficient: boolean,
  proficiencyBonus: number,
  isExpertise: boolean,
): number => {
  const profAdd = isProficient ? proficiencyBonus : 0;
  const multiplier = isExpertise ? 2 : 1;
  return abilityMod + profAdd * multiplier;
};

/**
 * Compute a saving throw's total modifier:
 * abilityMod + (isProficient ? pb : 0)
 */
export const computeSaveModifier = (
  abilityMod: number,
  isProficient: boolean,
  proficiencyBonus: number,
): number => {
  return abilityMod + (isProficient ? proficiencyBonus : 0);
};

// ── Factory functions ────────────────────────────────────

/** Create default ability scores (value=10, modifier=0). */
export const createDefaultAbilities = (): AbilityScores => {
  const abilities = {} as AbilityScores;
  for (const key of ABILITY_KEYS) {
    abilities[key] = { value: DEFAULT_ABILITY_SCORE, modifier: 0 };
  }
  return abilities;
};

/** Create default saving throw list (all non-proficient, modifier=0). */
export const createDefaultSavingThrows = (): CharacterSavingThrow[] =>
  ABILITY_KEYS.map((key) => ({
    ability: key,
    isProficient: false,
    isExpertise: false,
    modifier: 0,
  }));

/** Create default skill list from standard SRD skills (all non-proficient, modifier=0). */
export const createDefaultSkills = (): CharacterSkill[] =>
  DEFAULT_SKILLS.map((s) => ({ ...s, modifier: 0 }));

/** Create a full default character sheet. */
export const createDefaultSheet = (): GameCharacterSheet => ({
  abilities: createDefaultAbilities(),
  skills: createDefaultSkills(),
  savingThrows: createDefaultSavingThrows(),
  traits: { ...(DEFAULT_TRAITS as CharacterTraits) },
  narrativeTraits: { ...DEFAULT_NARRATIVE_TRAITS },
  proficiencyBonus: 2,
  level: 1,
  xp: 0,
  hp: 10,
  maxHp: 10,
  attack: 0,
  defense: 10,
});

// ── Score recalculation ──────────────────────────────────

/**
 * Recompute all ability modifiers in-place and return updated scores.
 */
export const recomputeAbilities = (abilities: AbilityScores): AbilityScores => {
  const result = { ...abilities };
  for (const key of ABILITY_KEYS) {
    const score = result[key];
    result[key] = { ...score, modifier: computeModifier(score.value) };
  }
  return result;
};

/**
 * Recompute all skill modifiers given current abilities and proficiency bonus.
 */
export const recomputeSkills = (
  skills: CharacterSkill[],
  abilities: AbilityScores,
  proficiencyBonus: number,
): CharacterSkill[] => {
  return skills.map((skill) => {
    const abilityMod = abilities[skill.ability]?.modifier ?? 0;
    return {
      ...skill,
      modifier: computeSkillModifier(
        abilityMod,
        skill.isProficient,
        proficiencyBonus,
        skill.isExpertise,
      ),
    };
  });
};

/**
 * Recompute all saving throw modifiers.
 */
export const recomputeSavingThrows = (
  saves: CharacterSavingThrow[],
  abilities: AbilityScores,
  proficiencyBonus: number,
): CharacterSavingThrow[] => {
  return saves.map((save) => {
    const abilityMod = abilities[save.ability]?.modifier ?? 0;
    return {
      ...save,
      modifier: computeSaveModifier(abilityMod, save.isProficient, proficiencyBonus),
    };
  });
};

// ── AI Serialization ─────────────────────────────────────

/** Format a single ability as compact text: "STR 16(+3)" */
const formatAbility = (key: AbilityKey, score: { value: number; modifier: number }): string => {
  const label = ABILITY_LABELS[key];
  const sign = score.modifier >= 0 ? '+' : '';
  return `${label} ${score.value}(${sign}${score.modifier})`;
};

/**
 * Serialize a CharacterSheet into a compact text block for AI system prompt injection.
 * Target: under 2KB. Omits default values to save tokens.
 */
export const serializeForAi = (sheet: GameCharacterSheet): string => {
  const lines: string[] = ['[CHARACTER SHEET]'];

  // Header line: Level / Class / HP / ATK / DEF
  const classLabel = sheet.classId
    ? sheet.classId.charAt(0).toUpperCase() + sheet.classId.slice(1)
    : '';
  const headerParts = [`Level ${sheet.level}`];
  if (classLabel) {
    headerParts.push(classLabel);
  }
  headerParts.push(`HP ${sheet.hp}/${sheet.maxHp}`, `ATK +${sheet.attack}`, `DEF ${sheet.defense}`);
  lines.push(headerParts.join(' | '));

  // Ability scores
  const abilityStr = ABILITY_KEYS.map((k) => formatAbility(k, sheet.abilities[k])).join(' ');
  lines.push(abilityStr);

  // Proficient skills (only list those with proficiency — skip defaults)
  const proficientSkills = sheet.skills.filter((s) => s.isProficient).map((s) => s.name);
  if (proficientSkills.length > 0) {
    lines.push(`Proficiency: ${proficientSkills.join(', ')}`);
  }

  // Saving throws (only list proficient saves)
  const proficientSaves = sheet.savingThrows
    .filter((s) => s.isProficient)
    .map((s) => {
      const sign = s.modifier >= 0 ? '+' : '';
      return `${ABILITY_LABELS[s.ability]} ${sign}${s.modifier}`;
    });
  if (proficientSaves.length > 0) {
    lines.push(`Saves: ${proficientSaves.join(', ')}`);
  }

  // Class Features (C-337) — names only to save tokens
  if (sheet.classFeatures && sheet.classFeatures.length > 0) {
    lines.push(`Features: ${sheet.classFeatures.join(', ')}`);
  }

  // Traits (only include non-empty)
  const nonEmptyTraits: string[] = [];
  if (sheet.traits.personalityTraits) {
    nonEmptyTraits.push(`"${sheet.traits.personalityTraits}"`);
  }
  if (sheet.traits.ideals) {
    nonEmptyTraits.push(`Ideals: "${sheet.traits.ideals}"`);
  }
  if (sheet.traits.bonds) {
    nonEmptyTraits.push(`Bonds: "${sheet.traits.bonds}"`);
  }
  if (sheet.traits.flaws) {
    nonEmptyTraits.push(`Flaws: "${sheet.traits.flaws}"`);
  }
  if (nonEmptyTraits.length > 0) {
    lines.push(`Traits: ${nonEmptyTraits.join('. ')}`);
  }

  // Narrative traits
  if (sheet.narrativeTraits.likes.length > 0) {
    lines.push(`Likes: ${sheet.narrativeTraits.likes.join(', ')}`);
  }
  if (sheet.narrativeTraits.temptations.length > 0) {
    lines.push(`Temptations: ${sheet.narrativeTraits.temptations.join(', ')}`);
  }
  if (sheet.narrativeTraits.keys.length > 0) {
    lines.push(
      `Keys: ${sheet.narrativeTraits.keys.join(', ')} — the GM should seed related plot hooks.`,
    );
  }

  return lines.join('\n');
};

// ── JSON Validation ──────────────────────────────────────

export type SheetValidationResult =
  | { ok: true; data: GameCharacterSheet }
  | { ok: false; error: string };

/**
 * Validate raw JSON string against CharacterSheet shape.
 * Lightweight check — no full Zod/TypeBox schema (can be added later).
 */
export const validateSheetJson = (json: string): SheetValidationResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Invalid JSON' };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: 'Root must be an object' };
  }

  const data = parsed as Record<string, unknown>;

  // Check required top-level keys
  const required = ['abilities', 'skills', 'savingThrows', 'traits', 'narrativeTraits'];
  for (const key of required) {
    if (!(key in data)) {
      return { ok: false, error: `Missing required field: ${key}` };
    }
  }

  // Check abilities
  const abilities = data.abilities as Record<string, unknown> | undefined;
  if (abilities) {
    for (const key of ABILITY_KEYS) {
      const score = abilities[key] as { value?: unknown } | undefined;
      if (!score || typeof score.value !== 'number') {
        return { ok: false, error: `Invalid ability score: ${key}` };
      }
      if (score.value < 3 || score.value > 20) {
        return { ok: false, error: `Ability score out of range (3-20): ${key} = ${score.value}` };
      }
    }
  }

  return { ok: true, data: parsed as GameCharacterSheet };
};
