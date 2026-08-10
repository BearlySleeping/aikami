// packages/frontend/engine/src/rendering/layer_bands.ts
//
// Declarative z-bands for sibling layers on _worldContainer (C-376 AC-4).
//
// With `sortableChildren = true`, PixiJS sorts EVERY child of the world
// container by zIndex — including the tilemap chunks, debug grid, and zone
// overlays that were previously pinned below entities by insertion order.
// These bands place them explicitly below the entity y-range (which is
// always >= 0 in world space), so they cannot interleave with entities.
//
// Weather overlay (zIndex 9999 on its mesh) lives on _app.stage, outside
// _worldContainer, so it is not sorted here.

/** Declarative z-bands for world-container siblings (C-376 AC-4). */
export const WORLD_Z_BANDS = {
  /** Tilemap chunk container — bottom of the world (was addChildAt 0). */
  tilemap: -1000,
  /** Debug grid overlay — below the tilemap (Pixi sorts ascending). */
  debugGrid: -2000,
  /** Transition-zone debug overlays — below the entity y-range (y >= 0). */
  zoneOverlays: -500,
} as const;

export type WorldZBand = (typeof WORLD_Z_BANDS)[keyof typeof WORLD_Z_BANDS];
