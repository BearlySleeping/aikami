// apps/frontend/client/src/lib/utils/appearance_layers.ts
//
// Maps a base LPC recipe onto the engine's per-slot VARIANT INDICES.
//
// The engine's `Appearance.layers` array is positional: entry N is the
// 1-indexed variant number within slot N's catalog. Turning a recipe
// (`{ torso: 'torso/clothes/longsleeve/longsleeve_male' }`) into that array
// means resolving each assetId through the SAME catalog the engine was handed.
//
// Two historical hazards, both silent:
//
//  1. Magic fallback indices. The boot path used to carry a literal
//     `{ body: 3, hair: 3, legs: 22, head: 95 }` table for unresolvable
//     slots. Those numbers only meant anything against one specific catalog
//     snapshot, and in practice pointed at CHILD / `female_small` assets — a
//     bare-chested child body on an adult persona. A fallback index is a guess
//     dressed as data, and it is never right for an arbitrary catalog.
//  2. A missing slot collapsing to `0` with no report, so "this character
//     wears nothing here" was indistinguishable from "we could not resolve
//     this".
//
// The rule here: an index is always derived from an assetId the catalog
// actually serves. If neither the recipe nor `DEFAULT_LPC_RECIPE` resolves, the
// layer is omitted (0, meaning "intentionally empty") and the miss is REPORTED
// to the caller — never silently filled with a guess.

import { DEFAULT_LPC_RECIPE } from '@aikami/constants';
import { LPC_SLOT_ORDER } from '@aikami/lpc';

/** The engine slot list this module projects onto, in `Appearance.layers` order. */
export const APPEARANCE_LAYER_SLOT_ORDER: readonly string[] = LPC_SLOT_ORDER;

/** A slot whose catalog lookup produced no renderable variant. */
export type UnresolvedAppearanceLayer = {
  /** The engine slot that could not be resolved. */
  slot: string;
  /** The asset the recipe asked for, or `undefined` when the recipe omitted it. */
  requestedAssetId: string | undefined;
  /** Why no index was produced. */
  reason: 'slot-missing-from-catalog' | 'asset-missing-from-catalog';
};

export type AppearanceLayerIndexResult = {
  /**
   * Positional 1-indexed variant indices, one per slot in
   * {@link APPEARANCE_LAYER_SLOT_ORDER}. `0` means intentionally empty.
   */
  layers: readonly number[];
  /** Slots that produced no index — surfaced to the caller as warnings. */
  unresolved: readonly UnresolvedAppearanceLayer[];
};

/** The projected slot shape the engine consumes (see `createLpcPipeline`). */
type ProjectedSlot = { slot: string; variants: readonly { assetId: string }[] };

/**
 * Resolves `recipe` into positional layer indices using `slots` as the only
 * source of truth for what exists.
 *
 * A slot the recipe does not specify, or specifies an asset the catalog does
 * not serve, falls back to `DEFAULT_LPC_RECIPE[slot]` — real, adult, clothed
 * base clothing — resolved through the same lookup. That is a data-derived
 * answer, so it can never point at a child asset the way a literal index could.
 * When even the default does not resolve, the layer is omitted and reported.
 */
export const buildAppearanceLayerIndices = (options: {
  /** The projected LPC slot catalog the engine was given. */
  slots: readonly ProjectedSlot[];
  /** The base recipe (already equipment-collision-normalised). */
  recipe: Readonly<Record<string, string>>;
}): AppearanceLayerIndexResult => {
  const { slots, recipe } = options;

  const slotByName = new Map<string, ProjectedSlot>();
  for (const slotDef of slots) {
    slotByName.set(slotDef.slot, slotDef);
  }

  const layers: number[] = [];
  const unresolved: UnresolvedAppearanceLayer[] = [];

  for (const slotName of APPEARANCE_LAYER_SLOT_ORDER) {
    const requestedAssetId = recipe[slotName];
    const slotDef = slotByName.get(slotName);

    if (!slotDef) {
      // No such slot in the catalog at all — there is no index to compute.
      if (requestedAssetId) {
        unresolved.push({ slot: slotName, requestedAssetId, reason: 'slot-missing-from-catalog' });
      }
      layers.push(0);
      continue;
    }

    const resolve = (assetId: string | undefined): number => {
      if (!assetId) {
        return -1;
      }
      const variantIdx = slotDef.variants.findIndex((v) => v.assetId === assetId);
      return variantIdx >= 0 ? variantIdx + 1 : -1;
    };

    const direct = resolve(requestedAssetId);
    if (direct > 0) {
      layers.push(direct);
      continue;
    }

    // Recipe omitted the slot or named an asset this catalog does not serve.
    // Substitute the neutral base default rather than guessing an index.
    const fallbackIdx = resolve(DEFAULT_LPC_RECIPE[slotName]);
    if (fallbackIdx > 0) {
      layers.push(fallbackIdx);
      continue;
    }

    if (requestedAssetId) {
      unresolved.push({ slot: slotName, requestedAssetId, reason: 'asset-missing-from-catalog' });
    }
    // Prefer an omitted layer over an invented one.
    layers.push(0);
  }

  return { layers, unresolved };
};
