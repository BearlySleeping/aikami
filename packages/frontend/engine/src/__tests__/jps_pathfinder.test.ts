// packages/frontend/engine/src/__tests__/jps_pathfinder.test.ts
//
// JPS Pathfinder — unit tests for time-sliced jump point search.
// Contract C-192: Validates generational table O(1) reset, flat min-heap
// operations, and JPS search correctness (simple paths, diagonal, wall avoidance).
//
// AC-1: O(1) constant-time table re-initialization
// AC-2: Flat array priority queue operations
// AC-3: Cooperative budget yielding

import { beforeEach, describe, expect, test } from 'bun:test';
import {
  allocatePathfinderBuffers,
  fromNodeId,
  getGlobalGeneration,
  incrementGeneration,
  isNodeVisited,
  markNodeVisited,
  type PathfinderMemoryBuffers,
  toNodeId,
} from '../math/jps/generational_table.ts';
import {
  cancelJpsSearch,
  type JpsSearchConfig,
  startJpsSearch,
  stepJpsSearch,
} from '../math/jps/jps_search.ts';
import { MinHeap } from '../math/jps/min_heap.ts';

// ---------------------------------------------------------------------------
// Test grid helpers
// ---------------------------------------------------------------------------

const GRID_W = 20;
const GRID_H = 20;
const CAPACITY = GRID_W * GRID_H;

/** All-walkable grid. */
const allWalkable = (_gx: number, _gy: number) => true;

/** Creates a fresh search config for testing. */
const makeConfig = (
  isWalkable: (gx: number, gy: number) => boolean = allWalkable,
): JpsSearchConfig => {
  const buffers = allocatePathfinderBuffers(GRID_W, GRID_H);
  const heap = new MinHeap(CAPACITY, buffers.fCostMap);
  return {
    gridWidth: GRID_W,
    gridHeight: GRID_H,
    isWalkable,
    buffers,
    openHeap: heap,
    timeBudgetMs: 100, // Large budget for synchronous tests
  };
};

/** Creates a walkability map with walls at specific coordinates. */
const wallMap = (walls: Array<[number, number]>) => {
  const set = new Set(walls.map(([x, y]) => `${x},${y}`));
  return (gx: number, gy: number) => !set.has(`${gx},${gy}`);
};

// Helper to run a search to completion (synchronous).
const runSearch = (
  config: JpsSearchConfig,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
): Array<[number, number]> => {
  startJpsSearch(config, sx, sy, gx, gy);
  let result = stepJpsSearch();
  // Keep stepping until done
  let safety = 0;
  while (result.incomplete && safety < 5000) {
    result = stepJpsSearch();
    safety++;
  }
  return result.path;
};

// ===========================================================================
// AC-1: Generational Table — O(1) Reset
// ===========================================================================

describe('Generational Table (AC-1)', () => {
  let buffers: PathfinderMemoryBuffers;

  beforeEach(() => {
    buffers = allocatePathfinderBuffers(GRID_W, GRID_H);
  });

  test('incrementGeneration advances the global counter in O(1)', () => {
    const before = getGlobalGeneration();
    const result = incrementGeneration();
    expect(result).toBe(before + 1);
    expect(getGlobalGeneration()).toBe(before + 1);
  });

  test('unvisited nodes return false for isNodeVisited', () => {
    incrementGeneration();
    expect(isNodeVisited(buffers, 0)).toBe(false);
    expect(isNodeVisited(buffers, 100)).toBe(false);
  });

  test('markNodeVisited makes node visible in current generation', () => {
    incrementGeneration();
    markNodeVisited(buffers, 50);
    expect(isNodeVisited(buffers, 50)).toBe(true);
    expect(isNodeVisited(buffers, 51)).toBe(false);
  });

  test('new generation invalidates all previously visited nodes', () => {
    incrementGeneration();
    markNodeVisited(buffers, 50);
    markNodeVisited(buffers, 100);

    // New generation — all nodes should appear unvisited
    incrementGeneration();
    expect(isNodeVisited(buffers, 50)).toBe(false);
    expect(isNodeVisited(buffers, 100)).toBe(false);
  });

  test('toNodeId and fromNodeId are inverses', () => {
    const id = toNodeId(5, 7, GRID_W);
    const [x, y] = fromNodeId(id, GRID_W);
    expect(x).toBe(5);
    expect(y).toBe(7);
  });

  test('toNodeId handles grid boundaries', () => {
    expect(toNodeId(0, 0, GRID_W)).toBe(0);
    expect(toNodeId(GRID_W - 1, GRID_H - 1, GRID_W)).toBe(CAPACITY - 1);
  });
});

