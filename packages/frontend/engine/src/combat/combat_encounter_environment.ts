// packages/frontend/engine/src/combat/combat_encounter_environment.ts
//
// Per-world environmental state for a running Combat-07 encounter.
//
// The authored objects and surfaces of an encounter are NOT ECS entities: they
// are content, pinned into the encounter snapshot and owned by the kernel. The
// ECS world only remembers which encounter is running, so this module holds the
// live `{ state, bundle }` pair for that world and hands it to the projection
// (`buildV2CombatState`) and back to the commit path.
//
// Deliberately per-world and cleared with the encounter: a stale environment
// from a finished fight must never leak into the next one.
//
// Contract: C-531 AC-1, AC-2, AC-7

import type { CombatEnvironmentBundle, EnvironmentalState } from '@aikami/types';
import type { World } from 'bitecs';

/** The pinned environmental pair one encounter runs against. */
export type EncounterEnvironment = {
  /** The initial environmental state, before any command has resolved. */
  state: EnvironmentalState;
  /**
   * The immutable definition bundle this encounter resolves against.
   *
   * Replay reads this bundle — never the latest mutable content pack.
   */
  bundle: CombatEnvironmentBundle;
};

const environments = new WeakMap<World, EncounterEnvironment>();

/** Pins the environmental pair for this world's encounter. */
export const setEncounterEnvironment = (world: World, environment: EncounterEnvironment): void => {
  environments.set(world, environment);
};

/** The pinned pair, or `undefined` when the fight authored none. */
export const getEncounterEnvironment = (world: World): EncounterEnvironment | undefined =>
  environments.get(world);

/** Clears the pinned pair (encounter end / retry / test teardown). */
export const clearEncounterEnvironment = (world: World): void => {
  environments.delete(world);
};
