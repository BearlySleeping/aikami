// packages/shared/constants/src/lib/game/status_effects.ts
//
// Default status effect definitions — 7 core combat conditions.
// These serve as the curated registry used by combat systems.
// Contract: C-338 Deepen Turn-Based Combat

import type { StatusEffectDefinition } from '@aikami/types';

// ---------------------------------------------------------------------------
// Default registry — 7 core status effects
// ---------------------------------------------------------------------------

/**
 * Poisoned: deals 2 poison damage per turn, -2 attack penalty.
 * Duration: 3 turns.
 */
export const STATUS_POISONED: StatusEffectDefinition = {
  id: 'poisoned',
  name: 'Poisoned',
  description: 'Takes 2 poison damage at the start of each turn. -2 penalty to attack rolls.',
  defaultDuration: 3,
  modifier: {
    attackModifier: -2,
    damagePerTick: 2,
    tickDamageType: 'poison',
  },
  tag: 'harmful',
} as const;

/**
 * Stunned: skips the entity's turn entirely, blocks reactions.
 * Duration: 1 turn.
 */
export const STATUS_STUNNED: StatusEffectDefinition = {
  id: 'stunned',
  name: 'Stunned',
  description: 'Cannot take actions, bonus actions, or reactions this turn.',
  defaultDuration: 1,
  modifier: {
    skipTurn: true,
    blocksReactions: true,
  },
  tag: 'harmful',
} as const;

/**
 * Blessed: +2 accuracy bonus to attack rolls.
 * Duration: 3 turns.
 */
export const STATUS_BLESSED: StatusEffectDefinition = {
  id: 'blessed',
  name: 'Blessed',
  description: '+2 bonus to accuracy on attack rolls.',
  defaultDuration: 3,
  modifier: {
    accuracyModifier: 2,
  },
  tag: 'beneficial',
} as const;

/**
 * Burning: deals 3 fire damage per turn.
 * Duration: 2 turns.
 */
export const STATUS_BURNING: StatusEffectDefinition = {
  id: 'burning',
  name: 'Burning',
  description: 'Takes 3 fire damage at the start of each turn.',
  defaultDuration: 2,
  modifier: {
    damagePerTick: 3,
    tickDamageType: 'fire',
  },
  tag: 'harmful',
} as const;

/**
 * Weakened: deals half damage (0.5x multiplier).
 * Duration: 2 turns.
 */
export const STATUS_WEAKENED: StatusEffectDefinition = {
  id: 'weakened',
  name: 'Weakened',
  description: 'Damage dealt is halved.',
  defaultDuration: 2,
  modifier: {
    damageDealtMultiplier: 0.5,
  },
  tag: 'harmful',
} as const;

/**
 * Shielded: +3 defense bonus against incoming attacks.
 * Duration: 3 turns.
 */
export const STATUS_SHIELDED: StatusEffectDefinition = {
  id: 'shielded',
  name: 'Shielded',
  description: '+3 bonus to defense against incoming attacks.',
  defaultDuration: 3,
  modifier: {
    defenseModifier: 3,
  },
  tag: 'beneficial',
} as const;

/**
 * Regenerating: heals 2 HP per turn.
 * Duration: 3 turns.
 */
export const STATUS_REGENERATING: StatusEffectDefinition = {
  id: 'regenerating',
  name: 'Regenerating',
  description: 'Regains 2 HP at the start of each turn.',
  defaultDuration: 3,
  modifier: {
    healPerTick: 2,
  },
  tag: 'beneficial',
} as const;

// ---------------------------------------------------------------------------
// Registry — keyed by effect ID for O(1) lookup
// ---------------------------------------------------------------------------

/**
 * All default status effect definitions, keyed by effect ID.
 * Use for O(1) lookup during combat status application and tick processing.
 */
export const STATUS_EFFECT_REGISTRY: Record<string, StatusEffectDefinition> = {
  [STATUS_POISONED.id]: STATUS_POISONED,
  [STATUS_STUNNED.id]: STATUS_STUNNED,
  [STATUS_BLESSED.id]: STATUS_BLESSED,
  [STATUS_BURNING.id]: STATUS_BURNING,
  [STATUS_WEAKENED.id]: STATUS_WEAKENED,
  [STATUS_SHIELDED.id]: STATUS_SHIELDED,
  [STATUS_REGENERATING.id]: STATUS_REGENERATING,
} as const;
