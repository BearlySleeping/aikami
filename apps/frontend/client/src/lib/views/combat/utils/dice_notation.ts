// apps/frontend/client/src/lib/views/combat/utils/dice_notation.ts
// C-234 Combat Enhancement: Dice & Initiative — parsing & sorting utilities
//
// Pure functions — no ViewModel, no Svelte runes, no side effects.

import type { DiceNotation, InitiativeEntry } from '../types/combat_enhancements.ts';

// ---------------------------------------------------------------------------
// Dice Notation Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a dice notation string into its components.
 *
 * Accepts standard D&D formats: "d20", "1d20", "2d6", "3d8", "1d100".
 * Returns `undefined` for unrecognized formats.
 *
 * @example
 * parseDiceNotation("2d6")    // → { count: 2, sides: 6, label: "2d6" }
 * parseDiceNotation("d20")    // → { count: 1, sides: 20, label: "d20" }
 * parseDiceNotation("foo")    // → undefined
 */
export const parseDiceNotation = (input: string): DiceNotation | undefined => {
  const trimmed = input.trim().toLowerCase();

  // Match optional count + 'd' + sides, e.g. "2d6", "d20", "1d100"
  const match = trimmed.match(/^(\d+)?d(\d+)$/);
  if (!match) {
    return undefined;
  }

  const count = match[1] ? Number.parseInt(match[1], 10) : 1;
  const sides = Number.parseInt(match[2], 10);

  if (count < 1 || sides < 1) {
    return undefined;
  }

  const label = count === 1 ? `d${sides}` : `${count}d${sides}`;

  return { count, sides, label } as const;
};

// ---------------------------------------------------------------------------
// Initiative Sorting
// ---------------------------------------------------------------------------

/**
 * Sorts an array of InitiativeEntry by initiative value (descending),
 * with defeated entries moved to the bottom.
 *
 * Creates a new array — does NOT mutate the input.
 *
 * @param entries - The initiative entries to sort.
 * @returns A new sorted array.
 */
export const sortInitiative = (entries: readonly InitiativeEntry[]): InitiativeEntry[] => {
  return [...entries].sort((a, b) => {
    // Defeated entries always sort last
    if (a.isDefeated !== b.isDefeated) {
      return a.isDefeated ? 1 : -1;
    }
    // Higher initiative goes first
    return b.initiative - a.initiative;
  });
};

// ---------------------------------------------------------------------------
// Dice/Damage Extraction from Log Text
// ---------------------------------------------------------------------------

/**
 * Regex patterns for extracting dice, damage, and target info from combat log
 * text emitted by the ECS engine.
 *
 * These are tested in combat_log_enrichment.test.ts.
 */
const DICE_ROLL_PATTERN = /(?:Player|Enemy|rolls?)\s*(?:rolls?)?\s*(\d+)(?:\s*\([^)]*\))?/i;
/** Match mock dice format like "🎲 d20: 15" */
const MOCK_DICE_PATTERN = /[🎲]\s*d\d+:\s*(\d+)/iu;
const DAMAGE_PATTERN = /(\d+)\s+(?:\w+\s+)?(?:damage|dmg)/i;
const DAMAGE_TYPE_PATTERN =
  /(slashing|piercing|bludgeoning|fire|cold|lightning|acid|poison|necrotic|radiant|psychic|force|thunder)/i;
const TARGET_PATTERN =
  /(?:hits?|attacks?|strikes?)\s*((?:the\s+)?[^,!.]+?)(?:\s+(?:for|deals|takes)|,|\.|!|$)/i;
const CRITICAL_PATTERN = /critical|nat\s*20|crit/i;
const FUMBLE_PATTERN = /fumble|nat\s*1/i;
const ADVANTAGE_PATTERN = /advantage/i;
const DISADVANTAGE_PATTERN = /disadvantage/i;

/**
 * Parse a combat log text string and extract dice/damage/target metadata.
 *
 * Returns an object with extracted data, or `undefined` if nothing could be
 * parsed (plain text fallback).
 *
 * @param text - Raw log entry text from the engine.
 * @returns Parsed metadata, or undefined for unrecognized text.
 */
export const parseDiceFromLog = (
  text: string,
):
  | {
      readonly diceValue?: number;
      readonly advantage?: boolean;
      readonly disadvantage?: boolean;
      readonly isCritical?: boolean;
      readonly isFumble?: boolean;
    }
  | undefined => {
  // Try standard dice roll pattern first (e.g. "Player rolls 18", "Goblin rolls 5")
  let diceMatch = text.match(DICE_ROLL_PATTERN);

  // Fall back to mock dice format (e.g. "🎲 d20: 15")
  if (!diceMatch) {
    diceMatch = text.match(MOCK_DICE_PATTERN);
  }

  if (!diceMatch) {
    return undefined;
  }

  const diceValue = Number.parseInt(diceMatch[1], 10);
  const advantage = ADVANTAGE_PATTERN.test(text) || undefined;
  const disadvantage = DISADVANTAGE_PATTERN.test(text) || undefined;
  const isCritical = CRITICAL_PATTERN.test(text) || undefined;
  // Only flag as fumble when the actual roll is a natural 1
  const isFumble = diceValue === 1 && FUMBLE_PATTERN.test(text) ? true : undefined;

  return { diceValue, advantage, disadvantage, isCritical, isFumble };
};

/**
 * Parse damage-related data from a combat log text string.
 *
 * Extracts damage value, damage type, and target name.
 * Returns partial result — any field may be undefined.
 *
 * @param text - Raw log entry text from the engine.
 * @returns Parsed damage metadata.
 */
export const parseDamageFromLog = (
  text: string,
): {
  readonly damageValue?: number;
  readonly damageType?: string;
  readonly targetName?: string;
} => {
  const damageValueMatch = text.match(DAMAGE_PATTERN);
  const damageValue = damageValueMatch ? Number.parseInt(damageValueMatch[1], 10) : undefined;

  const damageTypeMatch = text.match(DAMAGE_TYPE_PATTERN);
  const damageType = damageTypeMatch?.[1]?.toLowerCase() ?? undefined;

  const targetMatch = text.match(TARGET_PATTERN);
  const targetName = targetMatch?.[1]?.trim() ?? undefined;

  return { damageValue, damageType, targetName };
};

/**
 * Extract the raw dice notation label from a log entry, if present.
 * E.g. "Player rolls 17 (+4 = 21) to hit." → "d20"
 *
 * Detects die sides by the dice range: values 2-4→d4, 3-8→d6, etc.
 * Simple heuristic — not guaranteed accurate.
 *
 * @param diceValue - The numeric dice roll value.
 * @returns A dice label, or undefined if unclear.
 */
export const inferDiceLabelFromValue = (diceValue: number): string | undefined => {
  if (diceValue >= 1 && diceValue <= 4) {
    return 'd4';
  }
  if (diceValue >= 1 && diceValue <= 6) {
    return 'd6';
  }
  if (diceValue >= 1 && diceValue <= 8) {
    return 'd8';
  }
  if (diceValue >= 1 && diceValue <= 10) {
    return 'd10';
  }
  if (diceValue >= 1 && diceValue <= 12) {
    return 'd12';
  }
  if (diceValue >= 1 && diceValue <= 20) {
    return 'd20';
  }
  if (diceValue >= 1 && diceValue <= 100) {
    return 'd100';
  }
  return undefined;
};
