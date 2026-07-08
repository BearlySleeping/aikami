// apps/frontend/client/src/lib/views/combat/types/combat_enhancements.ts
// C-234 Combat Enhancement: Dice & Initiative — type definitions

// ---------------------------------------------------------------------------
// Dice Notation
// ---------------------------------------------------------------------------

/**
 * Parsed dice notation — e.g. { count: 2, sides: 6 } from "2d6".
 */
export type DiceNotation = {
  readonly count: number;
  readonly sides: number;
  /** Human-readable label (e.g. "2d6"). */
  readonly label: string;
};

/**
 * A single queued dice roll awaiting resolution.
 */
export type QueuedRoll = {
  /** Unique ID for Svelte {#each} keying. */
  readonly id: string;
  /** The dice notation to roll (e.g. "1d20", "2d6"). */
  readonly notation: DiceNotation;
  /** Optional label shown in the badge (e.g. "Attack", "Perception"). */
  readonly label: string;
  /** When this roll was queued. */
  readonly timestamp: number;
  /** Optional roll result — populated after resolution. */
  readonly result?: number;
};

// ---------------------------------------------------------------------------
// Initiative
// ---------------------------------------------------------------------------

/**
 * A single combatant in the initiative order.
 */
export type InitiativeEntry = {
  /** Entity ID (matches bitECS entity). */
  readonly entityId: number;
  /** Display name (e.g. "Player", "Goblin"). */
  readonly name: string;
  /** Initiative roll value (higher = acts first). */
  readonly initiative: number;
  /** Current hit points. */
  readonly currentHp: number;
  /** Maximum hit points. */
  readonly maxHp: number;
  /** Whether this entry is the entity whose turn it currently is. */
  readonly isCurrentTurn: boolean;
  /** Whether this entity has been defeated (HP ≤ 0). */
  readonly isDefeated: boolean;
};

// ---------------------------------------------------------------------------
// Turn State
// ---------------------------------------------------------------------------

/**
 * Track which action types the current entity has consumed this turn.
 * Standard D&D: one Action, one Bonus Action, one Reaction per turn.
 */
export type ActionEconomy = {
  readonly action: boolean;
  readonly bonusAction: boolean;
  readonly reaction: boolean;
};

/**
 * Current turn state — which entity is acting, action economy used.
 */
export type TurnState = {
  /** Entity ID of the current turn holder. */
  readonly currentEntityId: number;
  /** Name of the current turn holder. */
  readonly currentEntityName: string;
  /** Whether it's the player's turn. */
  readonly isPlayerTurn: boolean;
  /** Action economy dots consumed this turn. */
  readonly actionEconomy: ActionEconomy;
  /** Turn number (monotonically increasing). */
  readonly turnNumber: number;
};

// ---------------------------------------------------------------------------
// Enriched Combat Log Entry
// ---------------------------------------------------------------------------

/**
 * Enriched version of CombatLogEntry with parsed dice/damage metadata.
 * Used by EnrichedLogEntry component for rich rendering.
 */
export type EnrichedCombatLogEntry = {
  /** Raw log entry text (from engine or mock). */
  readonly rawText: string;
  /** Parsed dice roll value, if present. */
  readonly diceValue?: number;
  /** Whether the roll had advantage. */
  readonly advantage?: boolean;
  /** Whether the roll had disadvantage. */
  readonly disadvantage?: boolean;
  /** Named damage type (e.g. "slashing", "fire", "piercing"). */
  readonly damageType?: string;
  /** Damage value, if applicable. */
  readonly damageValue?: number;
  /** Target of the action, if applicable. */
  readonly targetName?: string;
  /** Whether the action was a critical hit (natural 20). */
  readonly isCritical?: boolean;
  /** Whether the action was a critical miss (natural 1). */
  readonly isFumble?: boolean;
  /** Whether this entry has unparesable text (fallback). */
  readonly isPlainText: boolean;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Preset dice options for the quick-dice menu.
 * Each entry is a common D&D-style dice roll.
 */
export const DICE_PRESETS = [
  { notation: { count: 1, sides: 4, label: '1d4' }, label: 'd4' },
  { notation: { count: 1, sides: 6, label: '1d6' }, label: 'd6' },
  { notation: { count: 1, sides: 8, label: '1d8' }, label: 'd8' },
  { notation: { count: 1, sides: 10, label: '1d10' }, label: 'd10' },
  { notation: { count: 1, sides: 12, label: '1d12' }, label: 'd12' },
  { notation: { count: 1, sides: 20, label: '1d20' }, label: 'd20' },
  { notation: { count: 1, sides: 100, label: '1d100' }, label: 'd100' },
  { notation: { count: 2, sides: 6, label: '2d6' }, label: '2d6' },
] as const satisfies readonly {
  readonly notation: DiceNotation;
  readonly label: string;
}[];

/**
 * Semantic color tokens for each damage type.
 * Maps damage type name → DaisyUI color utility class.
 */
export const DAMAGE_TYPE_COLORS = {
  slashing: 'text-warning',
  piercing: 'text-accent',
  bludgeoning: 'text-neutral',
  fire: 'text-error',
  cold: 'text-info',
  lightning: 'text-warning',
  acid: 'text-success',
  poison: 'text-success',
  necrotic: 'text-secondary',
  radiant: 'text-primary',
  psychic: 'text-accent',
  force: 'text-primary',
  thunder: 'text-info',
} as const;

/**
 * Valid damage type keys for the DAMAGE_TYPE_COLORS map.
 */
export type DamageTypeKey = keyof typeof DAMAGE_TYPE_COLORS;

/**
 * Look up a damage type color class, returning undefined for unrecognized types.
 *
 * Type-safe accessor for DAMAGE_TYPE_COLORS — handles runtime string keys
 * that may not match the known literal union.
 *
 * @param damageType - The damage type name (e.g. "fire", "slashing").
 * @returns The Tailwind color class, or undefined if not found.
 */
export const getDamageTypeColor = (damageType: string): string | undefined => {
  return DAMAGE_TYPE_COLORS[damageType as DamageTypeKey];
};
