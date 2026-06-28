// packages/frontend/engine/src/__tests__/spatial_grid.test.ts
//
// Spatial Hash Grid boundary unit tests.
// Contract C-180 AC-1: Strict Boundary Unit Testing
//
// Verifies that isCellBlocked, isWalkable, and spatial grid operations
// handle out-of-bounds coordinates without typed-array exceptions,
// returning safe default values (blocked / false) at all map edges.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { CollisionData, CollisionLayer } from '../components/collision_data.ts';
import { GridPosition } from '../components/grid_position.ts';
import { SpatialLink } from '../components/spatial_link.ts';
import {
  type CollisionGrid,
  initializeSpatialGrid,
  insertIntoSpatialGrid,
  isCellBlocked,
  isWalkable,
  moveInSpatialGrid,
  removeFromSpatialGrid,
  resetCollisionGrid,
  setCollisionGrid,
} from '../systems/collision_system.ts';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const MAP_W = 10;
const MAP_H = 10;
const TILE_SIZE = 32;

/** A minimal 10×10 collision grid with a wall border and open interior. */
const _makeBorderGrid = (): CollisionGrid => {
  const grid: boolean[] = [];
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      grid.push(x === 0 || x === MAP_W - 1 || y === 0 || y === MAP_H - 1);
    }
  }
  return { width: MAP_W, height: MAP_H, tileSize: TILE_SIZE, grid };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Allocates a fresh CollisionData + SpatialLink slot for a test entity. */
const _makeEntity = (eid: number, gx: number, gy: number): void => {
  GridPosition.x[eid] = gx;
  GridPosition.y[eid] = gy;
  CollisionData.layer[eid] = CollisionLayer.wall;
  CollisionData.mask[eid] = 0;
  SpatialLink.next[eid] = 0;
  SpatialLink.prev[eid] = 0;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isCellBlocked — boundary clamping', () => {
  beforeEach(() => {
    initializeSpatialGrid(MAP_W, MAP_H);
  });

  afterEach(() => {
    resetCollisionGrid();
  });

  test('returns true for negative x (dx: -1 at grid edge)', () => {
    expect(isCellBlocked(-1, 0, CollisionLayer.player)).toBe(true);
  });

  test('returns true for negative y', () => {
    expect(isCellBlocked(0, -1, CollisionLayer.player)).toBe(true);
  });

  test('returns true for x >= map width', () => {
    expect(isCellBlocked(MAP_W, 0, CollisionLayer.player)).toBe(true);
  });

  test('returns true for y >= map height', () => {
    expect(isCellBlocked(0, MAP_H, CollisionLayer.player)).toBe(true);
  });

  test('returns false for empty grid without spatial grid (no grid)', () => {
    resetCollisionGrid();
    expect(isCellBlocked(5, 5, CollisionLayer.player)).toBe(false);
  });

  test('returns false for valid cell with no entities', () => {
    expect(isCellBlocked(5, 5, CollisionLayer.player)).toBe(false);
  });

  test('returns true for cell with wall entity', () => {
    _makeEntity(10, 5, 5);
    insertIntoSpatialGrid(10);
    expect(isCellBlocked(5, 5, CollisionLayer.player | CollisionLayer.wall)).toBe(true);
  });

  test('returns false for cell with wall entity but non-matching mask', () => {
    _makeEntity(11, 5, 5);
    insertIntoSpatialGrid(11);
    // Mover mask doesn't include wall → no collision
    expect(isCellBlocked(5, 5, CollisionLayer.npc)).toBe(false);
  });
});

describe('isWalkable — boundary clamping', () => {
  beforeEach(() => {
    setCollisionGrid(_makeBorderGrid());
  });

  afterEach(() => {
    resetCollisionGrid();
  });

  test('returns false for negative pixel x', () => {
    expect(isWalkable(-1, 160)).toBe(false);
  });

  test('returns false for negative pixel y', () => {
    expect(isWalkable(160, -1)).toBe(false);
  });

  test('returns false for pixel x beyond map width', () => {
    expect(isWalkable(MAP_W * TILE_SIZE + 1, 160)).toBe(false);
  });

  test('returns false for pixel y beyond map height', () => {
    expect(isWalkable(160, MAP_H * TILE_SIZE + 1)).toBe(false);
  });

  test('returns true for interior cell', () => {
    expect(isWalkable(160, 160)).toBe(true);
  });

  test('returns false for border wall cell', () => {
    expect(isWalkable(0, 0)).toBe(false);
  });

  test('returns true when no collision grid is set', () => {
    resetCollisionGrid();
    expect(isWalkable(-100, -100)).toBe(true);
  });
});

describe('insertIntoSpatialGrid — OOB handling', () => {
  beforeEach(() => {
    initializeSpatialGrid(MAP_W, MAP_H);
  });

  afterEach(() => {
    resetCollisionGrid();
  });

  test('does not throw for negative x position', () => {
    _makeEntity(1, -1, 5);
    expect(() => insertIntoSpatialGrid(1)).not.toThrow();
  });

  test('does not throw for negative y position', () => {
    _makeEntity(1, 5, -1);
    expect(() => insertIntoSpatialGrid(1)).not.toThrow();
  });

  test('does not throw for x >= map width', () => {
    _makeEntity(1, MAP_W, 5);
    expect(() => insertIntoSpatialGrid(1)).not.toThrow();
  });

  test('does not throw for y >= map height', () => {
    _makeEntity(1, 5, MAP_H);
    expect(() => insertIntoSpatialGrid(1)).not.toThrow();
  });

  test('does not throw for eid 0', () => {
    expect(() => insertIntoSpatialGrid(0)).not.toThrow();
  });

  test('does not throw without initialized grid', () => {
    resetCollisionGrid();
    _makeEntity(1, 5, 5);
    expect(() => insertIntoSpatialGrid(1)).not.toThrow();
  });

  test('inserts entity at valid position', () => {
    _makeEntity(1, 5, 5);
    insertIntoSpatialGrid(1);
    // Entity inserted — isCellBlocked should detect it
    expect(isCellBlocked(5, 5, CollisionLayer.wall)).toBe(true);
  });
});

