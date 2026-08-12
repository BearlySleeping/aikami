// packages/frontend/engine/src/systems/grid_position_sync_system.ts
//
// GridPositionSyncSystem — the ONE place GridPosition is derived from
// Position (C-379 AC-1).
//
// Every entity carrying both Position and GridPosition gets its GridPosition
// recomputed from `floor(Position / tileSize)` each tick. On a cell change
// the occupancy grid is maintained: the entity is removed from its old
// cell's intrusive list and inserted into the new cell's list. Within one
// cell the update is a no-op — re-inserting into the same list would corrupt
// the intrusive linked list (an entity appearing twice makes removeFromSpatialGrid
// unlink the wrong node).
//
// Exactly one writer: this system is the sole place GridPosition is updated
// from Position. Spawners may set the initial GridPosition (matching the
// initial Position), but every subsequent change goes through here.

import type { World } from 'bitecs';
import { addComponent, query, set } from 'bitecs';
import { GridPosition } from '../components/grid_position.ts';
import { Position } from '../components/position.ts';
import { SpatialLink } from '../components/spatial_link.ts';
import {
  getTerrainTileSize,
  insertIntoSpatialGrid,
  isEntityInSpatialGrid,
  removeFromSpatialGrid,
} from './collision_system.ts';

/** Cached query terms — created once per world to avoid per-frame overhead. */
const SYNC_QUERY_TERMS = [Position, GridPosition];

/**
 * Syncs GridPosition from Position for every entity that has both.
 *
 * Change-gated (AC-1 watch point): entities that stay within one cell do
 * nothing, so the sync cost is O(moving entities), never O(all entities).
 * On a cell change the entity is removed from the OLD cell's list, its
 * GridPosition is updated, and it is inserted into the NEW cell's list.
 *
 * Entities that carry SpatialLink but were never inserted (e.g. the player
 * spawned with collision components before the grid existed) are inserted
 * on first sight — a cell change or a membership miss.
 *
 * Must run AFTER updateMovement in the tick so GridPosition reflects the
 * resolved Position, and BEFORE perception/cognition consumers read it.
 *
 * @param world - The bitECS world.
 */
export const syncGridPositions = (world: World): void => {
  const tileSize = getTerrainTileSize();
  if (tileSize <= 0) {
    return;
  }

  for (const eid of query(world, SYNC_QUERY_TERMS)) {
    const posX = Position.x[eid];
    const posY = Position.y[eid];
    if (posX === undefined || posY === undefined) {
      continue;
    }

    const hasSpatialLink =
      SpatialLink.next[eid] !== undefined || SpatialLink.prev[eid] !== undefined;

    const newGx = Math.floor(posX / tileSize);
    const newGy = Math.floor(posY / tileSize);

    const oldGx = GridPosition.x[eid];
    const oldGy = GridPosition.y[eid];

    if (oldGx === newGx && oldGy === newGy) {
      // Same cell — but a link-bearing entity that somehow missed insertion
      // must still be registered (first-sight fix).
      if (hasSpatialLink && !isEntityInSpatialGrid(eid)) {
        insertIntoSpatialGrid(eid);
      }
      continue; // Same cell — no-op (guards against list corruption)
    }

    // Remove from the old cell ONLY if actually linked (a never-inserted
    // entity must not be treated as the head of its old cell).
    if (isEntityInSpatialGrid(eid)) {
      removeFromSpatialGrid(eid);
    }

    addComponent(world, eid, set(GridPosition, { x: newGx, y: newGy }));

    // Entities with GridPosition but no SpatialLink (never-inserted
    // observers, plain synced markers) are updated but never occupy a cell.
    if (hasSpatialLink) {
      insertIntoSpatialGrid(eid);
    }
  }
};
