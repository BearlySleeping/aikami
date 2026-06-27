// packages/frontend/engine/src/components/grid_position.ts

import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// GridPosition — integer tile-grid coordinates for spatial queries
//
// Contract C-173: Discrete integer grid position for spatial hash grid
// registration. Entities with GridPosition are tracked in the global
// SpatialGrid dense array. Used by CollisionSystem for bitmask-based
// collision resolution.
//
// Separate from Position (floating-point pixel coordinates for rendering)
// to keep the spatial query domain in integer tile space.
// ---------------------------------------------------------------------------

/** SoA storage for tile-grid positions. */
export const GridPosition = {
  /** Grid X coordinate (tile column). */
  x: [] as number[],
  /** Grid Y coordinate (tile row). */
  y: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type GridPositionData = {
  x: number;
  y: number;
};

/**
 * Registers onSet and onGet observers for the GridPosition component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerGridPositionObservers = (world: World): void => {
  observe(world, onSet(GridPosition), (eid: number, params: GridPositionData) => {
    GridPosition.x[eid] = params.x;
    GridPosition.y[eid] = params.y;
  });

  observe(
    world,
    onGet(GridPosition),
    (eid: number): GridPositionData => ({
      x: GridPosition.x[eid],
      y: GridPosition.y[eid],
    }),
  );
};
