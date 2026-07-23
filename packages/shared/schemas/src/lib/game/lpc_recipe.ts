// packages/shared/schemas/src/lib/game/lpc_recipe.ts
//
// TypeBox schemas for LPC character recipe validation.
// Enforces required spritesheet slots (head, body, torso) at the data
// boundary — recipes crossing the AI ↔ engine boundary must pass these
// checks or the engine will refuse to render them.
//
// Contract: LPC character stability — head fallback + required slot validation

import Type, { type Static } from 'typebox';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Slots that every LPC character recipe MUST include. */
export const REQUIRED_LPC_SLOTS = ['head', 'body', 'torso'] as const;

/** Default head asset ID used as a fallback when the head texture fails to load. */
export const LPC_DEFAULT_HEAD_ASSET_ID = 'head/heads/human_male';

// ---------------------------------------------------------------------------
// Single Layer Recipe
// ---------------------------------------------------------------------------

/** TypeBox schema for a single LPC layer recipe entry. */
export const LpcLayerRecipeSchema = Type.Object({
  /** Body/clothing slot name (e.g. "body", "hair", "torso", "head"). */
  slot: Type.String({ minLength: 1, description: 'Body/clothing slot name' }),
  /** Grayscale asset ID that maps to a spritesheet file on disk. */
  assetId: Type.String({ minLength: 1, description: 'Grayscale asset ID for this layer' }),
  /**
   * 1024-byte palette LUT (256 RGBA pixels).
   *
   * Content-level validation (exact 1024 bytes) happens at the engine
   * boundary via TextureManager.preparePaletteLUT().
   */
  hexPalette: Type.Any(),
});

export type LpcLayerRecipe = Static<typeof LpcLayerRecipeSchema>;

// ---------------------------------------------------------------------------
// Recipe Set Validation
// ---------------------------------------------------------------------------

/**
 * Validates that a recipe array contains all required slots.
 *
 * Returns an array of missing slot names, or an empty array if all
 * required slots are present.
 */
export const validateRequiredSlots = (recipes: readonly LpcLayerRecipe[]): string[] => {
  const presentSlots = new Set(recipes.map((r) => r.slot));
  return REQUIRED_LPC_SLOTS.filter((slot) => !presentSlots.has(slot));
};

/**
 * Returns a human-readable error message for missing required slots.
 */
export const formatMissingSlotsError = (missing: readonly string[]): string =>
  `Missing required LPC spritesheets: ${missing.join(', ')}. Character will not render correctly.`;

// ---------------------------------------------------------------------------
// Recipe Array Schema (validates full recipe set)
// ---------------------------------------------------------------------------

/**
 * Schema for validating a full LPC recipe array.
 *
 * Requires that at least the slots in {@link REQUIRED_LPC_SLOTS} are present.
 * Additional layers (hair, legs, feet, etc.) are optional.
 */
export const LpcRecipeArraySchema = Type.Array(LpcLayerRecipeSchema, {
  minItems: REQUIRED_LPC_SLOTS.length,
  description: `Recipe array must contain at minimum: ${REQUIRED_LPC_SLOTS.join(', ')}`,
});

export type LpcRecipeArray = Static<typeof LpcRecipeArraySchema>;
