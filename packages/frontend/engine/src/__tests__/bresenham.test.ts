// packages/frontend/engine/src/__tests__/bresenham.test.ts

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { CollisionData, CollisionLayer } from '../components/collision_data.ts';
import { SpatialLink } from '../components/spatial_link.ts';
import { checkLineOfSight, clearBresenhamGrid, setBresenhamGrid } from '../math/bresenham.ts';

// ---------------------------------------------------------------------------
// Test helpers — set up a 20×15 spatial grid with wall entities
// ---------------------------------------------------------------------------

const GRID_W = 20;
const GRID_H = 15;

/** Allocates a fresh test grid and wires it into the raycaster. */
const _setupGrid = (): Uint32Array => {
  const grid = new Uint32Array(GRID_W * GRID_H);
  setBresenhamGrid(grid, GRID_W, GRID_H);
  return grid;
};

/** Places a wall entity at the given grid cell. */
const _placeWall = (grid: Uint32Array, gx: number, gy: number, eid: number): void => {
  const index = gy * GRID_W + gx;

  if (!CollisionData.layer[eid]) {
    CollisionData.layer[eid] = CollisionLayer.wall;
    CollisionData.mask[eid] = 0;
    SpatialLink.next[eid] = 0;
    SpatialLink.prev[eid] = 0;
  }

  // Head-insert into the linked list for this cell
  const oldHead = grid[index];
  SpatialLink.next[eid] = oldHead;
  SpatialLink.prev[eid] = 0;
  if (oldHead !== 0) {
    SpatialLink.prev[oldHead] = eid;
  }
  grid[index] = eid;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkLineOfSight — Bresenham raycaster', () => {
  let grid: Uint32Array;

  beforeEach(() => {
    grid = _setupGrid();
  });

  afterEach(() => {
    clearBresenhamGrid();
  });

  // -- Basic paths ---------------------------------------------------------

  test('clear horizontal line (positive X)', () => {
    expect(checkLineOfSight(0, 5, 10, 5, CollisionLayer.wall)).toBe(true);
  });

  test('clear vertical line (positive Y)', () => {
    expect(checkLineOfSight(5, 0, 5, 10, CollisionLayer.wall)).toBe(true);
  });

  test('clear diagonal line (positive slope)', () => {
    expect(checkLineOfSight(0, 0, 10, 10, CollisionLayer.wall)).toBe(true);
  });

  test('clear diagonal line (negative X, positive Y)', () => {
    expect(checkLineOfSight(10, 0, 0, 10, CollisionLayer.wall)).toBe(true);
  });

  test('clear line with steep slope (dy > dx)', () => {
    expect(checkLineOfSight(10, 0, 10, 14, CollisionLayer.wall)).toBe(true);
  });

  test('clear line with shallow slope (dx > dy)', () => {
    expect(checkLineOfSight(0, 10, 19, 10, CollisionLayer.wall)).toBe(true);
  });

  test('same cell is trivially visible', () => {
    expect(checkLineOfSight(5, 5, 5, 5, CollisionLayer.wall)).toBe(true);
  });

  test('adjacent cell is visible with no walls', () => {
    expect(checkLineOfSight(5, 5, 6, 5, CollisionLayer.wall)).toBe(true);
  });

  // -- All 8 octants -------------------------------------------------------

  test('octant 1: positive shallow (dx > dy, both positive)', () => {
    expect(checkLineOfSight(0, 0, 10, 3, CollisionLayer.wall)).toBe(true);
  });

  test('octant 2: positive steep (dy > dx, both positive)', () => {
    expect(checkLineOfSight(0, 0, 3, 10, CollisionLayer.wall)).toBe(true);
  });

  test('octant 3: negative steep (dy > |dx|, negative X)', () => {
    expect(checkLineOfSight(5, 0, 2, 10, CollisionLayer.wall)).toBe(true);
  });

  test('octant 4: negative shallow (|dx| > dy, negative X)', () => {
    expect(checkLineOfSight(10, 0, 0, 3, CollisionLayer.wall)).toBe(true);
  });

  test('octant 5: negative shallow (dx > |dy|, negative Y)', () => {
    expect(checkLineOfSight(0, 10, 10, 7, CollisionLayer.wall)).toBe(true);
  });

  test('octant 6: negative steep (dy > |dx|, negative Y)', () => {
    expect(checkLineOfSight(0, 10, 3, 0, CollisionLayer.wall)).toBe(true);
  });

  test('octant 7: negative Y, positive X, steep', () => {
    expect(checkLineOfSight(5, 10, 8, 0, CollisionLayer.wall)).toBe(true);
  });

  test('octant 8: negative Y, positive X, shallow', () => {
    expect(checkLineOfSight(0, 10, 10, 7, CollisionLayer.wall)).toBe(true);
  });

  // -- Occlusion -----------------------------------------------------------

  test('wall in the middle blocks horizontal line', () => {
    _placeWall(grid, 5, 5, 100);
    expect(checkLineOfSight(0, 5, 10, 5, CollisionLayer.wall)).toBe(false);
  });

  test('wall in the middle blocks diagonal line', () => {
    _placeWall(grid, 5, 5, 100);
    expect(checkLineOfSight(0, 0, 10, 10, CollisionLayer.wall)).toBe(false);
  });

  test('wall adjacent to start does NOT block (start cell skipped)', () => {
    _placeWall(grid, 0, 0, 100);
    expect(checkLineOfSight(0, 0, 10, 0, CollisionLayer.wall)).toBe(true);
  });

  test('wall adjacent to end does NOT block (target cell skipped)', () => {
    _placeWall(grid, 10, 5, 100);
    expect(checkLineOfSight(0, 5, 10, 5, CollisionLayer.wall)).toBe(true);
  });

  test('wall one cell away from start DOES block', () => {
    _placeWall(grid, 1, 5, 100);
    expect(checkLineOfSight(0, 5, 10, 5, CollisionLayer.wall)).toBe(false);
  });

  test('wall one cell away from end DOES block', () => {
    _placeWall(grid, 9, 5, 100);
    expect(checkLineOfSight(0, 5, 10, 5, CollisionLayer.wall)).toBe(false);
  });

  // -- Mask filtering ------------------------------------------------------

  test('non-matching layer does NOT block (sightMask = wall, entity = npc)', () => {
    // Place an NPC at the intermediate cell
    const eid = 200;
    CollisionData.layer[eid] = CollisionLayer.npc;
    CollisionData.mask[eid] = 0;
    SpatialLink.next[eid] = 0;
    SpatialLink.prev[eid] = 0;
    grid[5 * GRID_W + 5] = eid;

    // sightMask = wall only — NPC should NOT block
    expect(checkLineOfSight(0, 5, 10, 5, CollisionLayer.wall)).toBe(true);
  });

  test('matching wall-layer blocks with wall sightMask', () => {
    _placeWall(grid, 5, 5, 100);
    expect(checkLineOfSight(0, 5, 10, 5, CollisionLayer.wall)).toBe(false);

    // Now with a different mask that excludes walls
    expect(checkLineOfSight(0, 5, 10, 5, CollisionLayer.npc | CollisionLayer.enemy)).toBe(true);
  });

  test('sightMask matching multiple layers', () => {
    const wallEid = 300;
    CollisionData.layer[wallEid] = CollisionLayer.wall;
    CollisionData.mask[wallEid] = 0;
    SpatialLink.next[wallEid] = 0;
    SpatialLink.prev[wallEid] = 0;
    grid[5 * GRID_W + 5] = wallEid;

    // Combined mask that includes walls blocks
    expect(checkLineOfSight(0, 5, 10, 5, CollisionLayer.wall | CollisionLayer.npc)).toBe(false);

    // Mask that excludes walls does not block
    expect(checkLineOfSight(0, 5, 10, 5, CollisionLayer.npc | CollisionLayer.enemy)).toBe(true);
  });

  // -- Linked list traversal (multiple entities in same cell) ---------------

  test('second entity in same cell with matching layer blocks', () => {
    // Place NPC first (doesn't block walls)
    const npcEid = 400;
    CollisionData.layer[npcEid] = CollisionLayer.npc;
    CollisionData.mask[npcEid] = 0;
    SpatialLink.next[npcEid] = 0;
    SpatialLink.prev[npcEid] = 0;
    grid[5 * GRID_W + 5] = npcEid;

    // Then place wall in same cell (head insertion)
    _placeWall(grid, 5, 5, 401);

    // Wall is at head (401), NPC is at next (400)
    expect(checkLineOfSight(0, 5, 10, 5, CollisionLayer.wall)).toBe(false);
  });

  test('linked list traversal continues past non-matching entities', () => {
    // Place wall second, NPC first — wall is head
    _placeWall(grid, 5, 5, 500);
    const itemEid = 501;
    CollisionData.layer[itemEid] = CollisionLayer.item;
    CollisionData.mask[itemEid] = 0;
    SpatialLink.next[itemEid] = 0;
    SpatialLink.prev[itemEid] = 500;
    SpatialLink.next[500] = itemEid;

    // Wall at head (500) blocks with wall sightMask
    expect(checkLineOfSight(0, 5, 10, 5, CollisionLayer.wall)).toBe(false);
  });

  // -- Bounds checking -----------------------------------------------------

  test('start out of bounds returns false', () => {
    expect(checkLineOfSight(-1, 5, 10, 5, CollisionLayer.wall)).toBe(false);
  });

  test('end out of bounds returns false', () => {
    expect(checkLineOfSight(0, 5, GRID_W, 5, CollisionLayer.wall)).toBe(false);
  });

  test('negative Y out of bounds returns false', () => {
    expect(checkLineOfSight(5, -1, 5, 10, CollisionLayer.wall)).toBe(false);
  });

  // -- Edge cases ----------------------------------------------------------

  test('vertical wall line blocks vertical ray', () => {
    // Create a vertical wall at x=5, from y=0 to y=14
    for (let y = 0; y < GRID_H; y++) {
      const eid = 600 + y;
      CollisionData.layer[eid] = CollisionLayer.wall;
      CollisionData.mask[eid] = 0;
      SpatialLink.next[eid] = 0;
      SpatialLink.prev[eid] = 0;
      grid[y * GRID_W + 5] = eid;
    }

    // Ray from x=0 to x=10 at y=7 — should hit the wall at x=5
    expect(checkLineOfSight(0, 7, 10, 7, CollisionLayer.wall)).toBe(false);
  });

  test('no grid initialized returns true (no LOS checks)', () => {
    clearBresenhamGrid();
    expect(checkLineOfSight(0, 0, 10, 10, CollisionLayer.wall)).toBe(true);
  });
});
