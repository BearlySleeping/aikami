// packages/frontend/engine/src/game_world/screen_projection.ts
//
// Screen → world → tile-cell resolution.
//
// Split out of the `GameWorld` facade so the coordinate rules can be stated
// once and tested without a renderer: which cell a click lands on, and how
// that cell is nudged onto ground the actor can actually stand on.

import { findNearestPathableCell } from '../systems/actor_footprint.ts';
import type { TerrainGrid } from '../systems/terrain_grid.ts';

/** Fallback tile size before any scene has declared one. */
const DEFAULT_TILE_SIZE = 32;

/** A resolved tile cell in map coordinates. */
export type TileCell = { cellX: number; cellY: number };

/** Everything the resolution needs, so the caller keeps no logic. */
export type ResolveScreenToCellOptions = {
  /** Screen-space point already converted to world pixels. */
  world: { x: number; y: number };
  /** Active scene tile size; falls back to 32 before the first scene. */
  tileSize?: number;
  /** Authoritative terrain grid; bounds the raw cell when present. */
  terrain?: TerrainGrid;
  /** Footprint-aware cost grid used to snap onto a standable cell. */
  pathGrid?: TerrainGrid;
};

/**
 * Resolves a world point to the tile cell the player means.
 *
 * The raw cell is clamped to the map bounds, then snapped to the nearest cell
 * the actor's footprint can stand in. Clicks in the void outside the map, or
 * on walls and props, therefore resolve to the closest enterable cell instead
 * of being refused, and the destination marker lands on the same cell the
 * worker will path to.
 */
export const resolveScreenToCell = (options: ResolveScreenToCellOptions): TileCell => {
  const { world, terrain, pathGrid } = options;
  const tileSize = options.tileSize ?? DEFAULT_TILE_SIZE;
  let cellX = Math.floor(world.x / tileSize);
  let cellY = Math.floor(world.y / tileSize);

  if (terrain) {
    cellX = Math.max(0, Math.min(terrain.width - 1, cellX));
    cellY = Math.max(0, Math.min(terrain.height - 1, cellY));
  }

  if (pathGrid) {
    const nearest = findNearestPathableCell(pathGrid, cellX, cellY);
    if (nearest) {
      return { cellX: nearest.x, cellY: nearest.y };
    }
  }

  return { cellX, cellY };
};