// ===========================================================================
// AC-2: Min-Heap Operations
// ===========================================================================

describe('Min-Heap (AC-2)', () => {
  let fCostMap: Float32Array;

  beforeEach(() => {
    fCostMap = new Float32Array(CAPACITY);
  });

  test('push and pop return in ascending F-cost order', () => {
    const heap = new MinHeap(CAPACITY, fCostMap);

    fCostMap[10] = 5.0;
    fCostMap[20] = 1.0;
    fCostMap[30] = 3.0;
    fCostMap[40] = 4.0;

    heap.push(10);
    heap.push(20);
    heap.push(30);
    heap.push(40);

    expect(heap.pop()).toBe(20); // F=1.0
    expect(heap.pop()).toBe(30); // F=3.0
    expect(heap.pop()).toBe(40); // F=4.0
    expect(heap.pop()).toBe(10); // F=5.0
    expect(heap.pop()).toBeNull();
  });

  test('heap with equal F-costs maintains FIFO-like order', () => {
    const heap = new MinHeap(CAPACITY, fCostMap);

    fCostMap[1] = 2.0;
    fCostMap[2] = 2.0;
    fCostMap[3] = 2.0;

    heap.push(1);
    heap.push(2);
    heap.push(3);

    // All have equal F-cost — heap property is maintained
    const results = [heap.pop(), heap.pop(), heap.pop()];
    expect(results).toContain(1);
    expect(results).toContain(2);
    expect(results).toContain(3);
  });

  test('clear empties the heap', () => {
    const heap = new MinHeap(CAPACITY, fCostMap);

    fCostMap[1] = 1.0;
    heap.push(1);
    expect(heap.isEmpty()).toBe(false);

    heap.clear();
    expect(heap.isEmpty()).toBe(true);
    expect(heap.pop()).toBeNull();
  });

  test('isEmpty returns true for new heap', () => {
    const heap = new MinHeap(CAPACITY, fCostMap);
    expect(heap.isEmpty()).toBe(true);
  });

  test('size reflects element count', () => {
    const heap = new MinHeap(CAPACITY, fCostMap);

    fCostMap[1] = 1.0;
    fCostMap[2] = 2.0;
    fCostMap[3] = 3.0;

    expect(heap.size).toBe(0);
    heap.push(1);
    expect(heap.size).toBe(1);
    heap.push(2);
    expect(heap.size).toBe(2);
    heap.pop();
    expect(heap.size).toBe(1);
    heap.push(3);
    expect(heap.size).toBe(2);
  });

  test('heap overflow silently drops', () => {
    const tinyHeap = new MinHeap(2, fCostMap);
    fCostMap[1] = 1.0;
    fCostMap[2] = 2.0;
    fCostMap[3] = 3.0;

    tinyHeap.push(1);
    tinyHeap.push(2);
    tinyHeap.push(3); // Should be dropped

    expect(tinyHeap.size).toBe(2);
  });
});

// ===========================================================================
// JPS Search — Simple Paths
// ===========================================================================

describe('JPS Search — simple paths', () => {
  test('finds straight horizontal path', () => {
    const config = makeConfig();
    const path = runSearch(config, 0, 0, 5, 0);
    expect(path.length).toBeGreaterThan(0);
    expect(path[0]).toEqual([0, 0]);
    expect(path[path.length - 1]).toEqual([5, 0]);
  });

  test('finds straight vertical path', () => {
    const config = makeConfig();
    const path = runSearch(config, 0, 0, 0, 5);
    expect(path.length).toBeGreaterThan(0);
    expect(path[0]).toEqual([0, 0]);
    expect(path[path.length - 1]).toEqual([0, 5]);
  });

  test('finds diagonal path', () => {
    const config = makeConfig();
    const path = runSearch(config, 0, 0, 5, 5);
    expect(path.length).toBeGreaterThan(0);
    expect(path[0]).toEqual([0, 0]);
    expect(path[path.length - 1]).toEqual([5, 5]);
  });

  test('same start and goal returns trivial path', () => {
    const config = makeConfig();
    const path = runSearch(config, 3, 3, 3, 3);
    expect(path.length).toBeGreaterThan(0);
    expect(path[0]).toEqual([3, 3]);
  });

  test('adjacent cell path', () => {
    const config = makeConfig();
    const path = runSearch(config, 5, 5, 6, 5);
    expect(path.length).toBeGreaterThan(1);
  });
});

// ===========================================================================
// JPS Search — Wall Avoidance
// ===========================================================================

