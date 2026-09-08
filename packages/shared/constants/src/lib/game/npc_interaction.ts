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
  sleightOfHand: { stat: 'DEX', defaultModifier: 1 },
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
// Skill-check stakes — bounded consequence copy shown before the roll commits
// ---------------------------------------------------------------------------

/**
 * Bounded success/failure consequence strings for a skill check (C-487).
 * Shown in the declared-DC overlay before the player commits the roll. These
 * are short, check-appropriate consequences — never unbounded model prose.
 */
export type SkillCheckStakes = {
  /** Short, bounded outcome description on success. */
  success: string;
  /** What failing costs, shown before the roll. */
  failure: string;
};

/** Per-skill stakes keyed by the camelCase `SKILL_STAT_MAP` key (C-487). */
export const SKILL_CHECK_STAKES: Record<string, SkillCheckStakes> = {
  persuasion: {
    success: 'The NPC is swayed by your argument.',
    failure: "The NPC's trust in you wavers.",
  },
  intimidation: {
    success: 'The NPC backs down and complies.',
    failure: 'The NPC refuses and grows hostile.',
  },
  sleightOfHand: {
    success: 'You pull it off unnoticed.',
    failure: 'The NPC catches you in the act — suspicion rises.',
  },
  stealth: {
    success: 'You slip past unseen.',
    failure: 'You are spotted and the alarm is raised.',
  },
  insight: {
    success: 'You read the NPC\u2019s true intent.',
    failure: 'You misread the situation.',
  },
  investigation: {
    success: 'You piece together the clues.',
    failure: 'The trail goes cold.',
  },
  arcana: {
    success: 'You recall the arcane detail.',
    failure: 'The magic eludes your understanding.',
  },
  religion: {
    success: 'You recall the rite and its meaning.',
    failure: 'The symbol means nothing to you.',
  },
  nature: {
    success: 'You read the land and its creatures.',
    failure: 'The wilderness keeps its secrets.',
  },
  medicine: {
    success: 'You steady the patient.',
    failure: 'Your ministrations fall short.',
  },
  survival: {
    success: 'You find the safe path forward.',
    failure: 'The wilds turn against you.',
  },
  performance: {
    success: 'Your performance wins the crowd.',
    failure: 'The audience is unmoved.',
  },
  deception: {
    success: 'The NPC accepts the deception at face value.',
    failure: 'The NPC sees through the lie — suspicion rises.',
  },
  acrobatics: {
    success: 'You land it cleanly.',
    failure: 'You slip and draw unwanted attention.',
  },
  athletics: {
    success: 'You power through it.',
    failure: 'You strain and come up short.',
  },
};

/** Fallback stakes for a check type that does not map to a known skill (C-487). */
export const DEFAULT_SKILL_CHECK_STAKES: SkillCheckStakes = {
  success: 'The attempt succeeds.',
  failure: 'The attempt fails with consequences.',
};

// ---------------------------------------------------------------------------
// Intent type → display icon mapping
// ---------------------------------------------------------------------------

/** Maps a suggestion chip intent type to its emoji icon for UI rendering. */
export const CHIP_INTENT_ICON_MAP: Record<string, string> = {
  dialogue: '💬',
  skillCheck: '🎲',
  combat: '⚔️',
  trade: '💰',
  quest: '📋',
};

/** Human-readable labels for chip intent types. */
export const CHIP_INTENT_LABEL_MAP: Record<string, string> = {
  dialogue: 'Dialogue',
  skillCheck: 'Skill Check',
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
