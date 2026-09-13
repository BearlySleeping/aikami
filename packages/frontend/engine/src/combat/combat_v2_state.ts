// packages/frontend/engine/src/combat/combat_v2_state.ts
//
// Per-world live v2 kernel state.
//
// The evolving `CombatState` of a running v2 encounter carries what the ECS
// world does not: the RNG streams, the phase and the revision. Carrying it
// forward is what makes the fight progress and what makes a replay reproduce
// it. The store lives in its own module so the resolver, the encounter start
// and the retry path can all reach it without a module cycle.
//
// Contract: C-509 AC-2, C-516 AC-10

import type { CombatState } from '@aikami/types';
import type { World } from 'bitecs';

const liveCombatStates = new WeakMap<World, CombatState>();

/** The live kernel state for this world, or `null` when no v2 fight is running. */
export const getLiveV2CombatState = (world: World): CombatState | null =>
  liveCombatStates.get(world) ?? null;

/** Stores the kernel state a v2 commit resolved to. */
export const setLiveV2CombatState = (world: World, state: CombatState): void => {
  liveCombatStates.set(world, state);
};

/** Forgets this world's kernel state (encounter end / retry / test teardown). */
export const resetLiveV2CombatState = (world: World): void => {
  liveCombatStates.delete(world);
};
