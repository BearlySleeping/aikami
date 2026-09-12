// packages/frontend/engine/src/combat/combat_battlefield.ts
//
// ECS → `BattlefieldState` projection for Combat 2.0.
//
// This module is a PROJECTION, not a second authority. It reads the live
// `TerrainGrid` and the combat identity registry into the flat, serializable
// `BattlefieldState` the pure spatial/tactical modules consume, and performs no
// legality calculation of its own.
//
// Read-only: nothing here writes to the ECS world. Two calls on an unchanged
// world produce byte-identical output.
//
// Contract: C-515 AC-1, AC-8

import type { BattlefieldState, GridPoint } from '@aikami/types';
import { worldPixelToCell } from '@aikami/utils';
import type { World } from 'bitecs';
import { GridPosition } from '../components/grid_position.ts';
import { Position } from '../components/position.ts';
import { getTerrainGrid, getTerrainTileSize, isBlocksSight } from '../systems/collision_system.ts';
import { TERRAIN_COST_SCALE } from '../systems/terrain_grid.ts';
import type { CombatIdentityRegistry } from './combat_state_adapter.ts';
import { getCombatIdentityRegistry } from './combat_state_adapter.ts';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type SnapshotBattlefieldOptions = {
  /** Registry override — primarily for tests. */
  registry?: CombatIdentityRegistry;
};

/** Fallback battlefield when no map is loaded (mirrors the 1×1 legacy default). */
const EMPTY_BATTLEFIELD: BattlefieldState = { width: 1, height: 1, blockedCells: [] };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes a `TerrainGrid` cost byte into cell units: `0` stays impassable,
 * everything else is `>= 1` (the grid stores `cost × TERRAIN_COST_SCALE`).
 */
const toCellCost = (raw: number): number => {
  if (raw <= 0) {
    return 0;
  }
  return Math.max(1, Math.round(raw / TERRAIN_COST_SCALE));
};

/**
 * Cells occupied by the registered combatants.
 *
 * `GridPosition` is the canonical derivation (see `grid_position_sync_system`);
 * an entity that has not been synced yet falls back to quantizing its world
 * pixel `Position` through {@link worldPixelToCell} with the live tile size, so
 * this module introduces no tile-size literal of its own.
 */
const occupancyCells = (registry: CombatIdentityRegistry): GridPoint[] => {
  const tileSize = getTerrainTileSize();
  const cells: GridPoint[] = [];

  for (const { entityId } of registry.entries()) {
    const gridX = GridPosition.x[entityId];
    const gridY = GridPosition.y[entityId];
    if (typeof gridX === 'number' && typeof gridY === 'number') {
      cells.push({ x: gridX, y: gridY });
      continue;
    }
    const pixelX = Position.x[entityId];
    const pixelY = Position.y[entityId];
    if (typeof pixelX === 'number' && typeof pixelY === 'number') {
      cells.push(worldPixelToCell({ px: pixelX, py: pixelY, tileSize }));
    }
  }

  return cells;
};

// ---------------------------------------------------------------------------
// snapshotBattlefield
// ---------------------------------------------------------------------------

/**
 * Projects the live ECS terrain + occupancy into a schema-valid
 * {@link BattlefieldState}.
 *
 * - `movementCost` is the terrain cost grid in cells (`0` = impassable).
 * - `blocksSight` is the terrain-derived sight grid. Occupants never make a
 *   cell opaque — line of sight reads this grid only.
 * - `blockedCells` (the C-509 compatibility field) lists every cell a unit may
 *   not enter: terrain-solid cells plus occupied cells. The kernel's
 *   `validateMove` reads exactly this field, so the projection and the kernel
 *   agree on what is walkable.
 */
export const snapshotBattlefield = (
  world: World,
  options: SnapshotBattlefieldOptions = {},
): BattlefieldState => {
  const terrain = getTerrainGrid();
  if (terrain === undefined) {
    return { ...EMPTY_BATTLEFIELD, blockedCells: [] };
  }

  const { width, height } = terrain;
  const cellCount = width * height;
  const movementCost: number[] = new Array(cellCount);
  const blocksSight: boolean[] = new Array(cellCount);
  const blockedCells: GridPoint[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const cost = toCellCost(terrain.cost[index] ?? 0);
      movementCost[index] = cost;
      blocksSight[index] = isBlocksSight(x, y);
      if (cost === 0) {
        blockedCells.push({ x, y });
      }
    }
  }

  const registry = options.registry ?? getCombatIdentityRegistry(world);
  registry.sync(world);

  for (const cell of occupancyCells(registry)) {
    if (cell.x < 0 || cell.y < 0 || cell.x >= width || cell.y >= height) {
      continue;
    }
    const index = cell.y * width + cell.x;
    if (movementCost[index] === 0) {
      continue; // Already listed as terrain-solid.
    }
    blockedCells.push({ x: cell.x, y: cell.y });
  }

  return { width, height, blockedCells, movementCost, blocksSight };
};
