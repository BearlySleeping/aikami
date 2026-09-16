// packages/frontend/engine/src/combat/combat_encounter_depth.ts
//
// Per-world Combat-08 encounter depth: the authored objective rules, morale
// rules and reaction registry an encounter runs against.
//
// Mirrors `combat_encounter_environment.ts`: these are CONTENT, not ECS
// entities. The world only remembers which encounter is running, so this module
// holds the pinned triple for that world and hands it to the projection
// (`buildV2CombatState`) and back into the kernel state.
//
// Deliberately per-world and cleared with the encounter: a finished fight's
// objectives must never leak into the next one, and a retry must restore the
// AUTHORED rules, not the rules a previous attempt mutated.
//
// Contract: C-532 AC-1, AC-2, AC-3, AC-6

import { emptyMoraleRules, emptyObjectiveRules, emptyReactionRegistry } from '@aikami/schemas';
import type { MoraleRules, ObjectiveRules, ReactionRegistry } from '@aikami/types';
import type { World } from 'bitecs';

/** The pinned Combat-08 authored rules one encounter runs against. */
export type EncounterDepth = {
  /** Authored objective definitions plus the protected-actor constraint. */
  objectiveRules: ObjectiveRules;
  /** Authored morale starting value, break threshold, triggers and responses. */
  moraleRules: MoraleRules;
  /** Authored registered reactions. */
  reactionRegistry: ReactionRegistry;
};

/**
 * The empty depth: no authored objectives, no morale triggers, no reactions.
 *
 * An encounter that authors none keeps its pre-Combat-08 behaviour exactly —
 * the legacy defeat-group outcome and a steady, untriggerable morale.
 */
export const emptyEncounterDepth = (): EncounterDepth => ({
  objectiveRules: emptyObjectiveRules(),
  moraleRules: emptyMoraleRules(),
  reactionRegistry: emptyReactionRegistry(),
});

const depths = new WeakMap<World, EncounterDepth>();

/** Pins the authored depth for this world's encounter. */
export const setEncounterDepth = (world: World, depth: EncounterDepth): void => {
  depths.set(world, depth);
};

/** The pinned depth, or `undefined` when the fight authored none. */
export const getEncounterDepth = (world: World): EncounterDepth | undefined => depths.get(world);

/** Clears the pinned depth (encounter end / retry / test teardown). */
export const clearEncounterDepth = (world: World): void => {
  depths.delete(world);
};
