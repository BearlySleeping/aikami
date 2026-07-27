// packages/frontend/engine/src/entities/create_sandbox_avatar.ts
//
// Sandbox avatar factory — initializes a full 6-layer LPC Appearance
// stack for development sandbox entities. Uses engine variant indices
// (1-indexed within each slot's catalog) matching the production
// recipeResolver.
//
// Contract: C-198 Dev Sandbox Polish & Zoning

import type { World } from 'bitecs';
import { addComponent } from 'bitecs';
import { Appearance, setAppearanceLayers } from '../components/appearance.ts';

// ---------------------------------------------------------------------------
// Engine variant indices (1-indexed within each slot's catalog)
//
// Engine slot order: body, hair, torso, legs, feet, head.
// These match the indices used by create_player and entity_spawner.
// ---------------------------------------------------------------------------

/** Default player: bodies_male(3), bangs(3), chainmail(23), pants(22), boots(7), human_male(95). */
export const SANDBOX_PLAYER_LAYERS: readonly number[] = [3, 3, 23, 22, 7, 95];

/** Default NPC: bodies_female(2), bangs(3), robe(65), pants_female(21), thin_shoes(20), female_elderly(97). */
export const SANDBOX_NPC_LAYERS: readonly number[] = [2, 3, 65, 21, 20, 97];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a default sandbox LPC avatar on the given entity.
 *
 * Populates all 6 {@link Appearance} layers with engine variant indices
 * so the entity renders a complete, clothed character immediately.
 *
 * @param world - The bitECS world.
 * @param eid - The entity ID to attach the avatar to.
 */
const createDefaultSandboxAvatar = (world: World, eid: number): void => {
  addComponent(world, eid, Appearance);
  setAppearanceLayers(world, eid, SANDBOX_PLAYER_LAYERS);
};

export { createDefaultSandboxAvatar };
