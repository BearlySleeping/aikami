// packages/frontend/engine/src/combat/combat_check_modifiers.ts
//
// Per-world projected character-sheet check modifiers for a running encounter
// (C-531 AC-2, AC-4).
//
// A registered environmental check names a `modifierSource` — a projected
// character-sheet field (an ability key such as `strength` or a skill id such
// as `athletics`). The character sheet lives on the MAIN thread, so the
// resolved modifiers travel with the encounter roster and are pinned here per
// world, exactly like the pinned environmental pair. Both projection builders
// (`buildV2CombatState`, `buildCombatProjectionState`) read this store, so the
// inspector's preview and the kernel's commit always answer with the same
// modifier — and a source the sheet does not project is refused
// `checkModifierUnavailable` instead of silently rolled unmodified.
//
// Deliberately per-world and cleared with the encounter: a previous fight's
// modifiers must never leak into the next one.
//
// Contract: C-531 AC-2, AC-4

import type { World } from 'bitecs';

/** Check modifiers for one encounter, keyed by combatant id then source. */
export type CombatCheckModifiers = Record<string, Record<string, number>>;

const modifiersByWorld = new WeakMap<World, CombatCheckModifiers>();

/** Pins the projected check modifiers for this world's encounter. */
export const setCombatCheckModifiers = (world: World, modifiers: CombatCheckModifiers): void => {
  modifiersByWorld.set(world, modifiers);
};

/** The pinned modifiers, or `undefined` when the fight carries none. */
export const getCombatCheckModifiers = (world: World): CombatCheckModifiers | undefined =>
  modifiersByWorld.get(world);

/** Clears the pinned modifiers (encounter end / retry / test teardown). */
export const clearCombatCheckModifiers = (world: World): void => {
  modifiersByWorld.delete(world);
};
