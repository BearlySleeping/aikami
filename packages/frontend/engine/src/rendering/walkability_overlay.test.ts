// packages/frontend/engine/src/rendering/walkability_overlay.test.ts
//
// C-506 AC-4 — the diagnostic walkability overlay must reflect the SAME
// movement authority used by pathfinding (the authoritative TerrainGrid),
// not a separately inferred map or a raw decor layer. These tests prove the
// overlay's per-cell styles are a pure projection of `TerrainGrid.cost` and
// that walkability classification agrees with the cost the movement systems
// consult.

import { describe, expect, test } from 'bun:test';
import {
  buildTerrainGridFromBoolean,
  TERRAIN_COST_WALKABLE,
  type TerrainGrid,
} from '../systems/terrain_grid.ts';
import {
  buildWalkabilityStyles,
  countWalkability,
  walkabilityCellStyle,
} from './walkability_overlay.ts';

const makeGrid = (width: number, height: number, blocked: number[]): TerrainGrid =>
  buildTerrainGridFromBoolean({
    width,
    height,
    tileSize: 32,
    grid: Array.from({ length: width * height }, (_, i) => blocked.includes(i)),
  });

describe('C-506 AC-4 — walkability overlay authority', () => {
  test('blocked (cost 0) cells resolve to the blocked style; walkable to walkable', () => {
    // 0 = impassable, TERRAIN_COST_WALKABLE = walkable.
    expect(walkabilityCellStyle(0).fill).not.toBe(walkabilityCellStyle(TERRAIN_COST_WALKABLE).fill);
    expect(walkabilityCellStyle(TERRAIN_COST_WALKABLE).alpha).toBeGreaterThan(0);
    expect(walkabilityCellStyle(0).alpha).toBeGreaterThan(0);
  });

  test('buildWalkabilityStyles indexes 1:1 with grid.cost (row-major)', () => {
    // 3x3 grid, blocked at index 4 (center) and 7.
    const grid = makeGrid(3, 3, [4, 7]);
    const styles = buildWalkabilityStyles(grid);
    expect(styles).toHaveLength(9);

    // Center + one edge blocked; the rest walkable.
    expect(styles[4]).toEqual(walkabilityCellStyle(0));
    expect(styles[7]).toEqual(walkabilityCellStyle(0));
    for (const i of [0, 1, 2, 3, 5, 6, 8]) {
      expect(styles[i]).toEqual(walkabilityCellStyle(TERRAIN_COST_WALKABLE));
    }
  });

  test('walkability classification matches the cost the movement systems consult', () => {
    // 4x2 grid, blocked at indices 0, 5, 7.
    const grid = makeGrid(4, 2, [0, 5, 7]);
    const { walkable, blocked } = countWalkability(grid);
    expect(walkable).toBe(5);
    expect(blocked).toBe(3);

    // Cross-check against the raw cost array directly (the authoritative source).
    let rawWalkable = 0;
    let rawBlocked = 0;
    for (const c of grid.cost) {
      if (c > 0) {
        rawWalkable += 1;
      } else {
        rawBlocked += 1;
      }
    }
    expect(walkable).toBe(rawWalkable);
    expect(blocked).toBe(rawBlocked);
  });

  test('a fully walkable grid shows zero blocked cells', () => {
    const grid = makeGrid(2, 2, []);
    const { walkable, blocked } = countWalkability(grid);
    expect(blocked).toBe(0);
    expect(walkable).toBe(4);
  });
});
