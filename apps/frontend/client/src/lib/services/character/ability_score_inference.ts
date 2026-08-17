// apps/frontend/client/src/lib/services/character/ability_score_inference.ts
//
// Ability-score inference for SillyTavern character-card imports (C-419).
//
// SillyTavern cards do not carry D&D ability scores natively. When a card
// declares no scores, import must not fail — instead we degrade to a
// deterministic default array (the 2024 standard array, reused from the
// LLM-extraction precedent in character_extraction_schema.ts) so the
// resulting persona/NPC always validates against
// NpcSheetSchema/PersonaSheetSchema.
//
// This module is deliberately free of any AI call: parsing + inference are
// separated per the C-419 architecture directive. LLM-based inference is an
// enhancement on top of this deterministic baseline, never a requirement.

import { ABILITY_KEYS, type AbilityScores, DEFAULT_ABILITY_SCORE } from '@aikami/schemas';
import type { Character } from '@aikami/types';

/**
 * Deterministic fallback scores used when a card declares none.
 *
 * The 2024 standard array (15, 14, 13, 12, 10, 8) assigned in canonical
 * ability order — matches the inference guidance already shipped in
 * character_extraction_schema.ts (lines 95-103), so card import and
 * LLM extraction produce comparable characters.
 */
export const STANDARD_ARRAY_SCORES: AbilityScores = {
  strength: 15,
  dexterity: 14,
  constitution: 13,
  intelligence: 12,
  wisdom: 10,
  charisma: 8,
};

/** All scores set to the neutral default (10) — a flatter fallback option. */
export const FLAT_DEFAULT_SCORES: AbilityScores = Object.fromEntries(
  ABILITY_KEYS.map((key) => [key, DEFAULT_ABILITY_SCORE]),
) as AbilityScores;

/**
 * Extracts explicitly-declared ability scores from a card's `extensions`
 * bag, if present. Cards may carry scores under `extensions.abilityScores`
 * (Aikami export convention); anything else is treated as undeclared.
 *
 * @param extensions - The card's extensions record (untrusted input).
 * @returns Partial scores, or undefined when none are declared.
 */
const declaredScoresFromExtensions = (
  extensions: Record<string, unknown>,
): Partial<AbilityScores> | undefined => {
  const raw = extensions.abilityScores;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined;
  }

  const entry = raw as Record<string, unknown>;
  const declared: Partial<AbilityScores> = {};
  let found = false;

  for (const key of ABILITY_KEYS) {
    const value = entry[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      declared[key] = Math.max(1, Math.min(30, Math.round(value)));
      found = true;
    }
  }

  return found ? declared : undefined;
};

/**
 * Infers ability scores for an imported character card.
 *
 * Resolution order:
 * 1. Scores explicitly declared in `extensions.abilityScores` (validated
 *    and clamped) — cards that DO carry stats keep them.
 * 2. Deterministic standard-array default — cards without stats still
 *    compile into a schema-valid sheet (AC-2).
 *
 * Never throws and never requires a network/AI call.
 *
 * @param options - Options object
 * @param options.character - The parsed card character
 * @returns A fully-populated AbilityScores record
 */
export const inferAbilityScores = (options: { character: Character }): AbilityScores => {
  const { character } = options;

  const declared = declaredScoresFromExtensions(character.extensions);
  if (declared) {
    return { ...STANDARD_ARRAY_SCORES, ...declared };
  }

  return { ...STANDARD_ARRAY_SCORES };
};
