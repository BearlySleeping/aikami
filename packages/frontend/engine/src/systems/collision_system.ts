// packages/frontend/engine/src/systems/collision_system.ts

import type { World } from 'bitecs';
import { addComponent, addEntity, set } from 'bitecs';
import { CollisionData, CollisionLayer } from '../components/collision_data.ts';
import { GridPosition } from '../components/grid_position.ts';
import { Position } from '../components/position.ts';
import { SpatialLink } from '../components/spatial_link.ts';
import { clearBresenhamGrid, setBresenhamGrid } from '../math/bresenham.ts';

// ---------------------------------------------------------------------------
// Collision System — bitmask-based grid collision with intrusive linked list
//
// Contract C-173: Replaces boolean isWalkable() with a dense spatial grid
// (Uint32Array) backed by an intrusive doubly-linked list (SpatialLink)
// for entities sharing the same grid cell. Movement resolves via bitwise
// AND (&) collision mask checks against occupying entities.
//
// C-376 AC-3: isWalkable is now a pure terrain oracle (entity branch
// removed); entity awareness lives in isCellBlocked + the caller's
// composite mask check. Solid terrain cells become real wall entities.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Legacy collision grid (C-135 — preserved for backward compat)
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

/** The currently active boolean collision grid. */
let _activeGrid: CollisionGrid | undefined;

/**
 * Absolute map width in pixels (`grid.width * grid.tileSize`).
 *
 * `0` means no map bounds are active (bounds enforcement disabled).
 * Set by {@link setCollisionGrid}, cleared by {@link resetCollisionGrid}.
 */
let _mapPixelWidth = 0;

/**
 * Absolute map height in pixels (`grid.height * grid.tileSize`).
 *
 * `0` means no map bounds are active (bounds enforcement disabled).
 */
let _mapPixelHeight = 0;

// ---------------------------------------------------------------------------
// Spatial Grid (C-173) — dense 1D array with intrusive linked list
// ---------------------------------------------------------------------------

/**
 * The dense spatial grid — a flat Uint32Array where each cell stores the
 * head entity ID. The index is `y * mapWidth + x` for grid coordinates
 * `(x, y)`. Value 0 means empty cell.
 *
 * Entities with GridPosition + SpatialLink are registered here via
 * {@link insertIntoSpatialGrid} and removed via {@link removeFromSpatialGrid}.
 */
let _spatialGrid: Uint32Array | undefined;

/** Width of the spatial grid in tiles. */
let _gridWidth = 0;

/** Height of the spatial grid in tiles. */
let _gridHeight = 0;

// ---------------------------------------------------------------------------
// Public: Legacy API
// ---------------------------------------------------------------------------

/**
 * Sets the active collision grid for the current scene.
 *
 * Also initializes the spatial grid to match the collision grid dimensions
 * and populates it with wall entities for solid tiles.
 *
 * @param grid - The collision grid parsed from the map's collision layer.
 * @param world - The bitECS world for wall entity registration.
 */
export const setCollisionGrid = (grid: CollisionGrid, world?: World): void => {
  _activeGrid = grid;

  // Initialize the spatial grid to match collision grid dimensions
  if (grid) {
    // Cache the absolute pixel bounds so movement + walkability checks can
    // treat any coordinate outside [0, mapPixel) as strictly blocked.
    _mapPixelWidth = grid.width * grid.tileSize;
    _mapPixelHeight = grid.height * grid.tileSize;

    initializeSpatialGrid(grid.width, grid.height);

    // Populate the spatial grid with wall markers for solid tiles
    if (world) {
      _populateWallsFromCollisionGrid(world, grid);
    }
  }
};

/**
 * Clears the active collision grid and spatial grid.
 */
export const resetCollisionGrid = (): void => {
  _activeGrid = undefined;
  _spatialGrid = undefined;
  _gridWidth = 0;
  _gridHeight = 0;
  _mapPixelWidth = 0;
  _mapPixelHeight = 0;
  clearBresenhamGrid();
};

/**
 * Returns the absolute map bounds in world-space pixels.
 *
 * Both values are `0` when no collision grid is active — callers should
 * treat that as "bounds disabled" and skip enforcement.
 *
 * @returns The map width and height in pixels.
 */
export const getMapPixelBounds = (): { width: number; height: number } => {
  return { width: _mapPixelWidth, height: _mapPixelHeight };
};

/**
 * Checks whether a pixel coordinate lies within the absolute map bounds.
 *
 * A coordinate is in-bounds when `0 <= pixel < mapPixelSize` on both axes.
 * When no map bounds are active (`_mapPixelWidth === 0`), every coordinate
 * is considered in-bounds so free-camera / no-grid scenes are unaffected.
 *
 * This is the single source of truth for the hard map boundary used by
 * the movement system's continuous collision pipeline.
 *
 * @param pixelX - X position in world-space pixels.
 * @param pixelY - Y position in world-space pixels.
 * @returns `true` when the coordinate is inside the map, `false` otherwise.
 */
