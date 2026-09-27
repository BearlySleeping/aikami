// packages/frontend/engine/src/game_events/appearance_changed.ts
//
// The appearance-changed event, split out of the `GameEvent` union.
//
// Extracted from `types.ts` — that module is at its reviewed size ceiling,
// and this event carries the reasoning that does not fit there.

import type { LpcLayerRecipe } from '../components/appearance.ts';

export type AppearanceChangedEvent = {
  /** Emitted when an entity's Appearance component layers change. */
  type: 'APPEARANCE_CHANGED';
  eid: number;
  /** The new layer IDs (all 5 layers) for dirty-check comparison. */
  layerIds: number[];
  /**
   * Extra-slot layers (hat, shield, weapon, cape, …) resolved for this entity.
   *
   * These are NOT in `layerIds`: that array is the six positional base slots.
   * The worker owns the resolved extras (they come from the content pack at
   * spawn) and the main thread has no access to the worker's ECS, so they
   * travel here and are appended to the composited recipe list.
   */
  extraLayers?: LpcLayerRecipe[];
};

/**
 * The slot → assetId identity of a resolved recipe list.
 *
 * Exposed on the debug surface for E2E identity assertions: it is the same
 * data an author declared, re-derived from what the renderer actually holds.
 */
export const toAppearanceIdentity = (recipes: readonly LpcLayerRecipe[]): Record<string, string> =>
  Object.fromEntries(recipes.filter((r) => r.assetId).map((r) => [r.slot, r.assetId]));
