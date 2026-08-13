// packages/frontend/engine/src/systems/collision_system.ts

import type { World } from 'bitecs';
import { CollisionData } from '../components/collision_data.ts';
import { GridPosition } from '../components/grid_position.ts';
import { SpatialLink } from '../components/spatial_link.ts';
import { clearBresenhamGrid, setBresenhamGrid, setBresenhamTerrain } from '../math/bresenham.ts';
import { buildTerrainGridFromBoolean, type TerrainGrid } from './terrain_grid.ts';

// ---------------------------------------------------------------------------
// Collision System — terrain cost grid + dynamic-occupancy spatial grid
//
// Contract C-379: replaces the boolean CollisionGrid + wall entities with
// two authoritative structures:
//
//   1. TerrainGrid — a Uint8Array of movement costs (0 = impassable, else
//      cost × 16) plus a blocksSight byte array, built once per LOAD_MAP.
//      Terrain NEVER becomes an entity: doors/bridges/destructibles mutate
//      the cost grid at runtime.
//   2. Occupancy — the dense Uint32Array spatial grid (C-173) backed by the
//      intrusive doubly-linked list (SpatialLink) for DYNAMIC entities only
//      (NPCs, props, player, enemies). Solid tiles are no longer entities.
//
// Movement resolves via the canonical composite:
//   isCellBlocked(tx, ty, moverMask) || !isWalkable(px, py)
// where isCellBlocked consults dynamic occupancy and isWalkable consults
// the terrain cost grid.
// ---------------------------------------------------------------------------

/**
 * Legacy boolean collision grid (C-135 / C-376 input format).
 *
 * Still accepted by {@link setCollisionGrid} as the input shape for maps
 * without a terrain channel — {@link buildTerrainGridFromBoolean} converts
 * it to a TerrainGrid at the boundary. It is NOT stored as the active grid.
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

// ---------------------------------------------------------------------------
// Active terrain grid
// ---------------------------------------------------------------------------

/** The currently active terrain grid (cost + blocksSight). */
let _terrain: TerrainGrid | undefined;

/**
 * Absolute map width in pixels (`terrain.width * terrain.tileSize`).
 *
 * `0` means no map bounds are active (bounds enforcement disabled).
 */
let _mapPixelWidth = 0;

/**
 * Absolute map height in pixels (`terrain.height * terrain.tileSize`).
 */
let _mapPixelHeight = 0;

// ---------------------------------------------------------------------------
// Spatial Grid (C-173) — dense 1D array with intrusive linked list
// ---------------------------------------------------------------------------

/**
 * The dense occupancy grid — a flat Uint32Array where each cell stores the
 * head entity ID. The index is `y * mapWidth + x` for grid coordinates
 * `(x, y)`. Value 0 means empty cell.
 *
 * Dynamic entities with GridPosition + SpatialLink are registered here via
 * {@link insertIntoSpatialGrid} and removed via {@link removeFromSpatialGrid}.
 * Terrain solidity is NOT stored here — it lives in `_terrain.cost`.
 */
let _spatialGrid: Uint32Array | undefined;

/** Width of the spatial grid in tiles. */
let _gridWidth = 0;

/** Height of the spatial grid in tiles. */
let _gridHeight = 0;

/**
 * Membership set — entities currently linked into the occupancy grid.
 *
 * Guard for the GridPosition sync system (C-379): an entity whose pointers
 * were zeroed by a previous removal is indistinguishable from a never-inserted
 * entity by SpatialLink alone, and `removeFromSpatialGrid` on a non-member
 * would treat it as the head of its (old) cell and wipe the real head.
 */
const _gridMembership = new Set<number>();

// ---------------------------------------------------------------------------
// Public: TerrainGrid API (C-379 canonical)
// ---------------------------------------------------------------------------

/**
 * Sets the active terrain grid for the current scene.
 *
 * Also initializes the spatial grid to match the terrain dimensions.
 * No wall entities are created — terrain solidity lives in the cost grid.
 *
 * @param terrain - The terrain grid (cost + blocksSight).
 * @param _world - Retained for API symmetry with the legacy setCollisionGrid;
 *   no entities are created from terrain.
 */
export const setTerrainGrid = (terrain: TerrainGrid, _world?: World): void => {
  _terrain = terrain;

  _mapPixelWidth = terrain.width * terrain.tileSize;
  _mapPixelHeight = terrain.height * terrain.tileSize;

  initializeSpatialGrid(terrain.width, terrain.height);
};

