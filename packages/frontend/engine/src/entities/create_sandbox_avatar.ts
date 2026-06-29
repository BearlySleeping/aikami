// packages/frontend/engine/src/entities/create_sandbox_avatar.ts
//
// Sandbox avatar factory — initializes a full 6-layer LPC Appearance
// stack for development sandbox entities. Prevents unrendered frames
// by populating every layer with a default asset variant.
//
// Contract: C-198 Dev Sandbox Polish & Zoning

import type { World } from 'bitecs';
import { addComponent } from 'bitecs';
import { Appearance, setAppearanceLayers } from '../components/appearance.ts';

// ---------------------------------------------------------------------------
// Sandbox recipe layer IDs — single source of truth
//
// These IDs are mapped to LpcLayerRecipe objects by the sandbox
// ViewModel's recipeResolver. Each ViewModel must include all 6
// entries in its SANDBOX_RECIPES map.
// ---------------------------------------------------------------------------

/** Layer 0: Base body sprite (e.g., bodies_male, bodies_female). */
export const SANDBOX_LAYER_BODY = 1;

/** Layer 1: Hair style + expression anchor (e.g., plain_adult, long_adult). */
export const SANDBOX_LAYER_HAIR = 2;

/** Layer 2: Torso clothing / armor (e.g., chest chainmail_male, clothes). */
export const SANDBOX_LAYER_TORSO = 5;

/** Layer 3: Legs / pants (e.g., pants_male, pants_female). */
export const SANDBOX_LAYER_LEGS = 3;

/** Layer 4: Feet / shoes (e.g., shoes/boots_male, sandals). */
export const SANDBOX_LAYER_FEET = 6;

/** Layer 5: Head (e.g., heads/human_male, heads/human_female). */
export const SANDBOX_LAYER_HEAD = 4;

/** Beard overlay — rendered as layer 2 when configured. */
export const SANDBOX_LAYER_BEARD = 7;

/** Full player sandbox appearance recipe (6 layers). */
export const SANDBOX_PLAYER_LAYERS: readonly number[] = [
  SANDBOX_LAYER_BODY, // body
  SANDBOX_LAYER_HAIR, // hair
  SANDBOX_LAYER_TORSO, // torso / armor
  SANDBOX_LAYER_LEGS, // legs
  SANDBOX_LAYER_FEET, // feet
  SANDBOX_LAYER_HEAD, // head
];

/** Full NPC sandbox appearance recipe (6 layers). */
export const SANDBOX_NPC_LAYERS: readonly number[] = [
  SANDBOX_LAYER_BODY + 9, // body (10)
  SANDBOX_LAYER_HAIR + 9, // hair (11)
  SANDBOX_LAYER_TORSO + 9, // torso (14)
  SANDBOX_LAYER_LEGS + 9, // legs (12)
  SANDBOX_LAYER_FEET + 9, // feet (15)
  SANDBOX_LAYER_HEAD + 9, // head (13)
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a default sandbox LPC avatar on the given entity.
 *
 * Populates all 6 {@link Appearance} layers with normalized asset
 * variant indices so the entity renders a complete, clothed character
 * immediately — no transparency gaps or missing-layer artifacts.
 *
 * Equivalent to calling:
 * ```
 * addComponent(world, eid, Appearance);
 * setAppearanceLayers(world, eid, SANDBOX_PLAYER_LAYERS);
 * ```
 *
 * @param world - The bitECS world.
 * @param eid - The entity ID to attach the avatar to.
 */
const createDefaultSandboxAvatar = (world: World, eid: number): void => {
  addComponent(world, eid, Appearance);
  setAppearanceLayers(world, eid, SANDBOX_PLAYER_LAYERS);
};

export { createDefaultSandboxAvatar };
