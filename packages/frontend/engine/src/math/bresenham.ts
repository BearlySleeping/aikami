// packages/frontend/engine/src/math/bresenham.ts

import { CollisionData } from '../components/collision_data.ts';
import { SpatialLink } from '../components/spatial_link.ts';

// ---------------------------------------------------------------------------
// Bresenham Line-of-Sight Raycaster — zero-allocation pure function
//
// Contract C-174: Adapts Bresenham's line algorithm into an allocation-free
// ECS raycaster. Interrogates the dense 1D SpatialGrid cell-by-cell using
// integer math. Terminates early if a cell contains an entity whose
// CollisionData.layer matches the sightMask.
//
// Design:
//   - Pure function: no heap allocations, no arrays, boolean return only
//   - Handles all 8 octants (positive/negative slopes, steep/shallow)
//   - Skips origin and target cells (self-occlusion guard)
//   - Bounds-checked against map dimensions
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Module-level access to the spatial grid
//
// The spatial grid is managed by collision_system.ts as a module-level
// singleton. This module reads it via these exported getter/setter
// functions, avoiding circular imports while keeping the raycaster
// pure (zero dependency on World or bitECS queries).
// ---------------------------------------------------------------------------

/** Reference to the spatial grid Uint32Array from collision_system. */
let _gridRef: Uint32Array | undefined;

/** Grid width in tiles. */
let _gridW = 0;

/** Grid height in tiles. */
let _gridH = 0;

/**
 * Sets the spatial grid reference for the raycaster.
 *
 * Called by collision_system when the spatial grid is initialized.
 *
 * @param grid - The Uint32Array spatial grid.
 * @param width - Grid width in tiles.
 * @param height - Grid height in tiles.
 */
export const setBresenhamGrid = (grid: Uint32Array, width: number, height: number): void => {
  _gridRef = grid;
  _gridW = width;
  _gridH = height;
};

/**
 * Clears the spatial grid reference.
 *
 * Called by collision_system when the grid is reset.
 */
export const clearBresenhamGrid = (): void => {
  _gridRef = undefined;
  _gridW = 0;
  _gridH = 0;
};

// ---------------------------------------------------------------------------
// checkLineOfSight — zero-allocation Bresenham raycaster
// ---------------------------------------------------------------------------

/**
 * Checks whether a line-of-sight path between two grid coordinates is
 * clear of obstructing entities.
 *
 * Uses Bresenham's integer line algorithm to traverse grid cells from
 * `(startX, startY)` to `(endX, endY)`. At each intermediate cell,
 * walks the spatial grid's intrusive linked list and checks if any
 * entity's `CollisionData.layer` matches the `sightMask` via bitwise
 * AND. If a match is found, returns `false` (blocked).
 *
 * Origin and target cells are NOT checked — this prevents the start
 * and end entities from blocking their own line of sight.
 *
 * Allocates 0 bytes on the heap. Pure integer arithmetic only.
 *
 * @param startX - Starting grid X coordinate.
 * @param startY - Starting grid Y coordinate.
 * @param endX - Target grid X coordinate.
 * @param endY - Target grid Y coordinate.
 * @param sightMask - Bitmask defining what blocks vision
 *   (e.g., `CollisionLayer.wall` for solid walls).
 * @returns `true` if the line is unobstructed, `false` if blocked or
 *   out of bounds.
 */
export const checkLineOfSight = (
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  sightMask: number,
): boolean => {
  // Validate grid exists
  if (!_gridRef || _gridW <= 0 || _gridH <= 0) {
    return true; // No grid = no LOS checks = everything visible
  }

  // Bounds-check start and end
  if (
    startX < 0 ||
    startX >= _gridW ||
    startY < 0 ||
    startY >= _gridH ||
    endX < 0 ||
    endX >= _gridW ||
    endY < 0 ||
    endY >= _gridH
  ) {
    return false;
  }

  // Same cell — trivially visible (no intermediate cells to check)
  if (startX === endX && startY === endY) {
    return true;
  }

  // ── Bresenham's line algorithm (integer-only, all 8 octants) ──
  let x = startX;
  let y = startY;

  const dx = Math.abs(endX - startX);
  const dy = Math.abs(endY - startY);

  const sx = startX < endX ? 1 : -1;
  const sy = startY < endY ? 1 : -1;

  let err = dx - dy;

  let firstStep = true; // Skip origin cell

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Check current cell (skip origin and target)
    if (!firstStep && (x !== endX || y !== endY)) {
      if (_isCellBlocking(x, y, sightMask)) {
        return false;
      }
    }
    firstStep = false;

    // Reached target — line is clear
    if (x === endX && y === endY) {
      return true;
    }

    // Compute next cell via error accumulation
    const e2 = 2 * err;

    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }

    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
};

// ---------------------------------------------------------------------------
// Internal: cell occlusion check
// ---------------------------------------------------------------------------

/**
 * Checks whether a grid cell is blocked for line-of-sight purposes.
 *
 * Walks the spatial grid's intrusive linked list at the given cell
 * and checks each entity's `CollisionData.layer` against `sightMask`
 * via bitwise AND. Returns `true` if any entity matches.
 *
 * Empty cells (grid value 0) return `false`.
 *
 * @param gx - Grid X coordinate.
 * @param gy - Grid Y coordinate.
 * @param sightMask - Bitmask to check against entity layers.
 * @returns `true` if the cell blocks line of sight.
 */
const _isCellBlocking = (gx: number, gy: number, sightMask: number): boolean => {
  if (!_gridRef) {
    return false;
  }

  const flatIndex = gy * _gridW + gx;
  const headEid = _gridRef[flatIndex];

  if (headEid === 0) {
    return false;
  }

  // Walk the linked list
  let current = headEid;
  while (current !== 0) {
    const layer = CollisionData.layer[current] ?? 0;
    if ((sightMask & layer) !== 0) {
      return true;
    }
    current = SpatialLink.next[current] ?? 0;
  }

  return false;
};
