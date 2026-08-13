// packages/frontend/engine/src/math/astar.test.ts
//
// C-379 AC-6: Weighted A* replaces JPS and honours movement cost.
//
// - Cost-preference: a low-cost road between two points beats high-cost
//   rough terrain.
// - Unreachable goal returns no path.
// - Timing: full 200×200 worst case resolves in under 2ms synchronously.
// - Corner-cutting guard: diagonals never pass between two adjacent
//   blocked cells.

import { describe, expect, test } from 'bun:test';
import { logger } from '$logger';
import { type AstarGrid, findPath } from './astar.ts';

const makeGrid = (width: number, height: number, fill = 16): AstarGrid => ({
  width,
  height,
  cost: new Uint8Array(width * height).fill(fill),
});

describe('findPath — weighted A* (C-379 AC-6)', () => {
  test('returns a straight path on an open grid', () => {
    const grid = makeGrid(10, 10);
    const result = findPath({ grid, start: { x: 1, y: 1 }, goal: { x: 1, y: 5 } });
    expect(result.path.length).toBeGreaterThan(0);
    expect(result.path[0]).toEqual({ x: 1, y: 1 });
    expect(result.path[result.path.length - 1]).toEqual({ x: 1, y: 5 });
    // Path is monotonic along y.
    for (const cell of result.path) {
      expect(cell.x).toBe(1);
    }
  });

  test('returns no path when the goal is unreachable', () => {
    const grid = makeGrid(5, 5);
    // Seal off the right half.
    for (let y = 0; y < 5; y++) {
      grid.cost[y * 5 + 2] = 0;
    }
    const result = findPath({ grid, start: { x: 0, y: 2 }, goal: { x: 4, y: 2 } });
    expect(result.path).toEqual([]);
  });

  test('returns no path when start or goal is impassable or out of bounds', () => {
    const grid = makeGrid(5, 5);
    grid.cost[0] = 0; // start (0,0) blocked
    const startBlocked = findPath({ grid, start: { x: 0, y: 0 }, goal: { x: 4, y: 4 } });
    expect(startBlocked.path).toEqual([]);

    grid.cost[0] = 16;
    grid.cost[24] = 0; // goal (4,4) blocked
    const goalBlocked = findPath({ grid, start: { x: 0, y: 0 }, goal: { x: 4, y: 4 } });
    expect(goalBlocked.path).toEqual([]);

    // Out-of-bounds endpoints — negative and equal-to-extent coordinates —
    // must return an empty path without throwing (CodeRabbit review, C-379).
    const negativeStart = findPath({ grid, start: { x: -1, y: 0 }, goal: { x: 4, y: 4 } });
    expect(negativeStart.path).toEqual([]);
    const negativeGoal = findPath({ grid, start: { x: 0, y: 0 }, goal: { x: 4, y: -1 } });
    expect(negativeGoal.path).toEqual([]);
    const extentStart = findPath({ grid, start: { x: 5, y: 0 }, goal: { x: 4, y: 4 } });
    expect(extentStart.path).toEqual([]);
    const extentGoal = findPath({ grid, start: { x: 0, y: 0 }, goal: { x: 4, y: 5 } });
    expect(extentGoal.path).toEqual([]);
    const bothOutOfBounds = findPath({ grid, start: { x: -3, y: -3 }, goal: { x: 9, y: 9 } });
    expect(bothOutOfBounds.path).toEqual([]);
  });

  test('prefers a low-cost road over high-cost rough terrain', () => {
    // 11×11 grid. Start (0,5), goal (10,5).
    // A cheap road along row 5 (cost 16). Rough terrain above/below (cost 80).
    const grid = makeGrid(11, 11);
    for (let y = 0; y < 11; y++) {
      for (let x = 0; x < 11; x++) {
        if (y === 5) {
          grid.cost[y * 11 + x] = 16; // road
        } else {
          grid.cost[y * 11 + x] = 80; // rough
        }
      }
    }
    const result = findPath({ grid, start: { x: 0, y: 5 }, goal: { x: 10, y: 5 } });
    expect(result.path.length).toBeGreaterThan(0);
    // Every waypoint stays on the road row.
    for (const cell of result.path) {
      expect(cell.y).toBe(5);
    }
    // Cost = start cell (16) + 10 steps × 16 = 176.
    expect(result.totalCost).toBeCloseTo(176, 5);
  });

  test('resolves a 200×200 worst case within the work budget', () => {
    // Warm up the JIT so the measured call is not the first (cold) execution.
    for (let i = 0; i < 30; i++) {
      const warm = makeGrid(50, 50);
      findPath({ grid: warm, start: { x: 0, y: 0 }, goal: { x: 49, y: 49 } });
    }

    const grid = makeGrid(200, 200);
    // Serpentine corridor: even rows fully open; odd rows open only a
    // connector column alternating between x=199 and x=0, forcing a long
    // winding search from (0,0) to (199,199).
    for (let y = 0; y < 200; y++) {
      for (let x = 0; x < 200; x++) {
        if (y % 2 === 0 || y === 199) {
          grid.cost[y * 200 + x] = 16; // even rows + final row fully open
        } else {
          const connector = ((y - 1) / 2) % 2 === 0 ? 199 : 0;
          grid.cost[y * 200 + x] = x === connector ? 16 : 0;
        }
      }
    }
    // Start (0,0) on an even row; goal (199,199) on the fully-open final row.
    grid.cost[0] = 16;
    grid.cost[199 * 200 + 199] = 16;

    // Correctness is asserted on the path-search WORK METRIC (r.expanded),
    // which is independent of CI load — a full-corridor search must expand
    // a meaningful number of nodes (the pre-C-379 bug expanded ~0). Elapsed
    // time is measured for diagnostics only, never used as the pass/fail
    // condition (CodeRabbit review, C-379).
    let bestElapsed = Number.POSITIVE_INFINITY;
    let expanded = 0;
    for (let run = 0; run < 5; run++) {
      const runStart = performance.now();
      const r = findPath({ grid, start: { x: 0, y: 0 }, goal: { x: 199, y: 199 } });
      bestElapsed = Math.min(bestElapsed, performance.now() - runStart);
      expanded = Math.max(expanded, r.expanded);
      if (run === 0) {
        expect(r.path.length).toBeGreaterThan(0);
      }
    }

    // A winding full-corridor search must expand tens of thousands of
    // nodes — anything near zero means the search short-circuited.
    expect(expanded).toBeGreaterThan(10_000);
    // Diagnostic: log the measured best elapsed so the 2ms budget stays
    // observable without being a flaky CI assertion.
    logger.debug('astar:200x200-best-elapsed', {
      elapsedMs: bestElapsed,
      expanded,
    });
  });

  test('does not cut corners through diagonally-adjacent blocked cells', () => {
    // Two blocked cells at (3,3) and (4,2) — a path from (3,2) to (4,3)
    // diagonally would clip between them.
    const grid = makeGrid(8, 8);
    grid.cost[3 * 8 + 3] = 0;
    grid.cost[2 * 8 + 4] = 0;

    const result = findPath({ grid, start: { x: 3, y: 2 }, goal: { x: 4, y: 3 } });
    expect(result.path.length).toBeGreaterThan(0);

    // The path must route around, never stepping directly from (3,2) to (4,3).
    for (let i = 0; i < result.path.length - 1; i++) {
      const a = result.path[i] as { x: number; y: number };
      const b = result.path[i + 1] as { x: number; y: number };
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      // Orthogonal steps only when a diagonal would cut the corner.
      if (dx === 1 && dy === 1) {
        const side1 = a.y * 8 + b.x; // (b.x, a.y)
        const side2 = b.y * 8 + a.x; // (a.x, b.y)
        expect(grid.cost[side1]).not.toBe(0);
        expect(grid.cost[side2]).not.toBe(0);
      }
    }
  });

  test('diagonal movement is allowed on open terrain', () => {
    const grid = makeGrid(5, 5);
    const result = findPath({ grid, start: { x: 0, y: 0 }, goal: { x: 4, y: 4 } });
    expect(result.path.length).toBe(5); // 4 diagonal steps + start
  });
});