export const isWithinMapBounds = (pixelX: number, pixelY: number): boolean => {
  // No active bounds → nothing to enforce.
  if (_mapPixelWidth <= 0 || _mapPixelHeight <= 0) {
    return true;
  }
  return pixelX >= 0 && pixelX < _mapPixelWidth && pixelY >= 0 && pixelY < _mapPixelHeight;
};

/**
 * Checks whether a pixel coordinate is walkable.
 *
 * C-376 AC-3: pure terrain lookup — `true` when the boolean grid cell is
 * open, `false` when solid. Entity occupancy (NPCs, props, enemies, walls)
 * is NOT consulted here; callers that need entity awareness use the
 * composite `isCellBlocked(tx, ty, <mask>) || !isWalkable(px, py)` so a
 * wall/NPC standing on a walkable tile still blocks the mover via the
 * spatial grid bitmask.
 *
 * @param pixelX - X position in pixels.
 * @param pixelY - Y position in pixels.
 * @returns `true` if the tile at the given pixel position is walkable.
 */
export const isWalkable = (pixelX: number, pixelY: number): boolean => {
  if (!_activeGrid) {
    return true;
  }

  // Absolute pixel-space bounds — any coordinate outside the map is blocked.
  // This guards against tileSize rounding letting an entity drift onto the
  // far pixel edge of the last valid tile row/column.
  if (!isWithinMapBounds(pixelX, pixelY)) {
    return false;
  }

  const tileX = Math.floor(pixelX / _activeGrid.tileSize);
  const tileY = Math.floor(pixelY / _activeGrid.tileSize);

  // Out-of-bounds = blocked
  if (tileX < 0 || tileX >= _activeGrid.width || tileY < 0 || tileY >= _activeGrid.height) {
    return false;
  }

  const index = tileY * _activeGrid.width + tileX;

  // Terrain only — entity occupancy is handled by isCellBlocked + the
  // caller's composite mask check (C-376 AC-3).
  return !_activeGrid.grid[index];
};

// ---------------------------------------------------------------------------
// Spatial Grid API (C-173)
// ---------------------------------------------------------------------------

/**
 * Initializes the spatial grid to the given dimensions.
 *
 * Allocates a `Uint32Array` of size `width * height` filled with zeros
 * (empty cells). Only ONE spatial grid is active at a time — calling
 * this replaces any previous grid.
 *
 * @param width - Grid width in tiles.
 * @param height - Grid height in tiles.
 */
export const initializeSpatialGrid = (width: number, height: number): void => {
  _gridWidth = width;
  _gridHeight = height;
  _spatialGrid = new Uint32Array(width * height);

  // Wire the grid into the Bresenham raycaster (C-174)
  setBresenhamGrid(_spatialGrid, width, height);
};

/**
 * Returns the flattened 1D index for grid coordinates (x, y).
 *
 * @param x - Grid X coordinate (tile column).
 * @param y - Grid Y coordinate (tile row).
 * @returns The flattened index, or -1 if out of bounds.
 */
const _gridIndex = (x: number, y: number): number => {
  if (!_spatialGrid || x < 0 || x >= _gridWidth || y < 0 || y >= _gridHeight) {
    return -1;
  }
  return y * _gridWidth + x;
};

/**
 * Inserts an entity into the spatial grid at its GridPosition.
 *
 * Uses head-insertion (O(1)): the new entity becomes the head of the
 * linked list for its cell. The previous head (if any) is linked as
 * `SpatialLink.next[newEid]`.
 *
 * The entity must have GridPosition and SpatialLink components.
 *
 * @param eid - The entity ID to insert.
 */
export const insertIntoSpatialGrid = (eid: number): void => {
  if (!_spatialGrid || eid <= 0) {
    return;
  }

  const gx = GridPosition.x[eid];
  const gy = GridPosition.y[eid];
  if (gx === undefined || gy === undefined) {
    return;
  }

  const index = _gridIndex(gx, gy);
  if (index < 0) {
    return;
  }

  const oldHead = _spatialGrid[index];

  // Ensure SpatialLink arrays exist for this entity
  if (SpatialLink.next[eid] === undefined) {
    SpatialLink.next[eid] = 0;
  }
  if (SpatialLink.prev[eid] === undefined) {
    SpatialLink.prev[eid] = 0;
  }

  // Head insertion: new entity points to old head
  SpatialLink.next[eid] = oldHead;
  SpatialLink.prev[eid] = 0;

  // Old head's prev points to new entity
  if (oldHead !== 0 && SpatialLink.prev[oldHead] !== undefined) {
    SpatialLink.prev[oldHead] = eid;
  }

  // New entity becomes the head
  _spatialGrid[index] = eid;
};

/**
 * Removes an entity from the spatial grid.
 *
 * Splices the entity out of its cell's linked list:
 * - If it's the head, update the grid cell to point to next.
 * - Otherwise, update prev.next and next.prev to bypass this entity.
 *
 * @param eid - The entity ID to remove.
 */