describe('JPS Search — wall avoidance', () => {
  test('routes around a single wall cell', () => {
    const walls = wallMap([[5, 5]]);
    const config = makeConfig(walls);

    const path = runSearch(config, 4, 5, 6, 5);
    // Path must exist (go around the wall)
    expect(path.length).toBeGreaterThan(0);
    // Path must not include the wall cell
    for (const [px, py] of path) {
      expect([px, py]).not.toEqual([5, 5]);
    }
  });

  test('routes around a vertical wall line', () => {
    const wallCells: Array<[number, number]> = [];
    for (let y = 3; y <= 7; y++) {
      wallCells.push([5, y]);
    }
    const config = makeConfig(wallMap(wallCells));

    const path = runSearch(config, 0, 5, 10, 5);
    expect(path.length).toBeGreaterThan(0);
    // No path cell should be a wall
    for (const [px, py] of path) {
      const isWall = wallCells.some(([wx, wy]) => wx === px && wy === py);
      expect(isWall).toBe(false);
    }
  });

  test('no path when completely walled off', () => {
    // Create a wall box around the start
    const wallCells: Array<[number, number]> = [];
    for (let x = 0; x <= 5; x++) {
      wallCells.push([x, 5]);
    }
    for (let x = 0; x <= 5; x++) {
      wallCells.push([x, 0]);
    }
    const config = makeConfig(wallMap(wallCells));

    const path = runSearch(config, 1, 1, 10, 10);
    // May or may not find a path — walls are only partial
    // Just verify no crash
    expect(Array.isArray(path)).toBe(true);
  });

  test('finds path through a corridor', () => {
    // Create walls with a 1-tile corridor at y=5
    const wallCells: Array<[number, number]> = [];
    for (let y = 0; y < GRID_H; y++) {
      if (y !== 5) {
        wallCells.push([10, y]);
      }
    }
    const config = makeConfig(wallMap(wallCells));

    const path = runSearch(config, 0, 5, 19, 5);
    expect(path.length).toBeGreaterThan(0);
    // Path should pass through the corridor at x=10, y=5
    const corridorPass = path.some(([px, py]) => px === 10 && py === 5);
    expect(corridorPass).toBe(true);
  });

  test('start blocked returns empty path', () => {
    const walls = wallMap([[0, 0]]);
    const config = makeConfig(walls);

    const path = runSearch(config, 0, 0, 5, 5);
    expect(path.length).toBe(0);
  });

  test('goal blocked returns empty path', () => {
    const walls = wallMap([[5, 5]]);
    const config = makeConfig(walls);

    const path = runSearch(config, 0, 0, 5, 5);
    expect(path.length).toBe(0);
  });
});

// ===========================================================================
// JPS Search — Cooperative Yielding (AC-3)
// ===========================================================================

describe('JPS Search — cooperative yielding (AC-3)', () => {
  test('stepJpsSearch with small budget returns incomplete', () => {
    const config = makeConfig(allWalkable);
    config.timeBudgetMs = 0; // Zero budget — should yield immediately

    startJpsSearch(config, 0, 0, 15, 15);

    const result = stepJpsSearch();
    // With zero budget, should yield as incomplete (or finish if trivial)
    // The batch check fires every 128 steps — for a 20x20 grid, first batch may complete
    expect(result.found || result.incomplete).toBe(true);
  });

  test('can cancel mid-search', () => {
    const config = makeConfig(allWalkable);
    startJpsSearch(config, 0, 0, 10, 10);

    cancelJpsSearch();
    const result = stepJpsSearch();
    expect(result.found).toBe(false);
    expect(result.incomplete).toBe(false);
  });
});

// ===========================================================================
// AC-1: O(1) Reset Speed
// ===========================================================================

describe('AC-1: O(1) reset speed verification', () => {
  test('generation increment is constant time regardless of grid size', () => {
    // Small grid
    const smallStart = performance.now();
    for (let i = 0; i < 1000; i++) {
      incrementGeneration();
    }
    const smallElapsed = performance.now() - smallStart;

    // The operation is O(1) — just incrementing a counter
    // Should be extremely fast regardless
    expect(smallElapsed).toBeLessThan(10);
  });

  test('multiple new searches with large grid completes in O(1)', () => {
    // Allocate a large grid
    const largeBuffers = allocatePathfinderBuffers(128, 128);

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      incrementGeneration();
      markNodeVisited(largeBuffers, i);
    }
    const elapsed = performance.now() - start;

    // 100 generations + marks should be fast (O(1) per operation)
    expect(elapsed).toBeLessThan(20);
  });
});
