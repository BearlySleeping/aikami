// packages/frontend/engine/src/rendering/appearance_recipes.ts
//
// One entity's full LPC layer list: the six positional base layers plus any
// extra layers the outfit adds on top.
//
// Extracted from `render_system.ts` — that module is at its reviewed size
// ceiling, and "which layers does this entity draw this frame" is a
// self-contained question with no rendering side effects.

import type { LpcLayerRecipe } from '../components/appearance.ts';
import { getAppearanceExtras, getAppearanceLayers } from '../components/appearance.ts';

/**
 * Resolves the recipes one entity renders.
 *
 * `resolveBase` covers the six POSITIONAL slots from the serialized layer
 * array. Extra-slot layers (hat, shield, weapon, cape, …) are not in that
 * array — they were resolved once at spawn and stored on the entity — so they
 * are appended here rather than re-derived.
 *
 * The composer sorts the combined list by its own depth table, so appending is
 * safe: a shield placed before a body layer in this array still draws behind it.
 *
 * @param eid - The entity ID.
 * @param resolveBase - Resolves the six base slots from their layer IDs.
 * @returns The combined recipe list for this frame.
 */
export const appearanceRecipes = (
  eid: number,
  resolveBase: (layerIds: readonly number[]) => LpcLayerRecipe[],
): LpcLayerRecipe[] => [...resolveBase(getAppearanceLayers(eid)), ...getAppearanceExtras(eid)];
