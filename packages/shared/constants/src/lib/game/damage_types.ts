// packages/shared/constants/src/lib/game/damage_types.ts
//
// Damage type taxonomy — 13 damage types and a default resistance profile
// (1.0 = normal for all types).
// Contract: C-338 Deepen Turn-Based Combat

import type { DamageResistanceProfile, DamageTypeKey } from '@aikami/types';

// ---------------------------------------------------------------------------
// Damage type taxonomy
// ---------------------------------------------------------------------------

/**
 * All valid damage type keys, ordered by category (physical → elemental → exotic).
 */
export const DAMAGE_TYPE_KEYS: DamageTypeKey[] = [
  'slashing',
  'piercing',
  'bludgeoning',
  'fire',
  'cold',
  'lightning',
  'acid',
  'poison',
  'necrotic',
  'radiant',
  'psychic',
  'force',
  'thunder',
] as const;

/**
 * Physical damage types (slashing, piercing, bludgeoning).
 */
export const PHYSICAL_DAMAGE_TYPES: DamageTypeKey[] = ['slashing', 'piercing', 'bludgeoning'];

/**
 * Elemental damage types (fire, cold, lightning, acid, poison).
 */
export const ELEMENTAL_DAMAGE_TYPES: DamageTypeKey[] = [
  'fire',
  'cold',
  'lightning',
  'acid',
  'poison',
];

/**
 * Exotic damage types (necrotic, radiant, psychic, force, thunder).
 */
export const EXOTIC_DAMAGE_TYPES: DamageTypeKey[] = [
  'necrotic',
  'radiant',
  'psychic',
  'force',
  'thunder',
];

// ---------------------------------------------------------------------------
// Default resistance profile
// ---------------------------------------------------------------------------

/**
 * Default resistance profile — all types at 1.0 (normal damage).
 * Used for entities without an explicit resistance profile configured.
 */
export const DEFAULT_RESISTANCE_PROFILE: DamageResistanceProfile = {
  slashing: 1.0,
  piercing: 1.0,
  bludgeoning: 1.0,
  fire: 1.0,
  cold: 1.0,
  lightning: 1.0,
  acid: 1.0,
  poison: 1.0,
  necrotic: 1.0,
  radiant: 1.0,
  psychic: 1.0,
  force: 1.0,
  thunder: 1.0,
} as const;
