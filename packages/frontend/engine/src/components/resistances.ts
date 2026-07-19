// packages/frontend/engine/src/components/resistances.ts
//
// Resistances — SoA component for per-entity damage type resistance profiles.
// Stores a packed Float64Array of resistance factors per damage type.
// Contract: C-338 Deepen Turn-Based Combat (AC-3)

import { DEFAULT_RESISTANCE_PROFILE } from '@aikami/constants';
import type { DamageResistanceProfile, DamageTypeKey } from '@aikami/types';
import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// Damage type → index mapping (fixed order for packed array access)
// ---------------------------------------------------------------------------

/**
 * Ordered array of all damage type keys — used for packed array indexing.
 * The index into this array corresponds to the index in resistanceFactors[].
 */
export const DAMAGE_TYPE_INDEX: DamageTypeKey[] = [
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
];

/**
 * Maps a damage type key to its packed array index. O(1) lookup.
 */
export const DAMAGE_TYPE_INDEX_MAP: Record<DamageTypeKey, number> = {
  slashing: 0,
  piercing: 1,
  bludgeoning: 2,
  fire: 3,
  cold: 4,
  lightning: 5,
  acid: 6,
  poison: 7,
  necrotic: 8,
  radiant: 9,
  psychic: 10,
  force: 11,
  thunder: 12,
};

const NUM_DAMAGE_TYPES = DAMAGE_TYPE_INDEX.length; // 13

// ---------------------------------------------------------------------------
// SoA component arrays
// ---------------------------------------------------------------------------

/**
 * SoA storage for per-entity damage resistance profiles.
 *
 * resistanceFactors is a packed Float64Array where each entity occupies
 * {@link NUM_DAMAGE_TYPES} consecutive elements. Index: eid * 13 + damageTypeIndex.
 */
export const Resistances = {
  /** Packed resistance factors: [entity0_slashing, entity0_piercing, ..., entity13_thunder, ...] */
  resistanceFactors: [] as number[],
  /** Whether a custom profile has been set (false = use default). */
  hasCustomProfile: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type ResistancesData = {
  profile: DamageResistanceProfile;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Gets the resistance factor for a specific damage type on an entity.
 *
 * @param eid - The entity ID.
 * @param damageType - The damage type to look up.
 * @returns The resistance factor (0.0 = immune, 0.5 = resistant, 1.0 = normal, 2.0 = vulnerable).
 */
export const getResistanceFactor = (eid: number, damageType: DamageTypeKey): number => {
  const typeIdx = DAMAGE_TYPE_INDEX_MAP[damageType];
  if (typeIdx === undefined) {
    return 1.0;
  }
  const baseIdx = eid * NUM_DAMAGE_TYPES + typeIdx;
  const factor = Resistances.resistanceFactors[baseIdx];
  return factor !== undefined && factor !== 0 ? factor : 1.0;
};

/**
 * Sets the full resistance profile for an entity.
 *
 * Initializes or overwrites all 13 damage type factors.
 */
export const setResistanceProfile = (eid: number, profile: DamageResistanceProfile): void => {
  const baseIdx = eid * NUM_DAMAGE_TYPES;
  for (let t = 0; t < NUM_DAMAGE_TYPES; t++) {
    const key = DAMAGE_TYPE_INDEX[t];
    if (key) {
      Resistances.resistanceFactors[baseIdx + t] = profile[key] ?? 1.0;
    }
  }
  Resistances.hasCustomProfile[eid] = 1;
};

/**
 * Applies the default resistance profile (all 1.0) to an entity.
 */
export const resetResistanceProfile = (eid: number): void => {
  setResistanceProfile(eid, DEFAULT_RESISTANCE_PROFILE);
  Resistances.hasCustomProfile[eid] = 0;
};

// ---------------------------------------------------------------------------
// Observer registration
// ---------------------------------------------------------------------------

/**
 * Registers onSet/onGet observers for the Resistances component.
 */
export const registerResistancesObservers = (world: World): void => {
  observe(world, onSet(Resistances), (eid: number, params: ResistancesData) => {
    setResistanceProfile(eid, params.profile);
  });

  observe(world, onGet(Resistances), (eid: number): ResistancesData => {
    const profile: DamageResistanceProfile = {} as DamageResistanceProfile;
    const baseIdx = eid * NUM_DAMAGE_TYPES;
    for (let t = 0; t < NUM_DAMAGE_TYPES; t++) {
      const key = DAMAGE_TYPE_INDEX[t];
      if (key) {
        profile[key] = Resistances.resistanceFactors[baseIdx + t] ?? 1.0;
      }
    }
    return { profile };
  });
};
