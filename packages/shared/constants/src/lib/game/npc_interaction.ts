// packages/shared/constants/src/lib/game/npc_interaction.ts
//
// Stat-to-skill mapping, default DC ranges, and chip intent type labels
// for NPC dialogue interactions.
//
// Contract: C-371 Free-Text-First NPC Interaction — stat modifier map,
//   chip intent icons, default DC range

// ---------------------------------------------------------------------------
// Stat-to-skill modifier mapping
// ---------------------------------------------------------------------------

/** Maps a skill name to its governing stat abbreviation and default modifier. */
export type SkillStatEntry = {
  /** The stat abbreviation (e.g. "CHA", "STR", "DEX"). */
  stat: string;
  /** Default modifier value (demo — full implementation reads from character sheet). */
  defaultModifier: number;
};

/**
 * Skill → stat modifier lookup table.
 *
 * Used by the dialogue overlay to display the relevant stat modifier
 * alongside the declared difficulty class.
 */
export const SKILL_STAT_MAP: Record<string, SkillStatEntry> = {
  persuasion: { stat: 'CHA', defaultModifier: 2 },
  intimidation: { stat: 'STR', defaultModifier: 1 },
  sleight_of_hand: { stat: 'DEX', defaultModifier: 1 },
  stealth: { stat: 'DEX', defaultModifier: 1 },
  insight: { stat: 'WIS', defaultModifier: 1 },
  investigation: { stat: 'INT', defaultModifier: 0 },
  arcana: { stat: 'INT', defaultModifier: 0 },
  religion: { stat: 'INT', defaultModifier: 0 },
  nature: { stat: 'WIS', defaultModifier: 1 },
  medicine: { stat: 'WIS', defaultModifier: 1 },
  survival: { stat: 'WIS', defaultModifier: 1 },
  performance: { stat: 'CHA', defaultModifier: 1 },
  deception: { stat: 'CHA', defaultModifier: 2 },
  acrobatics: { stat: 'DEX', defaultModifier: 1 },
  athletics: { stat: 'STR', defaultModifier: 2 },
};

// ---------------------------------------------------------------------------
// Intent type → display icon mapping
// ---------------------------------------------------------------------------

/** Maps a suggestion chip intent type to its emoji icon for UI rendering. */
export const CHIP_INTENT_ICON_MAP: Record<string, string> = {
  dialogue: '💬',
  skill_check: '🎲',
  combat: '⚔️',
  trade: '💰',
  quest: '📋',
};

/** Human-readable labels for chip intent types. */
export const CHIP_INTENT_LABEL_MAP: Record<string, string> = {
  dialogue: 'Dialogue',
  skill_check: 'Skill Check',
  combat: 'Combat',
  trade: 'Trade',
  quest: 'Quest',
};

// ---------------------------------------------------------------------------
// Default DC range
// ---------------------------------------------------------------------------

/** Minimum difficulty class (schema-enforced). */
export const MIN_DIFFICULTY_CLASS = 5;

/** Maximum difficulty class (schema-enforced). */
export const MAX_DIFFICULTY_CLASS = 20;

/** Default difficulty class when LLM doesn't specify one for a trivial interaction. */
export const DEFAULT_DIFFICULTY_CLASS = 12;
