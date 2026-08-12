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

/**
 * Supported minimum entity world-Y (and therefore zIndex, since
 * `entry.displayObject.zIndex = y`).
 *
 * LOAD_MAP spawn coordinates and the camera clamp keep entities inside the
 * map, but raw world coordinates can go negative (e.g. player at -100, -100
 * while the camera centers the world container). Every WORLD_Z_BANDS band
 * must stay strictly below this bound so tilemap/debug/zone overlays never
 * interleave with entities — including the negative range.
 */
export const MIN_ENTITY_Y = -512;

/** Declarative z-bands for world-container siblings (C-376 AC-4, C-378 AC-1). */
export const WORLD_Z_BANDS = {
  /** Debug grid overlay — below the tilemap (Pixi sorts ascending). */
  debugGrid: -2000,
  /** Ground tilemap chunks — bottom of the world (was addChildAt 0). */
  tilemapGround: -1000,
  /** Decor tilemap chunks — below entities, above ground (C-378 AC-1). */
  tilemapDecor: -900,
  /** Transition-zone debug overlays — below MIN_ENTITY_Y (-512). */
  zoneOverlays: -750,
  /**
   * Overhead tilemap chunks (roofs, canopies) — ABOVE every entity (C-378
   * AC-1). Entity zIndex is unbounded above by `computeEntityZIndex`; use a
   * value larger than any realistic map pixel height (100_000) rather than
   * trusting MIN_ENTITY_Y, and assert the invariant in the tests.
   */
  tilemapOverhead: 100_000,
} as const;

export type WorldZBand = (typeof WORLD_Z_BANDS)[keyof typeof WORLD_Z_BANDS];

/**
 * Computes the entity display-object zIndex for a world-space y.
 *
 * Raw float (never rounded — the stable sort + never-reparented containers
 * give the tie-break free), clamped to {@link MIN_ENTITY_Y} so the band
 * invariant (bands below MIN_ENTITY_Y) holds even for negative spawn
 * coordinates (CodeRabbit review, C-376).
 */
export const computeEntityZIndex = (y: number): number => Math.max(MIN_ENTITY_Y, y);
