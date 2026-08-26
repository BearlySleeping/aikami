// apps/frontend/client/src/lib/views/dev/sandbox/shared/lpc_sandbox_resolver.ts
//
// Shared catalog-based LPC recipe resolver for all sandbox ViewModels.
// Replaces the old SandboxRecipes flat-map approach that was incompatible
// with the engine's 1-indexed-per-slot variant index scheme.

import type { LpcLayerRecipe } from '@aikami/frontend/engine';
import { GENERATED_LPC_SLOTS } from '$lib/data/lpc_asset_catalog_generated';

const EngineSlots = ['body', 'hair', 'torso', 'legs', 'feet', 'head'] as const;

const SlotCatalogIndex: Record<string, number> = {};
for (let idx = 0; idx < GENERATED_LPC_SLOTS.length; idx++) {
  const entry = GENERATED_LPC_SLOTS[idx];
  if (!entry) {
    continue;
  }
  SlotCatalogIndex[entry.slot] = idx;
}

const paletteBytes = new Uint8Array(1024);

/**
 * Resolves engine variant indices to LPC layer recipes using the generated
 * catalog. Matches the production recipeResolver in game_boot_service.
 *
 * Engine slot order: body, hair, torso, legs, feet, head.
 * Each value is a 1-indexed variant number within that slot's catalog.
 *
 * @param layerIds - 6-element array of 1-indexed variant numbers.
 * @returns Array of LpcLayerRecipe for rendering.
 */
export const sandboxRecipeResolver = (layerIds: readonly number[]): LpcLayerRecipe[] => {
  const recipes: LpcLayerRecipe[] = [];
  for (let i = 0; i < EngineSlots.length; i++) {
    const rawId = layerIds[i];
    const slotName = EngineSlots[i] ?? `layer_${i}`;
    const catalogIdx = SlotCatalogIndex[slotName];
    if (catalogIdx === undefined) {
      continue;
    }
    const slotDef = GENERATED_LPC_SLOTS[catalogIdx];
    let effectiveIdx = typeof rawId === 'number' ? rawId - 1 : -1;
    if (slotName === 'head') {
      if (effectiveIdx < 0) {
        effectiveIdx = 94;
      }
      const headVariant = slotDef?.variants[effectiveIdx];
      if (!headVariant?.assetId.startsWith('head/heads/')) {
        effectiveIdx = 94;
      }
    }
    const variant = slotDef?.variants[effectiveIdx];
    if (!variant) {
      continue;
    }
    recipes.push({
      slot: slotName,
      assetId: variant.assetId,
      hexPalette: paletteBytes,
    });
  }
  return recipes;
};