/**
 * Returns the currently active terrain grid, or undefined when none is set.
 */
export const getTerrainGrid = (): TerrainGrid | undefined => _terrain;

/**
 * Returns the active map tile size in world pixels.
 *
 * Reads from the terrain grid; falls back to 32 for callers that run
 * before any map is loaded (boot-time spawns, unit tests without a grid).
 */
export const getTerrainTileSize = (): number => _terrain?.tileSize ?? 32;

/**
 * Mutates the terrain cost at a grid cell at runtime.
 *
 * The runtime-toggle capability the wall entities were reaching for
 * (doors, bridges, destructibles): set `0` to make the cell impassable,
 * or a positive cost (× 16) to open it. Also updates blocksSight so a
 * closed door blocks vision and an open door does not.
 *
 * @param gx - Grid X coordinate.
 * @param gy - Grid Y coordinate.
 * @param cost - New cost (0 = impassable, else cost × 16).
 */
export const setTerrainCellCost = (gx: number, gy: number, cost: number): void => {
  if (!_terrain) {
    return;
  }
  if (gx < 0 || gx >= _terrain.width || gy < 0 || gy >= _terrain.height) {
    return;
  }
  const index = gy * _terrain.width + gx;
  // Compute the clamped, rounded terrain cost ONCE and store it — the
  // Uint8Array would otherwise wrap out-of-range values (256 → 0 =
  // impassable, 320 → 64 = artificially cheap). blocksSight derives from
  // the SAME stored value so the two grids stay consistent (CodeRabbit
  // review, C-379).
  const stored = Math.max(0, Math.min(255, Math.round(cost)));
  _terrain.cost[index] = stored;
  _terrain.blocksSight[index] = stored === 0 ? 1 : 0;
};

/**
 * Returns whether a grid cell blocks line of sight.
 *
 * @param gx - Grid X coordinate.
 * @param gy - Grid Y coordinate.
 * @returns `true` when the cell blocks LOS (out of bounds = blocked).
 */
export const isBlocksSight = (gx: number, gy: number): boolean => {
  if (!_terrain) {
    return false;
  }
  if (gx < 0 || gx >= _terrain.width || gy < 0 || gy >= _terrain.height) {
    return true;
  }
  return _terrain.blocksSight[gy * _terrain.width + gx] === 1;
};

// ---------------------------------------------------------------------------
// Public: Legacy API
// ---------------------------------------------------------------------------

/**
 * Sets the active terrain grid from a legacy boolean collision grid.
 *
 * C-379 compatibility adapter: converts the boolean grid to a TerrainGrid
 * (cost 0/16, blocksSight = solidity) and installs it. No wall entities are
 * created — the contract deleted `_populateWallsFromCollisionGrid`.
 *
 * @param grid - The collision grid parsed from the map's collision layer.
 * @param world - Retained for API symmetry; ignored (no walls are spawned).
 */
export const setCollisionGrid = (grid: CollisionGrid, world?: World): void => {
  setTerrainGrid(buildTerrainGridFromBoolean(grid), world);
};

/**
 * Clears the active terrain grid and spatial grid.
 */
export const resetCollisionGrid = (): void => {
  _terrain = undefined;
  _spatialGrid = undefined;
  _gridWidth = 0;
  _gridHeight = 0;
  _mapPixelWidth = 0;
  _mapPixelHeight = 0;
  _gridMembership.clear();
  clearBresenhamGrid();
};

/**
 * Returns the absolute map bounds in world-space pixels.
 *
 * Both values are `0` when no terrain grid is active — callers should
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
 * Checks whether a pixel coordinate is walkable (terrain-only oracle).
 *
 * C-379: pure terrain lookup against the cost grid — `true` when the cell
 * cost is non-zero, `false` when impassable (cost 0). Entity occupancy is
 * NOT consulted here; callers that need entity awareness use the composite
 * `isCellBlocked(tx, ty, <mask>) || !isWalkable(px, py)`.
 *
 * @param pixelX - X position in pixels.
 * @param pixelY - Y position in pixels.
 * @returns `true` if the tile at the given pixel position is walkable.
 */
