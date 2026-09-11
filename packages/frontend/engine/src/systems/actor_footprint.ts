// packages/frontend/engine/src/systems/actor_footprint.ts
//
// Actor collision footprint — the single source of truth for the box the
// movement system resolves against, plus the footprint-aware pathfinding
// grid derived from it.
//
// The movement system collides a 32×32 box anchored at the feet bottom-centre
// (`x ± 16`, `y − 32 .. y`). The box is symmetric horizontally but extends
// entirely upward from the feet, so a standing actor spans TWO tile rows: the
// feet row and the row above it.
//
// A pathfinder that only tests the feet tile routes actors into cells whose
// upper row overlaps a wall. Movement then refuses the step and the actor
// jams on the corner ("stuck on the corner"). {@link buildActorPathGrid}
// derives a cost grid that marks a cell blocked whenever ANY tile under the
// box at that cell's centre is impassable, so click-to-move and NPC paths
// only use cells the actor can actually stand in.
//
// These constants are the ENTITY box, not the tile size — they do NOT scale
// with the map's tile size (C-379 AC-5 watch point).

import { findPath, type GridCell } from '../math/astar.ts';
import type { TerrainGrid } from './terrain_grid.ts';

/**
 * Half-width of the actor collision box in world pixels.
 *
 * The box is symmetric horizontally (±16 around the feet X).
 */
export const ENTITY_HALF_WIDTH = 16;

/**
 * Vertical extent of the actor collision box above the feet (world pixels).
 *
 * With the bottom-centre anchor the box spans `feetY − 32` to `feetY`; no
 * margin is applied below the feet — the sprite renders entirely upward.
 */
export const ENTITY_HEIGHT_ABOVE = 32;

/**
 * Builds a pathfinding cost grid that respects the actor collision box.
 *
 * For each cell, the actor would stand with its feet at the cell centre. The
 * box then covers `[centreX − 16, centreX + 16)` horizontally and
 * `[centreY − 32, centreY]` vertically. The cell is:
 *
 * - `0` (impassable) when any covered tile is out of bounds or has cost 0;
 * - otherwise the maximum walkable cost across the covered tiles (a
 *   conservative approximation for weighted terrain).
 *
 * The result has the same `width`/`height`/`tileSize` as the source terrain
 * and is a drop-in `AstarGrid` for {@link import('../math/astar.ts').findPath}.
 *
 * @param terrain - The authoritative terrain cost grid.
 * @returns A row-major cost grid (`0` = impassable) for actor pathfinding.
 */
export const buildActorPathGrid = (terrain: TerrainGrid): Uint8Array => {
  const { width, height, tileSize, cost } = terrain;
  const grid = new Uint8Array(width * height);

  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const index = cy * width + cx;
      const feetCost = cost[index] ?? 0;

      // Already impassable at the feet — no box sampling needed.
      if (feetCost === 0) {
        continue;
      }

      const centerX = cx * tileSize + tileSize / 2;
      const centerY = cy * tileSize + tileSize / 2;
      const tx1 = Math.floor((centerX - ENTITY_HALF_WIDTH) / tileSize);
      const tx2 = Math.floor((centerX + ENTITY_HALF_WIDTH - 1) / tileSize);
      const ty1 = Math.floor((centerY - ENTITY_HEIGHT_ABOVE + 1) / tileSize);
      const ty2 = Math.floor(centerY / tileSize);

      let cellCost = feetCost;
      let passable = true;
      for (let ty = ty1; ty <= ty2 && passable; ty++) {
        for (let tx = tx1; tx <= tx2; tx++) {
          if (tx < 0 || tx >= width || ty < 0 || ty >= height) {
            passable = false;
            break;
          }
          const c = cost[ty * width + tx];
          if (c === undefined || c === 0) {
            passable = false;
            break;
          }
          if (c > cellCost) {
            cellCost = c;
          }
        }
      }

      grid[index] = passable ? cellCost : 0;
    }
  }

  return grid;
};

/** A planned actor path, ready to assign to a `PathFollow` component. */
export type ActorPathPlan = {
  /** World-pixel waypoints (tile centres), 2 floats per waypoint. */
  waypoints: Float32Array;
  /** Number of waypoints. */
  length: number;
  /** First waypoint to steer toward (see {@link planActorPath}). */
  index: number;
};

/**
 * Finds the nearest pathable cell to `(cellX, cellY)` using square rings.
 *
 * The actor can legally stand at the bottom of a cell whose CENTRE overlaps
 * the row above (walking up against a wall), so its current cell may be
 * blocked in the footprint grid even though the actor is fine. Pathing must
 * start from the nearest standable cell instead of failing outright.
 *
 * @param terrain - The footprint-aware pathfinding grid.
 * @param cellX - The actor's current cell X.
 * @param cellY - The actor's current cell Y.
 * @param maxRadius - Ring radius limit in tiles.
 * @returns The cell itself when pathable, else the nearest pathable cell.
 */
export const findNearestPathableCell = (
  terrain: TerrainGrid,
  cellX: number,
  cellY: number,
  maxRadius = 8,
): GridCell | undefined => {
  const { width, height, cost } = terrain;
  const inBounds = (x: number, y: number): boolean => x >= 0 && x < width && y >= 0 && y < height;
  const pathable = (x: number, y: number): boolean =>
    inBounds(x, y) && (cost[y * width + x] ?? 0) !== 0;

  if (pathable(cellX, cellY)) {
    return { x: cellX, y: cellY };
  }

  for (let radius = 1; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) {
          continue;
        }
        const x = cellX + dx;
        const y = cellY + dy;
        if (pathable(x, y)) {
          return { x, y };
        }
      }
    }
  }

  return undefined;
};

/**
 * Plans a footprint-aware path from an actor's current cell to a goal cell.
 *
 * Unlike a raw {@link findPath} call this tolerates a start cell whose centre
 * is blocked: it plans from the nearest standable cell and returns an `index`
 * of `0` so the actor first walks to that cell (rather than skipping it). When
 * the start cell is already standable the index is `1` (skip the start cell,
 * matching the existing `PathFollow` convention).
 *
 * The goal is likewise clamped to the nearest standable cell, so a click on a
 * wall, a prop, or in the void outside the map walks to the closest cell the
 * actor can actually enter instead of being refused.
 *
 * @param options - Terrain grid, actor cell, and goal cell.
 * @returns The plan, or `undefined` when no standable start/goal exists.
 */
export const planActorPath = (options: {
  terrain: TerrainGrid;
  fromCell: GridCell;
  goal: GridCell;
}): ActorPathPlan | undefined => {
  const { terrain, fromCell, goal } = options;

  const goalCell = findNearestPathableCell(terrain, goal.x, goal.y);
  if (!goalCell) {
    return undefined;
  }

  const start = findNearestPathableCell(terrain, fromCell.x, fromCell.y);
  if (!start) {
    return undefined;
  }

  const result = findPath({ grid: terrain, start, goal: goalCell });
  if (result.path.length === 0) {
    return undefined;
  }

  const tileSize = terrain.tileSize;
  const waypoints = new Float32Array(result.path.length * 2);
  for (let i = 0; i < result.path.length; i++) {
    waypoints[i * 2] = result.path[i].x * tileSize + tileSize / 2;
    waypoints[i * 2 + 1] = result.path[i].y * tileSize + tileSize / 2;
  }

  const atCurrent = start.x === fromCell.x && start.y === fromCell.y;
  return { waypoints, length: result.path.length, index: atCurrent ? 1 : 0 };
};
