// apps/frontend/client/src/lib/utils/appearance_recipe.ts
//
// Equipment-collision normalisation for a character's base LPC appearance.
//
// The equipment pipeline composes a character by merging gear recipes over the
// base appearance with `mergeLpcRecipes`, which can only REPLACE a same-(slot,
// layerRole) base layer or APPEND a new one — it can never remove one. So the
// base layer of an equipment-mapped slot must be something OTHER than the asset
// the item provides, or the toggle is invisible.
//
// The failure is silent, and has three sources that are really one bug:
//
//  1. `DEFAULT_LPC_RECIPE` shipped a chainmail torso and boot-shoe feet, which
//     are byte-identical to `chainmailArmor` and `leatherBoots`.
//  2. A persona's persisted `appearance.lpcRecipe` OVERRIDES every slot it
//     specifies (see the `effectiveRecipe` build in `game_boot_service` /
//     `game_engine_service`), and the character creator persists an
//     AI-generated recipe onto the persona. So a character authored while the
//     default was chainmail keeps chainmail as its base outfit, and toggling
//     `chainmailArmor` changes nothing — permanently, regardless of the default.
//  3. An author can hand-pick an equippable item's asset as base clothing.
//
// The fix for all three: a base appearance never wears an asset an equippable
// item provides for that slot. The base is under-clothing; gear supplies the
// armoured variant. This also makes an already-saved character self-heal on the
// next boot, with no save migration.

import { DEFAULT_LPC_RECIPE } from '@aikami/constants';
import type { ItemDefinition } from '@aikami/types';
import { logger } from '$logger';
import { getResolvableItemCatalog } from '$utils/inventory_utils';

/**
 * LPC layer slots an equipment item can occupy.
 *
 * An item's own `lpcSlot` is authoritative; this set only narrows the check to
 * layers where a collision would actually be visible on the composed sprite.
 */
const EQUIPMENT_LAYER_SLOTS: readonly string[] = ['body', 'torso', 'dress', 'legs', 'feet', 'head'];

/**
 * Builds `lpcSlot → Set(assets that an equippable item provides for it)`.
 *
 * Items without `lpcSlot`/`lpcAssetId` are ignored: they never reach the sprite,
 * so they cannot cause a collision.
 */
export const equipmentAssetsBySlot = (
  catalog: Readonly<Record<string, ItemDefinition>>,
): Map<string, Set<string>> => {
  const bySlot = new Map<string, Set<string>>();
  for (const definition of Object.values(catalog)) {
    if (!definition?.equippable || !definition.lpcSlot || !definition.lpcAssetId) {
      continue;
    }
    const assets = bySlot.get(definition.lpcSlot) ?? new Set<string>();
    assets.add(definition.lpcAssetId);
    bySlot.set(definition.lpcSlot, assets);
  }
  return bySlot;
};

/** One slot reset because the base was wearing an equippable item's asset. */
export type RecipeCollision = {
  /** The LPC layer that collided (`torso`, `feet`, …). */
  slot: string;
  /** The asset the base was wearing — also provided by an equippable item. */
  assetId: string;
  /** The neutral under-clothing substituted for it. */
  replacement: string;
};

export type NormalizeRecipeResult = {
  recipe: Record<string, string>;
  collisions: RecipeCollision[];
};

/**
 * Returns `recipe` with every equipment-colliding garment asset replaced by the
 * neutral `DEFAULT_LPC_RECIPE` asset for that slot.
 *
 * Only layers that (a) an item can occupy and (b) actually collide are touched,
 * so an ordinary shirt is left alone. A colliding layer with no neutral default
 * is left as-is rather than blanked — losing the layer would be worse than a
 * redundant-looking outfit.
 */
export const normalizeRecipeAgainstEquipment = (
  recipe: Readonly<Record<string, string>>,
  catalog: Readonly<Record<string, ItemDefinition>>,
): NormalizeRecipeResult => {
  const bySlot = equipmentAssetsBySlot(catalog);
  const out: Record<string, string> = { ...recipe };
  const collisions: RecipeCollision[] = [];

  for (const slot of EQUIPMENT_LAYER_SLOTS) {
    const assets = bySlot.get(slot);
    const current = out[slot];
    if (!assets || !current || !assets.has(current)) {
      continue; // no item touches this layer, or no collision — the common case
    }
    const replacement = DEFAULT_LPC_RECIPE[slot];
    if (!replacement || replacement === current) {
      continue; // no neutral default for this layer
    }
    out[slot] = replacement;
    collisions.push({ slot, assetId: current, replacement });
  }

  return { recipe: out, collisions };
};

/**
 * Builds the base appearance for a boot: `DEFAULT_LPC_RECIPE` as the base, the
 * persona's recipe layered over it (only for assets the catalog actually
 * serves), then equipment-collision normalisation.
 *
 * Shared by `game_boot_service` and `game_engine_service`, which previously
 * duplicated this block. `isValidAsset` is injected because catalog validation
 * needs each caller's projected slot list.
 */
export const buildEffectiveAppearanceRecipe = (options: {
  /** The persona's persisted `appearance.lpcRecipe`, if any. */
  personaRecipe?: Readonly<Record<string, string>> | null;
  /** Whether `assetId` is servable for `slot` in the caller's catalog. */
  isValidAsset: (slot: string, assetId: string) => boolean;
}): Record<string, string> => {
  const { personaRecipe, isValidAsset } = options;
  const recipe: Record<string, string> = { ...DEFAULT_LPC_RECIPE };
  for (const [slot, assetId] of Object.entries(personaRecipe ?? {})) {
    if (isValidAsset(slot, assetId)) {
      recipe[slot] = assetId;
    }
  }
  return normalizePersonaRecipe(recipe);
};

/**
 * Boot-path wrapper: normalises a persona recipe against every item the runtime
 * can resolve — the hardcoded fallback catalog UNION the active content pack
 * (see `getResolvableItemCatalog`). Pack-only would miss fallback items like
 * `chainmailArmor`, which stay equippable even when a pack is loaded.
 *
 * Returns the corrected recipe and logs any collisions itself, so a boot
 * service call site stays a single assignment.
 */
export const normalizePersonaRecipe = (
  recipe: Readonly<Record<string, string>>,
): Record<string, string> => {
  const { recipe: normalized, collisions } = normalizeRecipeAgainstEquipment(
    recipe,
    getResolvableItemCatalog(),
  );
  if (collisions.length > 0) {
    logger.debug('appearance-recipe:equipment-collision-normalised', {
      collisions: collisions.map((c) => `${c.slot}:${c.assetId}->${c.replacement}`),
    });
  }
  return normalized;
};
