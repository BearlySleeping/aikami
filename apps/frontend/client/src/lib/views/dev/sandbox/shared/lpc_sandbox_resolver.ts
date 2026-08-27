// apps/frontend/client/src/lib/views/dev/sandbox/shared/lpc_sandbox_resolver.ts
//
// Shared catalog-based LPC recipe resolver for all sandbox ViewModels.
// Delegates to the same unified resolver the production boot pipeline uses
// (game_boot_service.svelte.ts), against the real runtime-loaded LPC catalog
// (getLpcCatalog) — never a static generated snapshot.

import type { LpcLayerRecipe } from '@aikami/frontend/engine';
import {
  DEFAULT_LPC_SLOT_FALLBACKS,
  projectLpcCatalog,
  resolveLpcAppearance,
} from '@aikami/frontend/engine/content';
import { getLpcCatalog } from '$lib/data/lpc_asset_catalog';

/**
 * Resolves engine variant indices to LPC layer recipes using the real,
 * runtime-loaded LPC catalog. Matches the production recipeResolver in
 * game_boot_service (both go through the unified resolveLpcAppearance).
 *
 * Engine slot order: body, hair, torso, legs, feet, head.
 * Each value is a 1-indexed variant number within that slot's catalog.
 *
 * @param layerIds - 6-element array of 1-indexed variant numbers.
 * @returns Array of LpcLayerRecipe for rendering.
 */
export const sandboxRecipeResolver = (layerIds: readonly number[]): LpcLayerRecipe[] => {
  const catalog = projectLpcCatalog(getLpcCatalog().slots);
  return [
    ...resolveLpcAppearance({ layerIds, catalog, fallbacks: DEFAULT_LPC_SLOT_FALLBACKS }).recipes,
  ];
};
