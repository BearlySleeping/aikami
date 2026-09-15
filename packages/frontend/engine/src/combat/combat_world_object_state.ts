// packages/frontend/engine/src/combat/combat_world_object_state.ts
//
// World-object state that OUTLIVES a combat encounter (C-531 AC-7).
//
// Authored battlefield objects are content, not ECS entities, so the ECS
// snapshot cannot carry them. What must survive the fight — and a save/reload —
// is which authored objects are broken, moved, ignited or have lost their
// cover, keyed by their STABLE authored id.
//
// Lifecycle:
//   encounter start  ← the persisted state is overlaid onto the freshly
//                      authored initial state (identity is preserved)
//   encounter end    → the committed state is captured here
//   save             → the block travels in the save envelope
//   reload           → the block is restored into this store
//
// Combat-scoped surfaces do NOT persist: the contract says a temporary surface
// expires at encounter exit unless its authored definition declares world
// persistence, and v1 declares none.
//
// Contract: C-531 AC-7

import type { CombatEnvironmentBundle, EnvironmentalState } from '@aikami/types';
import type { World } from 'bitecs';
import type { EncounterEnvironment } from './combat_encounter_environment.ts';

/** The persisted world-object block: the definitions plus the object state. */
export type WorldObjectState = {
  /** The definition bundle the objects were authored against. */
  bundle: CombatEnvironmentBundle;
  /** The committed object state, keyed by stable authored object id. */
  state: EnvironmentalState;
};

const persisted = new WeakMap<World, WorldObjectState>();

/** The persisted block for this world, or `undefined` when none was captured. */
export const getWorldObjectState = (world: World): WorldObjectState | undefined =>
  persisted.get(world);

/** Restores a persisted block (save load). */
export const setWorldObjectState = (world: World, value: WorldObjectState): void => {
  persisted.set(world, value);
};

/** Forgets this world's persisted block (campaign teardown / test isolation). */
export const clearWorldObjectState = (world: World): void => {
  persisted.delete(world);
};

/**
 * Captures the committed environmental state at encounter exit.
 *
 * Objects persist with their identity, position, durability, state, cover and
 * ignited flag. Surfaces and hazard tick stamps do NOT — a hazard that has
 * expired or been extinguished in a fight must not still be burning when the
 * player walks back in.
 *
 * Returns `undefined` when the encounter authored no objects, so a fight with
 * no environmental mechanics never writes an empty block over a real one.
 */
export const captureWorldObjectState = (
  environment: EncounterEnvironment | undefined,
): WorldObjectState | undefined => {
  if (environment === undefined || Object.keys(environment.state.objects).length === 0) {
    return undefined;
  }
  return {
    bundle: environment.bundle,
    state: {
      objects: environment.state.objects,
      surfaces: [],
      hazardTickStamps: [],
    },
  };
};

/** Records the committed state for a world (encounter exit). */
export const persistWorldObjectState = (
  world: World,
  environment: EncounterEnvironment | undefined,
): void => {
  const captured = captureWorldObjectState(environment);
  if (captured === undefined) {
    return;
  }
  persisted.set(world, captured);
};

/**
 * Overlays persisted object state onto a freshly authored initial state.
 *
 * Rules, in order:
 *   - an object the persisted block knows AND the encounter still authors keeps
 *     its committed state (same `objectId` — identity is preserved);
 *   - an object the encounter no longer authors is dropped, so a content update
 *     that removes a prop cannot resurrect it;
 *   - an object the encounter newly authors starts intact.
 *
 * The definitions come from the CURRENT bundle, so a content update takes
 * effect; only the object INSTANCES carry over.
 */
export const applyWorldObjectState = (options: {
  persisted: WorldObjectState;
  initial: EncounterEnvironment;
}): EncounterEnvironment => {
  const { persisted: saved, initial } = options;
  const objects: EnvironmentalState['objects'] = {};
  for (const [objectId, authored] of Object.entries(initial.state.objects)) {
    const carried = saved.state.objects[objectId];
    objects[objectId] =
      carried === undefined
        ? authored
        : {
            // Identity and affordances come from the CURRENT authored object;
            // everything a fight can change comes from the save.
            ...authored,
            position: carried.position,
            durability: carried.durability,
            state: carried.state,
            ignited: carried.ignited,
            cover: carried.cover,
            attachedToObjectId: carried.attachedToObjectId,
          };
  }
  return {
    bundle: initial.bundle,
    state: { objects, surfaces: initial.state.surfaces, hazardTickStamps: [] },
  };
};
