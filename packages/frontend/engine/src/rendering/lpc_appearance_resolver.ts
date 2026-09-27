// packages/frontend/engine/src/rendering/lpc_appearance_resolver.ts
//
// Client pipeline builder — wraps the pure resolver from @aikami/lpc with
// the asset URL resolver and recipe resolver used by the game engine.
//
// The pure resolver functions (resolveLpcAppearance, projectLpcCatalog, etc.)
// now live in @aikami/lpc. Only createLpcPipeline remains here because it
// builds a client-side pipeline that couples to the engine's recipe type.

import type { LpcLayerRecipe } from '@aikami/lpc';
import {
  DEFAULT_LPC_SLOT_FALLBACKS,
  LPC_SLOT_ORDER,
  type LpcSlotCatalog,
  type LpcSlotName,
  projectAppearanceCatalog,
  projectLpcCatalog,
  resetLpcFallbackWarnings,
  resolveLpcAppearance,
} from '@aikami/lpc';

export type { LpcSlotCatalog, LpcSlotName };
// Re-export moved symbols for backward compatibility with test imports.
export {
  DEFAULT_LPC_SLOT_FALLBACKS,
  LPC_SLOT_ORDER,
  projectLpcCatalog,
  resetLpcFallbackWarnings,
  resolveLpcAppearance,
};

/** Options for {@link createLpcPipeline}. */
export type CreateLpcPipelineOptions = {
  /** The projected engine-slot catalog (see {@link projectLpcCatalog}). */
  catalog: readonly { slot: string; variants: readonly { assetId: string }[] }[];
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
 * Takes the FULL generated slot list, not a pre-projected catalog: the extras
 * a weapon or shield needs are dropped by the base projection, so a caller that
 * projected first would silently strip every extra an outfit declares. Both
 * projections happen here, which is also why there is only one of this function.
 *
 * @param options - Generated slot catalog + asset URL resolver.
 * @returns Recipe resolver, asset URL resolver, and the appearance catalog.
 */
export const createLpcPipeline = (
  options: CreateLpcPipelineOptions,
): {
  catalog: ReturnType<typeof projectAppearanceCatalog>;
  recipeResolver: (layerIds: readonly number[]) => LpcLayerRecipe[];
  assetUrlResolver: (slot: string, assetId: string, state: string) => string | null;
} => {
  const { catalog, getLpcAssetPath } = options;

  const recipeResolver = (layerIds: readonly number[]): LpcLayerRecipe[] => [
    ...resolveLpcAppearance({
      layerIds,
      catalog: projectLpcCatalog(catalog),
      fallbacks: DEFAULT_LPC_SLOT_FALLBACKS,
    }).recipes,
  ];

  const assetUrlResolver = (slot: string, assetId: string, state: string): string | null =>
    getLpcAssetPath(slot, assetId, state);

  // The returned catalog is what the WORKER resolves appearances against, and
  // it must include the addable extra slots (hat, shield, weapon, …) or every
  // extra an outfit names reads as "not in the catalog" and is dropped. The
  // rendering resolver above is unaffected: it only ever looks up base slots.
  return {
    catalog: projectAppearanceCatalog(catalog),
    recipeResolver,
    assetUrlResolver,
  };
};

/**
 * Merges equipment layer recipes on top of base recipes (C-504).
 *
 * Keys on `(slot, layerRole)` so behind/front entries for the same slot
 * coexist (C-431). A missing/undefined `layerRole` on EITHER side is
 * normalized to 'front' BEFORE the match — equipment recipes built from item
 * definitions omit `layerRole` (LpcLayerRecipe.layerRole is optional) while the
 * base resolver always emits an explicit 'front'; without normalization a
 * torso item never matched the base torso entry and the outfit rendered twice.
 * The merged entry always carries an explicit layerRole.
 */
export const mergeLpcRecipes = (
  baseRecipes: readonly LpcLayerRecipe[],
  equipmentRecipes: readonly LpcLayerRecipe[],
): LpcLayerRecipe[] => {
  const merged: LpcLayerRecipe[] = [...baseRecipes];
  for (const equipmentRecipe of equipmentRecipes) {
    const equipmentRole = equipmentRecipe.layerRole ?? 'front';
    const overlapIndex = merged.findIndex(
      (r) => r.slot === equipmentRecipe.slot && (r.layerRole ?? 'front') === equipmentRole,
    );
    const normalized: LpcLayerRecipe = { ...equipmentRecipe, layerRole: equipmentRole };
    if (overlapIndex >= 0) {
      merged[overlapIndex] = normalized;
    } else {
      merged.push(normalized);
    }
  }
  return merged;
};