describe('removeFromSpatialGrid — OOB handling', () => {
  beforeEach(() => {
    initializeSpatialGrid(MAP_W, MAP_H);
  });

  afterEach(() => {
    resetCollisionGrid();
  });

  test('does not throw for negative x position', () => {
    _makeEntity(1, -1, 5);
    expect(() => removeFromSpatialGrid(1)).not.toThrow();
  });

  test('does not throw for negative y position', () => {
    _makeEntity(1, 5, -1);
    expect(() => removeFromSpatialGrid(1)).not.toThrow();
  });

  test('does not throw for x >= map width', () => {
    _makeEntity(1, MAP_W, 5);
    expect(() => removeFromSpatialGrid(1)).not.toThrow();
  });

  test('does not throw for y >= map height', () => {
    _makeEntity(1, 5, MAP_H);
    expect(() => removeFromSpatialGrid(1)).not.toThrow();
  });

  test('does not throw for eid 0', () => {
    expect(() => removeFromSpatialGrid(0)).not.toThrow();
  });

  test('does not throw without initialized grid', () => {
    resetCollisionGrid();
    _makeEntity(1, 5, 5);
    expect(() => removeFromSpatialGrid(1)).not.toThrow();
  });

  test('removes entity from valid position', () => {
    _makeEntity(1, 5, 5);
    insertIntoSpatialGrid(1);
    expect(isCellBlocked(5, 5, CollisionLayer.wall)).toBe(true);
    removeFromSpatialGrid(1);
    expect(isCellBlocked(5, 5, CollisionLayer.wall)).toBe(false);
  });
});

describe('moveInSpatialGrid — OOB handling', () => {
  beforeEach(() => {
    initializeSpatialGrid(MAP_W, MAP_H);
  });

  afterEach(() => {
    resetCollisionGrid();
  });

  test('does not throw moving from valid to OOB x', () => {
    _makeEntity(1, 5, 5);
    insertIntoSpatialGrid(1);
    expect(() => moveInSpatialGrid(1, -1, 5)).not.toThrow();
  });

  test('does not throw moving from valid to OOB y', () => {
    _makeEntity(1, 5, 5);
    insertIntoSpatialGrid(1);
    expect(() => moveInSpatialGrid(1, 5, MAP_H)).not.toThrow();
  });

  test('entity position updates even when destination is OOB', () => {
    _makeEntity(1, 5, 5);
    insertIntoSpatialGrid(1);
    moveInSpatialGrid(1, -1, 5);
    // GridPosition is updated (moveInSpatialGrid sets new coords before insert)
    expect(GridPosition.x[1]).toBe(-1);
    expect(GridPosition.y[1]).toBe(5);
    // OOB entity is not in the spatial grid (insertIntoSpatialGrid returns early for OOB)
    expect(isCellBlocked(-1, 5, CollisionLayer.wall)).toBe(true); // OOB = blocked
  });

  test('entity is removed from old cell on move', () => {
    _makeEntity(1, 5, 5);
    insertIntoSpatialGrid(1);
    moveInSpatialGrid(1, 6, 5);
    expect(isCellBlocked(5, 5, CollisionLayer.wall)).toBe(false);
    expect(isCellBlocked(6, 5, CollisionLayer.wall)).toBe(true);
  });
});

describe('initializeSpatialGrid — dimensions', () => {
  afterEach(() => {
    resetCollisionGrid();
  });

  test('initializes grid of correct dimensions', () => {
    initializeSpatialGrid(20, 15);
    // Valid interior cell is not blocked
    expect(isCellBlocked(10, 7, CollisionLayer.player)).toBe(false);
    // OOB beyond grid dimensions is blocked
    expect(isCellBlocked(20, 7, CollisionLayer.player)).toBe(true);
    expect(isCellBlocked(10, 15, CollisionLayer.player)).toBe(true);
  });

  test('replaces previous grid on second call', () => {
    initializeSpatialGrid(5, 5);
    _makeEntity(1, 2, 2);
    insertIntoSpatialGrid(1);
    expect(isCellBlocked(2, 2, CollisionLayer.wall)).toBe(true);
    // Re-initialize with larger grid — entity at (2,2) is now gone
    initializeSpatialGrid(10, 10);
    expect(isCellBlocked(2, 2, CollisionLayer.wall)).toBe(false);
  });
});

describe('setCollisionGrid — spatial grid wiring', () => {
  afterEach(() => {
    resetCollisionGrid();
  });

  test('initializes spatial grid matching collision grid dimensions', () => {
    setCollisionGrid(_makeBorderGrid());
    // Border cell (0,0) should be blocked via both spatial and boolean grid
    expect(isWalkable(0, 0)).toBe(false);
    // Interior cell (5,5) should be walkable
    expect(isWalkable(160, 160)).toBe(true);
    // OOB pixel
    expect(isWalkable(-32, 160)).toBe(false);
  });
});
