// packages/frontend/engine/src/systems/terrain_grid.ts
//
// TerrainGrid — the authoritative terrain cost grid (C-379).
//
// Two grids, one owner: `terrainCost` (terrain solidity + movement cost)
// and `occupancy` (the dense spatial grid of dynamic entities) are the only
// spatial truth. Terrain is a flat Uint8Array of costs (0 = impassable,
// else cost × 16) plus a parallel blocksSight byte array for the vision
// raycasters. Wall entities are gone — doors/bridges/destructibles mutate
// `terrainCost` at runtime instead of spawning entities.

import type { PackConfig } from '@aikami/types';
import { logger } from '$logger';
import type { CollisionGrid } from './collision_system.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Authoritative terrain grid — built once per LOAD_MAP from C-378's terrain
 * channel (or the legacy boolean grid for terrainless maps).
 */
export type TerrainGrid = {
  /** Grid width in tiles. */
  width: number;
  /** Grid height in tiles. */
  height: number;
  /** Tile size in world pixels, from the map — never assumed to be 32. */
  tileSize: number;
  /**
   * Row-major flat array: 0 = impassable, otherwise movement cost × 16
   * (so 1.0 → 16, 0.8 → 13).
   */
  cost: Uint8Array;
  /** Row-major flat array: 1 = blocks line of sight. */
  blocksSight: Uint8Array;
};

/** Cost encoding scale (C-379 State & Data Models). */
export const TERRAIN_COST_SCALE = 16;

/** Cost of a normal walkable cell (1.0 × 16). */
export const TERRAIN_COST_WALKABLE = TERRAIN_COST_SCALE;

/** Terrain definition subset consumed by {@link buildTerrainGridFromChannel}. */
export type TerrainCostDef = {
  isWalkable: boolean;
  movementCost?: number;
  blocksSight?: boolean;
};

/**
 * Builds a TerrainGrid from a legacy boolean collision grid.
 *
 * Legacy fallback (AC-4): terrainless maps derive cost from the boolean
 * grid — walkable → 16, solid → 0. `blocksSight` mirrors solidity so
 * vision behaviour is unchanged for maps without a terrain channel.
 *
 * @param grid - The legacy boolean collision grid.
 * @returns A TerrainGrid with cost 0/16 and blocksSight = solidity.
 */
export const buildTerrainGridFromBoolean = (grid: CollisionGrid): TerrainGrid => {
  const cellCount = grid.width * grid.height;
  const cost = new Uint8Array(cellCount);
  const blocksSight = new Uint8Array(cellCount);

  for (let i = 0; i < cellCount; i++) {
    const solid = grid.grid[i] === true;
    cost[i] = solid ? 0 : TERRAIN_COST_WALKABLE;
    blocksSight[i] = solid ? 1 : 0;
  }

  return {
    width: grid.width,
    height: grid.height,
    tileSize: grid.tileSize,
    cost,
    blocksSight,
  };
};

/**
 * Builds a TerrainGrid from per-cell terrain ids and pack terrain defs.
 *
 * Terrain-channel path (AC-4): each cell's cost comes from its terrain's
 * `movementCost` (× 16, default 1.0) when walkable, else 0. `blocksSight`
 * comes from the terrain's `blocksSight` flag, defaulting to `!walkable`.
 * Unknown terrain ids fall back to the base terrain (C-378 failure
 * recovery), and the explicit collision layer stays additive — it can only
 * add solidity.
 *
 * @param options - Terrain channel data.
 * @param options.width - Grid width in tiles.
 * @param options.height - Grid height in tiles.
 * @param options.tileSize - Tile size in world pixels.
 * @param options.terrain - Row-major terrain id per cell (`''` = base).
 * @param options.terrainDefs - Pack terrain definitions keyed by name.
 * @param options.baseTerrainName - Name of the base (lowest precedence) terrain.
 * @param options.legacySolid - Optional row-major boolean solidity (from the
 *   explicit collision layer); additive — never re-opens a terrain-solid cell.
 * @returns A TerrainGrid with per-terrain cost and blocksSight.
 */
export const buildTerrainGridFromChannel = (options: {
  width: number;
  height: number;
  tileSize: number;
  terrain: readonly string[];
  terrainDefs: Map<string, TerrainCostDef>;
  baseTerrainName: string;
  legacySolid?: readonly boolean[];
}): TerrainGrid => {
  const { width, height, tileSize, terrain, terrainDefs, baseTerrainName, legacySolid } = options;
  const cellCount = width * height;
  const cost = new Uint8Array(cellCount);
  const blocksSight = new Uint8Array(cellCount);

  const baseDef = terrainDefs.get(baseTerrainName);
  const unknownTerrains = new Set<string>();

  for (let i = 0; i < cellCount; i++) {
    const id = terrain[i] ?? '';
    const resolved = id === '' ? baseTerrainName : id;
    const def = terrainDefs.get(resolved) ?? baseDef;

    if (def === undefined) {
      unknownTerrains.add(resolved);
      // Unknown terrain → base walkability (C-378 failure recovery); with no
      // base def either, fail open (walkable) rather than creating phantom walls.
      cost[i] = TERRAIN_COST_WALKABLE;
      blocksSight[i] = 0;
      continue;
    }

    if (!def.isWalkable) {
      cost[i] = 0;
      blocksSight[i] = 1;
      continue;
    }

    const movementCost = def.movementCost ?? 1.0;
    cost[i] = Math.max(1, Math.round(movementCost * TERRAIN_COST_SCALE));
    blocksSight[i] = def.blocksSight === true ? 1 : 0;
  }

  if (unknownTerrains.size > 0) {
    logger.warn('buildTerrainGridFromChannel:unknown-terrain', {
      terrains: [...unknownTerrains].sort(),
      hint: 'Declare these ids in manifest.terrains — treated as the base terrain (C-378).',
    });
  }

  // Explicit collision layer — additive only. Never re-opens a
  // terrain-solid cell (C-378 invariant).
  if (legacySolid) {
    for (let i = 0; i < cellCount; i++) {
      if (legacySolid[i] === true) {
        cost[i] = 0;
        blocksSight[i] = 1;
      }
    }
  }

  return { width, height, tileSize, cost, blocksSight };
};

/**
 * Extracts pack terrain definitions into the name-keyed map consumed by
 * {@link buildTerrainGridFromChannel}.
 *
 * @param packConfig - The validated pack config (or undefined for packless maps).
 * @returns A Map of terrain name → cost def, empty when the pack has none.
 */
export const collectTerrainCostDefs = (
  packConfig: PackConfig | undefined,
): Map<string, TerrainCostDef> => {
  const defs = new Map<string, TerrainCostDef>();
  for (const terrain of packConfig?.terrains ?? []) {
    defs.set(terrain.name, {
      isWalkable: terrain.isWalkable,
      movementCost: terrain.movementCost,
      blocksSight: terrain.blocksSight,
    });
  }
  return defs;
};
