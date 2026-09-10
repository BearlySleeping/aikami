// apps/frontend/client/src/lib/data/starter_hero_recipes.ts
//
// Builds LpcLayerRecipe[] from a StarterHero's C-504 appearance identity
// (lpcRecipe + paletteOverrides). This is the single resolution path that
// turns a starter hero into a real rendered portrait — consumed by the
// starter hero card so no hard-coded emoji or empty placeholder stands in
// for a portrait (C-498 AC-3).
//
// Contract: C-498 A preset means the character is ready

import type { StarterHero } from '@aikami/constants';
import type { LpcLayerRecipe } from '@aikami/frontend/engine/sim';

/** Canonical render-order for LPC slots. Matches engine ordering. */
export const STARTER_ENGINE_SLOTS = [
  'body',
  'accessories',
  'hair',
  'torso',
  'legs',
  'feet',
  'head',
  'headAccessories',
] as const;

/**
 * Builds a 1024-byte palette LUT (256 RGBA pixels) from a 6-char hex color,
 * or an all-zero (no-tint) LUT when no valid color is supplied. Mirrors the
 * coordinator ViewModel's palette handling so cards and the appearance step
 * render identically.
 */
export const buildPaletteLut = (hexColor: string | undefined): Uint8Array => {
  const palette = new Uint8Array(1024);
  if (hexColor?.length !== 6) {
    return palette;
  }
  const r = Number.parseInt(hexColor.slice(0, 2), 16);
  const g = Number.parseInt(hexColor.slice(2, 4), 16);
  const b = Number.parseInt(hexColor.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return palette;
  }
  for (let entry = 0; entry < 256; entry++) {
    const offset = entry * 4;
    palette[offset] = r;
    palette[offset + 1] = g;
    palette[offset + 2] = b;
    palette[offset + 3] = 255;
  }
  return palette;
};

/**
 * Converts a starter hero's appearance identity into ordered LPC layer
 * recipes ready for the preview renderer. Skips slots with no asset.
 */
export const buildStarterHeroRecipes = (hero: StarterHero): LpcLayerRecipe[] => {
  const recipes: LpcLayerRecipe[] = [];
  for (const slot of STARTER_ENGINE_SLOTS) {
    const assetId = hero.lpcRecipe[slot];
    if (!assetId) {
      continue;
    }
    recipes.push({
      slot,
      assetId,
      hexPalette: buildPaletteLut(hero.paletteOverrides?.[slot]),
    });
  }
  return recipes;
};
