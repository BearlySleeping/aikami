// packages/frontend/engine/src/rendering/lpc_appearance_resolver.ts
//
// Client pipeline builder — wraps the pure resolver from @aikami/lpc with
// the asset URL resolver and recipe resolver used by the game engine.
//
// The pure resolver functions (resolveLpcAppearance, projectLpcCatalog, etc.)
// now live in @aikami/lpc. Only createLpcPipeline remains here because it
// builds a client-side pipeline that couples to the engine's recipe type.

import {
  resolveLpcAppearance,
  DEFAULT_LPC_SLOT_FALLBACKS,
  LPC_SLOT_ORDER,
  projectLpcCatalog,
  resetLpcFallbackWarnings,
  type LpcSlotCatalog,
  type LpcSlotName,
} from '@aikami/lpc';
import type { LpcLayerRecipe } from '@aikami/lpc';

// Re-export moved symbols for backward compatibility with test imports.
export {
  DEFAULT_LPC_SLOT_FALLBACKS,
  LPC_SLOT_ORDER,
  projectLpcCatalog,
  resetLpcFallbackWarnings,
  resolveLpcAppearance,
};
export type { LpcSlotCatalog, LpcSlotName };

/** Options for {@link createLpcPipeline}. */
export type CreateLpcPipelineOptions = {
  /** The projected engine-slot catalog (see {@link projectLpcCatalog}). */
  catalog: readonly LpcSlotCatalog[];
  /** Resolves a slot's asset ID to a renderable texture URL. */
  getLpcAssetPath: (slot: string, assetId: string, state: string) => string | null;
};

/**
 * Builds the client LPC pipeline: recipe resolver + asset URL resolver.
 *
 * Dedupes the `projectLpcCatalog` + `resolveLpcAppearance` wiring that
 * previously existed in BOTH game_engine_service and game_boot_service
 * (C-400). Also returns the projected catalog so callers pass the SAME
 * instance to GameWorld's `lpcCatalog` option instead of projecting twice.
 *
 * @param options - Projected catalog + asset URL resolver.
 * @returns Recipe resolver, asset URL resolver, and the projected catalog.
 */
export const createLpcPipeline = (
  options: CreateLpcPipelineOptions,
): {
  catalog: readonly LpcSlotCatalog[];
  recipeResolver: (layerIds: readonly number[]) => LpcLayerRecipe[];
  assetUrlResolver: (slot: string, assetId: string, state: string) => string | null;
} => {
  const { catalog, getLpcAssetPath } = options;

  const recipeResolver = (layerIds: readonly number[]): LpcLayerRecipe[] => [
    ...resolveLpcAppearance({ layerIds, catalog, fallbacks: DEFAULT_LPC_SLOT_FALLBACKS }).recipes,
  ];

  const assetUrlResolver = (slot: string, assetId: string, state: string): string | null =>
    getLpcAssetPath(slot, assetId, state);

  return { catalog, recipeResolver, assetUrlResolver };
};
