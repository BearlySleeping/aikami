// packages/frontend/engine/src/systems/jps_pathfinder_system.ts

// ---------------------------------------------------------------------------
// JpsPathfinderSystem — cooperative time-sliced JPS pathfinding
//
// Contract C-192: Manages JPS search lifecycle with cooperative generator
// yielding. Maintains shared memory buffers for lock-free inter-thread
// communication via SharedArrayBuffer (scaffolded for worker deployment).
//
// For now, runs synchronously in the main thread with cooperative stepping.
// The SharedArrayBuffer interop is scaffolded for future worker migration.
// ---------------------------------------------------------------------------

import { allocatePathfinderBuffers } from '../math/jps/generational_table.ts';
import {
  cancelJpsSearch,
  isSearchActive,
  type JpsSearchConfig,
  type JpsSearchResult,
  startJpsSearch,
  stepJpsSearch,
} from '../math/jps/jps_search.ts';
import { MinHeap } from '../math/jps/min_heap.ts';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** Current search configuration. */
let _config: JpsSearchConfig | null = null;

/** Pre-allocated heap instance for reuse. */
let _openHeap: MinHeap | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initializes the pathfinder for a grid of the given dimensions.
 *
 * Allocates memory buffers and the priority queue. Must be called once before
 * any pathfinding operations.
 *
 * @param gridWidth - Grid width in cells.
 * @param gridHeight - Grid height in cells.
 * @param isWalkable - Walkability check function.
 */
export const initJpsPathfinder = (
  gridWidth: number,
  gridHeight: number,
  isWalkable: (gx: number, gy: number) => boolean,
): void => {
  const buffers = allocatePathfinderBuffers(gridWidth, gridHeight);
  _openHeap = new MinHeap(gridWidth * gridHeight, buffers.fCostMap);

  _config = {
    gridWidth,
    gridHeight,
    isWalkable,
    buffers,
    openHeap: _openHeap,
    timeBudgetMs: 2.0, // AC-3: 2.0ms ceiling
  };
};

/**
 * Requests a path from start to goal.
 *
 * Initiates a cooperative search. Call {@link tickJpsPathfinder} repeatedly
 * until the search completes.
 *
 * @param startGx - Start grid X.
 * @param startGy - Start grid Y.
 * @param goalGx - Goal grid X.
 * @param goalGy - Goal grid Y.
 */
export const requestPath = (
  startGx: number,
  startGy: number,
  goalGx: number,
  goalGy: number,
): void => {
  if (!_config) {
    return;
  }

  cancelJpsSearch();
  startJpsSearch(_config, startGx, startGy, goalGx, goalGy);
};

/**
 * Ticks the cooperative JPS search by one time-budgeted step.
 *
 * Call this once per frame. Returns the search result when complete,
 * or an incomplete flag if more ticks are needed.
 *
 * @returns JpsSearchResult.
 */
export const tickJpsPathfinder = (): JpsSearchResult => {
  if (!_config) {
    return { found: false, path: [], incomplete: false };
  }

  return stepJpsSearch();
};

/**
 * Checks if a pathfinding search is currently in progress.
 */
export const isPathfinding = (): boolean => {
  return isSearchActive();
};

/**
 * Cancels the active pathfinding search.
 */
export const cancelPathfinding = (): void => {
  cancelJpsSearch();
};
