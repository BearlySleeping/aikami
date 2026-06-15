// packages/frontend/engine/src/systems/collision_system.ts

// ---------------------------------------------------------------------------
// Collision System — static obstacle grid for tilemap-based physics
//
// Contract C-135: Stores a 2D boolean collision grid parsed from the
// map's dedicated collision layer. The movement system queries this
// grid before applying velocity to prevent entities from walking
// through solid tiles or off the map bounds.
// ---------------------------------------------------------------------------

/**
 * A 2D boolean collision grid representing solid (true) vs walkable (false)
 * tiles in the game map.
 */
export type CollisionGrid = {
  /** Grid width in tiles. */
  width: number;
  /** Grid height in tiles. */
  height: number;
  /** Tile size in pixels (from the map's `tilewidth`/`tileheight`). */
  tileSize: number;
  /** Row-major flat array: `grid[row * width + col] === true` means solid. */
  grid: boolean[];
};

/**
 * The currently active collision grid.
 *
 * When `undefined`, collision checks are skipped (all tiles are walkable).
 * Set via {@link setCollisionGrid} before any entity movement begins.
 */
let _activeGrid: CollisionGrid | undefined;

/**
 * Sets the active collision grid for the current scene.
 *
 * Call this once per scene during initialization, before the first
 * tick where entities can move. The grid is stored as a module-level
 * singleton — only one scene's collision data is active at a time.
 *
 * @param grid - The collision grid parsed from the map's collision layer.
 */
export const setCollisionGrid = (grid: CollisionGrid): void => {
  _activeGrid = grid;
};

/**
 * Clears the active collision grid.
 *
 * Call during scene teardown or world disposal to prevent stale
 * collision data from affecting the next scene.
 */
export const resetCollisionGrid = (): void => {
  _activeGrid = undefined;
};

/**
 * Checks whether a pixel coordinate is walkable (not inside a solid tile).
 *
 * Converts the pixel position to tile coordinates using the active
 * grid's `tileSize`, then checks the boolean grid. Positions outside
 * the map bounds are treated as solid (blocked).
 *
 * When no collision grid is active, always returns `true` (unrestricted
 * movement).
 *
 * @param pixelX - X position in pixels.
 * @param pixelY - Y position in pixels.
 * @returns `true` if the tile at the given pixel position is walkable.
 */
export const isWalkable = (pixelX: number, pixelY: number): boolean => {
  if (!_activeGrid) {
    return true;
  }

  const tileX = Math.floor(pixelX / _activeGrid.tileSize);
  const tileY = Math.floor(pixelY / _activeGrid.tileSize);

  // Out-of-bounds = blocked
  if (tileX < 0 || tileX >= _activeGrid.width || tileY < 0 || tileY >= _activeGrid.height) {
    return false;
  }

  const index = tileY * _activeGrid.width + tileX;
  return !_activeGrid.grid[index];
};