export const isWalkable = (pixelX: number, pixelY: number): boolean => {
  if (!_terrain) {
    return true;
  }

  // Absolute pixel-space bounds — any coordinate outside the map is blocked.
  if (!isWithinMapBounds(pixelX, pixelY)) {
    return false;
  }

  const tileX = Math.floor(pixelX / _terrain.tileSize);
  const tileY = Math.floor(pixelY / _terrain.tileSize);

  // Out-of-bounds = blocked
  if (tileX < 0 || tileX >= _terrain.width || tileY < 0 || tileY >= _terrain.height) {
    return false;
  }

  const index = tileY * _terrain.width + tileX;
  return _terrain.cost[index] !== 0;
};

// ---------------------------------------------------------------------------
// Spatial Grid API (C-173) — dynamic occupancy only
// ---------------------------------------------------------------------------

/**
 * Initializes the occupancy grid to the given dimensions.
 *
 * Allocates a `Uint32Array` of size `width * height` filled with zeros
 * (empty cells). Only ONE grid is active at a time — calling this replaces
 * any previous grid and clears membership tracking.
 *
 * @param width - Grid width in tiles.
 * @param height - Grid height in tiles.
 */
export const initializeSpatialGrid = (width: number, height: number): void => {
  _gridWidth = width;
  _gridHeight = height;
  _spatialGrid = new Uint32Array(width * height);
  _gridMembership.clear();

  // Wire the grid into the Bresenham raycaster (C-174) plus the terrain
  // cost oracle so LOS checks see terrain walls (C-379 — walls are no
  // longer entities in the spatial grid).
  setBresenhamGrid(_spatialGrid, width, height);
  setBresenhamTerrain(
    _terrain?.cost,
    _terrain?.blocksSight,
    _terrain?.width ?? width,
    _terrain?.height ?? height,
  );
};

/**
 * Returns whether an entity is currently linked into the occupancy grid.
 *
 * Used by the GridPosition sync system to avoid removing a non-member
 * (which would corrupt the old cell's linked list).
 *
 * @param eid - The entity ID.
 * @returns `true` when the entity is a member of some cell's list.
 */
export const isEntityInSpatialGrid = (eid: number): boolean => _gridMembership.has(eid);

/**
 * Reads the head EID of a spatial-grid cell (test/observability helper).
 *
 * Returns 0 for an empty cell, the head entity ID otherwise. Out-of-bounds
 * returns 0.
 *
 * @param x - Grid X coordinate.
 * @param y - Grid Y coordinate.
 * @returns The head entity ID, or 0 when empty/OOB.
 */
export const peekSpatialGridHead = (x: number, y: number): number => {
  if (!_spatialGrid) {
    return 0;
  }
  const index = _gridIndex(x, y);
  if (index < 0) {
    return 0;
  }
  return _spatialGrid[index];
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
 * Inserts an entity into the occupancy grid at its GridPosition.
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
  _gridMembership.add(eid);
};

/**
 * Removes an entity from the occupancy grid.
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
  _gridMembership.delete(eid);
};

// ---------------------------------------------------------------------------
// Bitmask collision check (dynamic occupancy)
// ---------------------------------------------------------------------------

/**
 * Checks whether a moving entity can enter a grid cell occupied by
 * dynamic entities in the spatial grid's linked list.
 *
 * A collision occurs when `moverMask & occupantLayer !== 0` for any
 * occupant in the cell. Returns `true` if the move is blocked.
 *
 * The mover's OWN entity is excluded (C-379): a mover whose mask includes
 * its own layer (e.g. an NPC with NPC_COLLISION_MASK containing `npc`)
 * must not block itself by standing in the cell its collision box spans.
 *
 * Terrain solidity is NOT checked here — use the composite
 * `isCellBlocked(...) || !isWalkable(...)` (C-379).
 *
 * @param destX - Destination grid X coordinate.
 * @param destY - Destination grid Y coordinate.
 * @param moverMask - Bitmask of what the moving entity collides with.
 * @param selfEid - The moving entity's own ID (excluded from the scan).
 * @returns `true` if movement is blocked (collision detected).
 */
export const isCellBlocked = (
  destX: number,
  destY: number,
  moverMask: number,
  selfEid = 0,
): boolean => {
  // ── Absolute map tile boundary — checked FIRST, before any spatial grid ──
  if (_terrain) {
    if (destX < 0 || destX >= _terrain.width || destY < 0 || destY >= _terrain.height) {
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
    if (current === selfEid) {
      current = SpatialLink.next[current] ?? 0;
      continue;
    }
    const layer = CollisionData.layer[current] ?? 0;
    if ((moverMask & layer) !== 0) {
      return true; // Collision detected
    }
    current = SpatialLink.next[current] ?? 0;
  }

  return false;
};