export const removeFromSpatialGrid = (eid: number): void => {
  if (!_spatialGrid || eid <= 0) {
    return;
  }

  const gx = GridPosition.x[eid];
  const gy = GridPosition.y[eid];
  if (gx === undefined || gy === undefined) {
    return;
  }

  const index = _gridIndex(gx, gy);
  if (index < 0) {
    return;
  }

  const prevEid = SpatialLink.prev[eid] ?? 0;
  const nextEid = SpatialLink.next[eid] ?? 0;

  if (prevEid !== 0) {
    // Middle or tail node
    SpatialLink.next[prevEid] = nextEid;
  } else {
    // Head node — update grid cell
    _spatialGrid[index] = nextEid;
  }

  if (nextEid !== 0) {
    SpatialLink.prev[nextEid] = prevEid;
  }

  // Clear pointers on the removed entity
  SpatialLink.next[eid] = 0;
  SpatialLink.prev[eid] = 0;
};

// ---------------------------------------------------------------------------
// Bitmask collision check
// ---------------------------------------------------------------------------

/**
 * Checks whether a moving entity can enter a grid cell occupied by
 * entities in the spatial grid's linked list.
 *
 * A collision occurs when `moverMask & occupantLayer !== 0` for any
 * occupant in the cell. Returns `true` if the move is blocked.
 *
 * @param destX - Destination grid X coordinate.
 * @param destY - Destination grid Y coordinate.
 * @param moverMask - Bitmask of what the moving entity collides with.
 * @returns `true` if movement is blocked (collision detected).
 */
export const isCellBlocked = (destX: number, destY: number, moverMask: number): boolean => {
  // ── Absolute map tile boundary — checked FIRST, before any spatial grid ──
  // Even when the spatial grid is not initialized, OOB tile coordinates are
  // strictly blocked if a collision grid has been set. Uses the boolean
  // grid dimensions which are always available when a map is loaded,
  // regardless of spatial-grid lifecycle state.
  if (_activeGrid) {
    if (destX < 0 || destX >= _activeGrid.width || destY < 0 || destY >= _activeGrid.height) {
      return true;
    }
  }

  if (!_spatialGrid) {
    return false;
  }

  const index = _gridIndex(destX, destY);
  if (index < 0) {
    return true; // Out of bounds = blocked (defence in depth)
  }

  const headEid = _spatialGrid[index];
  if (headEid === 0) {
    return false; // Empty cell — no collision
  }

  // Walk the linked list
  let current = headEid;
  while (current !== 0) {
    const layer = CollisionData.layer[current] ?? 0;
    if ((moverMask & layer) !== 0) {
      return true; // Collision detected
    }
    current = SpatialLink.next[current] ?? 0;
  }

  return false;
};

// ---------------------------------------------------------------------------
// Internal: Wall population from collision grid
// ---------------------------------------------------------------------------

/**
 * Creates real wall entities for solid tiles from the boolean collision grid.
 *
 * Each solid cell becomes a bitECS entity with:
 * - `CollisionData { layer: CollisionLayer.wall, mask: 0 }` — the layer is
 *   what every mover's mask intersects (player/NPC/prop/enemy masks all
 *   include `CollisionLayer.wall`), so walls block everything; the wall's
 *   own mask is unused (walls never move/check).
 * - `GridPosition` at the tile coordinate + `SpatialLink` linked-list slots.
 * - `Position` at the tile center (pixel space) for future render/serialization.
 *
 * Then `insertIntoSpatialGrid` registers it. Wall entities are runtime-only
 * — re-created per LOAD_MAP, never serialized (the ECS serializer only
 * persists Position/Appearance/CombatStats/Visual for the player scope, and
 * map loads clear non-player entities before re-spawning).
 *
 * This completes C-173's unfinished plan ("scaffolded for future wall entity
 * creation") and enables doors/bridges/destructibles as runtime layer toggles.
 *
 * @param world - The bitECS world.
 * @param grid - The collision grid.
 */
const _populateWallsFromCollisionGrid = (world: World, grid: CollisionGrid): void => {
  if (!_spatialGrid) {
    return;
  }

  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.grid[y * grid.width + x]) {
        const eid = addEntity(world);

        addComponent(world, eid, Position);
        addComponent(
          world,
          eid,
          set(Position, {
            x: x * grid.tileSize + grid.tileSize / 2,
            y: y * grid.tileSize + grid.tileSize / 2,
          }),
        );
        addComponent(world, eid, GridPosition);
        addComponent(world, eid, set(GridPosition, { x, y }));
        addComponent(world, eid, SpatialLink);
        addComponent(world, eid, set(SpatialLink, { next: 0, prev: 0 }));
        addComponent(world, eid, CollisionData);
        addComponent(world, eid, set(CollisionData, { layer: CollisionLayer.wall, mask: 0 }));

        insertIntoSpatialGrid(eid);
      }
    }
  }
};
