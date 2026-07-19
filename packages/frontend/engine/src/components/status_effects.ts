// packages/frontend/engine/src/components/status_effects.ts
//
// StatusEffects — SoA component for per-entity active status effect tracking.
// Stores active effect instances, bitmask flags, and per-turn duration counters.
// Contract: C-338 Deepen Turn-Based Combat (AC-2)

import type { ActiveStatusEffect } from '@aikami/types';
import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// SoA component arrays
// ---------------------------------------------------------------------------

/** Maximum active effects per entity (sparse array allocation cap). */
export const MAX_ACTIVE_STATUS_EFFECTS = 8;

/**
 * SoA storage for active status effects per entity.
 *
 * Each array is indexed by entity ID. An entity can have up to
 * {@link MAX_ACTIVE_STATUS_EFFECTS} effects tracked simultaneously.
 * The `count` array tracks the actual number of active effects per entity.
 */
export const StatusEffects = {
  /** Number of active effects currently on this entity. */
  count: [] as number[],
  /** Packed array of effect slots: [eid * MAX + slot]. effectId, sourceEntityId, remainingDuration, appliedOnTurn. */
  effectIds: [] as string[],
  sourceEntityIds: [] as number[],
  remainingDurations: [] as number[],
  appliedOnTurns: [] as number[],
  /** Whether any active effect has skipTurn = true. */
  isStunned: [] as number[],
  /** Whether any active effect has blocksReactions = true. */
  reactionsBlocked: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type StatusEffectsData = {
  count: number;
  effects: ActiveStatusEffect[];
  isStunned: boolean;
  reactionsBlocked: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Computes the starting index into the packed arrays for a given entity.
 */
const _packedIndex = (eid: number, slot: number): number => eid * MAX_ACTIVE_STATUS_EFFECTS + slot;

/**
 * Applies a single status effect to an entity's SoA arrays.
 *
 * @param eid - The entity ID.
 * @param effect - The active status effect to add.
 * @returns The slot index where the effect was inserted, or -1 if full.
 */
export const addStatusEffect = (eid: number, effect: ActiveStatusEffect): number => {
  const count = StatusEffects.count[eid] ?? 0;
  if (count >= MAX_ACTIVE_STATUS_EFFECTS) {
    return -1;
  }

  const slot = count;
  const idx = _packedIndex(eid, slot);
  StatusEffects.effectIds[idx] = effect.effectId;
  StatusEffects.sourceEntityIds[idx] = effect.sourceEntityId;
  StatusEffects.remainingDurations[idx] = effect.remainingDuration;
  StatusEffects.appliedOnTurns[idx] = effect.appliedOnTurn;
  StatusEffects.count[eid] = count + 1;

  return slot;
};

/**
 * Removes a status effect from an entity at the given slot index.
 * Shifts remaining effects to fill the gap.
 */
export const removeStatusEffect = (eid: number, slot: number): void => {
  const count = StatusEffects.count[eid] ?? 0;
  if (slot >= count) {
    return;
  }

  // Shift remaining effects down
  for (let i = slot; i < count - 1; i++) {
    const src = _packedIndex(eid, i + 1);
    const dst = _packedIndex(eid, i);
    StatusEffects.effectIds[dst] = StatusEffects.effectIds[src];
    StatusEffects.sourceEntityIds[dst] = StatusEffects.sourceEntityIds[src];
    StatusEffects.remainingDurations[dst] = StatusEffects.remainingDurations[src];
    StatusEffects.appliedOnTurns[dst] = StatusEffects.appliedOnTurns[src];
  }

  // Clear the last slot
  const last = _packedIndex(eid, count - 1);
  delete StatusEffects.effectIds[last];
  delete StatusEffects.sourceEntityIds[last];
  delete StatusEffects.remainingDurations[last];
  delete StatusEffects.appliedOnTurns[last];
  StatusEffects.count[eid] = count - 1;
};

/**
 * Clears all status effects for an entity.
 */
export const clearStatusEffects = (eid: number): void => {
  const count = StatusEffects.count[eid] ?? 0;
  for (let s = 0; s < count; s++) {
    const idx = _packedIndex(eid, s);
    delete StatusEffects.effectIds[idx];
    delete StatusEffects.sourceEntityIds[idx];
    delete StatusEffects.remainingDurations[idx];
    delete StatusEffects.appliedOnTurns[idx];
  }
  StatusEffects.count[eid] = 0;
  StatusEffects.isStunned[eid] = 0;
  StatusEffects.reactionsBlocked[eid] = 0;
};

/**
 * Gets all active status effects for an entity as a plain array.
 */
export const getActiveEffects = (eid: number): ActiveStatusEffect[] => {
  const count = StatusEffects.count[eid] ?? 0;
  const effects: ActiveStatusEffect[] = [];
  for (let s = 0; s < count; s++) {
    const idx = _packedIndex(eid, s);
    const effectId = StatusEffects.effectIds[idx];
    if (effectId !== undefined) {
      effects.push({
        effectId,
        sourceEntityId: StatusEffects.sourceEntityIds[idx] ?? 0,
        remainingDuration: StatusEffects.remainingDurations[idx] ?? 0,
        appliedOnTurn: StatusEffects.appliedOnTurns[idx] ?? 0,
      });
    }
  }
  return effects;
};

/**
 * Recalculates the isStunned and reactionsBlocked flags from active effects.
 * Call after any mutation to the effects arrays.
 */
export const recomputeStatusFlags = (
  eid: number,
  effectRegistry: Record<string, { modifier: { skipTurn?: boolean; blocksReactions?: boolean } }>,
): void => {
  let stunned = false;
  let blocked = false;
  const count = StatusEffects.count[eid] ?? 0;
  for (let s = 0; s < count; s++) {
    const idx = _packedIndex(eid, s);
    const effectId = StatusEffects.effectIds[idx];
    if (effectId !== undefined) {
      const def = effectRegistry[effectId];
      if (def) {
        if (def.modifier.skipTurn) {
          stunned = true;
        }
        if (def.modifier.blocksReactions) {
          blocked = true;
        }
      }
    }
  }
  StatusEffects.isStunned[eid] = stunned ? 1 : 0;
  StatusEffects.reactionsBlocked[eid] = blocked ? 1 : 0;
};

// ---------------------------------------------------------------------------
// Observer registration
// ---------------------------------------------------------------------------

/**
 * Registers onSet/onGet observers for the StatusEffects component.
 */
export const registerStatusEffectsObservers = (world: World): void => {
  observe(world, onSet(StatusEffects), (eid: number, params: StatusEffectsData) => {
    clearStatusEffects(eid);
    for (const effect of params.effects) {
      addStatusEffect(eid, effect);
    }
    StatusEffects.isStunned[eid] = params.isStunned ? 1 : 0;
    StatusEffects.reactionsBlocked[eid] = params.reactionsBlocked ? 1 : 0;
  });

  observe(
    world,
    onGet(StatusEffects),
    (eid: number): StatusEffectsData => ({
      count: StatusEffects.count[eid] ?? 0,
      effects: getActiveEffects(eid),
      isStunned: (StatusEffects.isStunned[eid] ?? 0) === 1,
      reactionsBlocked: (StatusEffects.reactionsBlocked[eid] ?? 0) === 1,
    }),
  );
};
