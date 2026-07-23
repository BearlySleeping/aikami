// packages/shared/types/src/lib/game/lpc_recipe.ts
//
// TypeScript types derived from LPC recipe TypeBox schemas.
// Single source of truth: packages/shared/schemas/src/lib/game/lpc_recipe.ts

import type { LpcLayerRecipeSchema, LpcRecipeArraySchema } from '@aikami/schemas';
import type { Static } from 'typebox';

/** A single LPC layer recipe entry. */
export type LpcLayerRecipeValidated = Static<typeof LpcLayerRecipeSchema>;

/** A validated array of LPC layer recipes. */
export type LpcRecipeArrayValidated = Static<typeof LpcRecipeArraySchema>;

// Re-export constants for convenience
export { LPC_DEFAULT_HEAD_ASSET_ID, REQUIRED_LPC_SLOTS } from '@aikami/schemas';
