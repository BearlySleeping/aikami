// packages/frontend/engine/src/math/jps/jps_search.ts

// ---------------------------------------------------------------------------
// JPS (Jump Point Search) — zero-allocation grid pathfinding
//
// Contract C-192: Implements JPS for 8-directional grid movement with
// neighbor pruning, forced neighbor detection, and jump point identification.
// Uses generational tables for O(1) cost map reset and a flat binary min-heap
// priority queue.
// ---------------------------------------------------------------------------

import type { PathfinderMemoryBuffers } from './generational_table.ts';
import {
  fromNodeId,
  incrementGeneration,
  isNodeVisited,
  markNodeVisited,
  toNodeId,
} from './generational_table.ts';
import type { MinHeap } from './min_heap.ts';

// ---------------------------------------------------------------------------
// Direction constants (8-directional)
// ---------------------------------------------------------------------------

/** Cardinal and diagonal direction vectors (dx, dy). */
const DIRECTIONS: ReadonlyArray<[number, number]> = [
  [1, 0], // 0: East
  [1, 1], // 1: South-East
  [0, 1], // 2: South
  [-1, 1], // 3: South-West
  [-1, 0], // 4: West
  [-1, -1], // 5: North-West
  [0, -1], // 6: North
  [1, -1], // 7: North-East
] as const;

// ---------------------------------------------------------------------------
// Search state type
// ---------------------------------------------------------------------------

/** Configuration for a JPS search. */
export type JpsSearchConfig = {
  /** Grid width in cells. */
  gridWidth: number;
  /** Grid height in cells. */
  gridHeight: number;
  /** Walkability check: (gx, gy) => true if the cell is walkable. */
  isWalkable: (gx: number, gy: number) => boolean;
  /** Pre-allocated memory buffers. */
  buffers: PathfinderMemoryBuffers;
  /** Pre-allocated min-heap for the OPEN set. */
  openHeap: MinHeap;
  /** Time budget in ms (yield control after this threshold). */
  timeBudgetMs: number;
};

/** Result of a JPS search. */
export type JpsSearchResult = {
  /** Whether a path was found. */
  found: boolean;
  /** Array of [gx, gy] coordinates from start to goal (empty if not found). */
  path: Array<[number, number]>;
  /** Whether the search is incomplete (needs more ticks). */
  incomplete: boolean;
};

// ---------------------------------------------------------------------------
// Module-level search state (persists across cooperative yields)
// ---------------------------------------------------------------------------

let _searchActive = false;
let _startNodeId = -1;
let _goalNodeId = -1;
let _goalGx = -1;
let _goalGy = -1;
let _config: JpsSearchConfig | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initiates a new JPS pathfinding search.
 *
 * Resets the global generation counter (O(1)) and initializes the OPEN set
 * with the start node. The search can then be stepped cooperatively via
 * {@link stepJpsSearch}.
 *
 * @param config - Search configuration.
 * @param startGx - Start grid X.
 * @param startGy - Start grid Y.
 * @param goalGx - Goal grid X.
 * @param goalGy - Goal grid Y.
 */
export const startJpsSearch = (
  config: JpsSearchConfig,
  startGx: number,
  startGy: number,
  goalGx: number,
  goalGy: number,
): void => {
  const { gridWidth, gridHeight, isWalkable, buffers, openHeap } = config;

  // Validate bounds
  if (
    startGx < 0 ||
    startGx >= gridWidth ||
    startGy < 0 ||
    startGy >= gridHeight ||
    goalGx < 0 ||
    goalGx >= gridWidth ||
    goalGy < 0 ||
    goalGy >= gridHeight
  ) {
    _searchActive = false;
    return;
  }

  // Validate start and goal are walkable
  if (!isWalkable(startGx, startGy) || !isWalkable(goalGx, goalGy)) {
    _searchActive = false;
    return;
  }

  // O(1) reset via generation increment
  incrementGeneration();

  _startNodeId = toNodeId(startGx, startGy, gridWidth);
  _goalNodeId = toNodeId(goalGx, goalGy, gridWidth);
  _goalGx = goalGx;
  _goalGy = goalGy;
  _config = config;
  _searchActive = true;

  // Initialize start node
  markNodeVisited(buffers, _startNodeId);
  buffers.gCostMap[_startNodeId] = 0;
  buffers.fCostMap[_startNodeId] = _octileHeuristic(startGx, startGy, goalGx, goalGy);

  openHeap.clear();
  openHeap.push(_startNodeId);
};

/**
 * Performs one cooperative step of the JPS search.
 *
 * Processes nodes from the OPEN set until the time budget is exceeded or
 * the search completes. Call this repeatedly (e.g., once per frame) until
 * `incomplete` is false.
 *
 * @returns JpsSearchResult with path if found, or incomplete flag.
 */
export const stepJpsSearch = (): JpsSearchResult => {
  if (!_searchActive || !_config) {
    return { found: false, path: [], incomplete: false };
  }

  const { gridWidth, isWalkable, buffers, openHeap, timeBudgetMs } = _config;
  const startTime = performance.now();
  const stepBatchLimit = 128; // Check time every 128 steps (AC-3)

  let steps = 0;

  while (!openHeap.isEmpty()) {
    // ── Cooperative yield check (AC-3) ──
    steps++;
    if (steps % stepBatchLimit === 0) {
      if (performance.now() - startTime > timeBudgetMs) {
        return { found: false, path: [], incomplete: true };
      }
    }

    // ── Pop best node ──
    const currentNodeId = openHeap.pop();
    if (currentNodeId === null) {
      break;
    }

    // ── Goal check ──
    if (currentNodeId === _goalNodeId) {
      const path = _reconstructPath(buffers, _startNodeId, _goalNodeId, gridWidth);
      _searchActive = false;
      return { found: true, path, incomplete: false };
    }

    const [cx, cy] = fromNodeId(currentNodeId, gridWidth);
    const currentGCost = buffers.gCostMap[currentNodeId];

    // ── Expand in all 8 directions ──
    for (const dirIdx of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const [dx, dy] = DIRECTIONS[dirIdx];

      const jumpResult = _jump(
        cx,
        cy,
        dx,
        dy,
        _goalGx,
        _goalGy,
        gridWidth,
        _config.gridHeight,
        isWalkable,
      );

      if (jumpResult) {
        const [jx, jy] = jumpResult;
        const jumpNodeId = toNodeId(jx, jy, gridWidth);

        // ── Compute costs ──
        const dist = _octileDistance(cx, cy, jx, jy);
        const tentativeG = currentGCost + dist;

        // Check if unvisited or found better path
        if (!isNodeVisited(buffers, jumpNodeId) || tentativeG < buffers.gCostMap[jumpNodeId]) {
          markNodeVisited(buffers, jumpNodeId);
          buffers.gCostMap[jumpNodeId] = tentativeG;
          buffers.fCostMap[jumpNodeId] = tentativeG + _octileHeuristic(jx, jy, _goalGx, _goalGy);
          buffers.parentMap[jumpNodeId] = currentNodeId;

          openHeap.push(jumpNodeId);
        }
      }
    }
  }

  // OPEN set exhausted — no path found
  _searchActive = false;
  return { found: false, path: [], incomplete: false };
};

/**
 * Cancels the active search.
 */
export const cancelJpsSearch = (): void => {
  _searchActive = false;
  _config = null;
};

/**
 * Checks if a search is currently active.
 */
export const isSearchActive = (): boolean => {
  return _searchActive;
};

// ---------------------------------------------------------------------------
// JPS: Jump function
// ---------------------------------------------------------------------------

/**
 * JPS jump function: recursively scans in direction (dx, dy) from (cx, cy)
 * looking for a jump point.
 *
 * A jump point is:
 * - The goal node
 * - A node with at least one forced neighbor
 *
 * For diagonal jumps, first scans the cardinal components for jump points.
 *
 * @returns [jx, jy] if a jump point is found, or null if blocked.
 */
const _jump = (
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  goalGx: number,
  goalGy: number,
  gridW: number,
  gridH: number,
  isWalkable: (gx: number, gy: number) => boolean,
): [number, number] | null => {
  const nx = cx + dx;
  const ny = cy + dy;

  // Out of bounds or blocked
  if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH || !isWalkable(nx, ny)) {
    return null;
  }

  // Reached goal
  if (nx === goalGx && ny === goalGy) {
    return [nx, ny];
  }

  // Diagonal jump: check cardinal components
  if (dx !== 0 && dy !== 0) {
    // Check horizontal and vertical components for jump points
    if (
      _jump(nx, ny, dx, 0, goalGx, goalGy, gridW, gridH, isWalkable) !== null ||
      _jump(nx, ny, 0, dy, goalGx, goalGy, gridW, gridH, isWalkable) !== null
    ) {
      return [nx, ny];
    }
  }

  // Check for forced neighbors
  if (_hasForcedNeighbor(nx, ny, dx, dy, gridW, isWalkable)) {
    return [nx, ny];
  }

  // Cardinal jump: continue scanning
  if (dx !== 0 && dy === 0) {
    return _jump(nx, ny, dx, dy, goalGx, goalGy, gridW, gridH, isWalkable);
  }

  if (dx === 0 && dy !== 0) {
    return _jump(nx, ny, dx, dy, goalGx, goalGy, gridW, gridH, isWalkable);
  }

  // Diagonal: continue jumping diagonally
  return _jump(nx, ny, dx, dy, goalGx, goalGy, gridW, gridH, isWalkable);
};

// ---------------------------------------------------------------------------
// Forced neighbor detection
// ---------------------------------------------------------------------------

/**
 * Checks if a node has forced neighbors in the given movement direction.
 *
 * Forced neighbors are adjacent cells that would be unreachable if we
 * didn't stop at this node. They occur when a blocked cell adjacent to
 * the movement path creates a "corner" that must be handled.
 */
const _hasForcedNeighbor = (
  gx: number,
  gy: number,
  dx: number,
  dy: number,
  gridW: number,
  isWalkable: (gx: number, gy: number) => boolean,
): boolean => {
  // Cardinal movement forced neighbor check
  if (dx > 0 && dy === 0) {
    // Moving right: check top-right and bottom-right
    return (
      _isForced(gx, gy, 1, -1, 0, -1, gridW, isWalkable) ||
      _isForced(gx, gy, 1, 1, 0, 1, gridW, isWalkable)
    );
  }

  if (dx < 0 && dy === 0) {
    // Moving left: check top-left and bottom-left
    return (
      _isForced(gx, gy, -1, -1, 0, -1, gridW, isWalkable) ||
      _isForced(gx, gy, -1, 1, 0, 1, gridW, isWalkable)
    );
  }

  if (dx === 0 && dy > 0) {
    // Moving down: check bottom-left and bottom-right
    return (
      _isForced(gx, gy, -1, 1, -1, 0, gridW, isWalkable) ||
      _isForced(gx, gy, 1, 1, 1, 0, gridW, isWalkable)
    );
  }

  if (dx === 0 && dy < 0) {
    // Moving up: check top-left and top-right
    return (
      _isForced(gx, gy, -1, -1, -1, 0, gridW, isWalkable) ||
      _isForced(gx, gy, 1, -1, 1, 0, gridW, isWalkable)
    );
  }

  // Diagonal movement forced neighbor check
  if (dx > 0 && dy > 0) {
    // Moving down-right
    return (
      _isForced(gx, gy, -1, 1, -1, 0, gridW, isWalkable) ||
      _isForced(gx, gy, 1, -1, 0, -1, gridW, isWalkable)
    );
  }

  if (dx < 0 && dy > 0) {
    // Moving down-left
    return (
      _isForced(gx, gy, 1, 1, 1, 0, gridW, isWalkable) ||
      _isForced(gx, gy, -1, -1, 0, -1, gridW, isWalkable)
    );
  }

  if (dx > 0 && dy < 0) {
    // Moving up-right
    return (
      _isForced(gx, gy, -1, -1, -1, 0, gridW, isWalkable) ||
      _isForced(gx, gy, 1, 1, 0, 1, gridW, isWalkable)
    );
  }

  if (dx < 0 && dy < 0) {
    // Moving up-left
    return (
      _isForced(gx, gy, 1, -1, 1, 0, gridW, isWalkable) ||
      _isForced(gx, gy, -1, 1, 0, 1, gridW, isWalkable)
    );
  }

  return false;
};

/**
 * Checks a single forced neighbor condition.
 *
 * A neighbor cell (nx + obstacleDx, ny + obstacleDy) is a forced neighbor if:
 * - The cell in direction (nx + forcedDx, ny + forcedDy) is walkable
 * - AND the cell at (nx + obstacleDx, ny + obstacleDy) is blocked
 */
const _isForced = (
  gx: number,
  gy: number,
  forcedDx: number,
  forcedDy: number,
  obstacleDx: number,
  obstacleDy: number,
  gridW: number,
  isWalkable: (gx: number, gy: number) => boolean,
): boolean => {
  const forcedX = gx + forcedDx;
  const forcedY = gy + forcedDy;
  const obstacleX = gx + obstacleDx;
  const obstacleY = gy + obstacleDy;

  // Out of bounds checks
  if (obstacleX < 0 || obstacleX >= gridW || obstacleY < 0) {
    return false;
  }
  if (forcedX < 0 || forcedX >= gridW || forcedY < 0) {
    return false;
  }

  return isWalkable(forcedX, forcedY) && !isWalkable(obstacleX, obstacleY);
};

// ---------------------------------------------------------------------------
// Heuristics
// ---------------------------------------------------------------------------

/**
 * Octile distance heuristic for 8-directional grid movement.
 *
 * Uses min(dx, dy) * sqrt(2) + |dx - dy| for diagonal-aware estimation.
 *
 * @returns Estimated cost from (ax, ay) to (bx, by).
 */
const _octileHeuristic = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  const Sqrt2Minus1 = 0.4142135623730951;
  return Math.max(dx, dy) + Sqrt2Minus1 * Math.min(dx, dy);
};

/**
 * Octile distance between two adjacent or jump-reachable nodes.
 */
const _octileDistance = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  if (dx === 1 && dy === 1) {
    return Math.SQRT2; // Diagonal move cost
  }
  return dx + dy; // Cardinal moves: sum of steps
};

// ---------------------------------------------------------------------------
// Path reconstruction
// ---------------------------------------------------------------------------

/**
 * Reconstructs the path from start to goal by walking the ParentMap.
 *
 * @param buffers - Pathfinder memory buffers.
 * @param startNodeId - Start node ID.
 * @param goalNodeId - Goal node ID.
 * @param gridWidth - Grid width for coordinate conversion.
 * @returns Array of [gx, gy] coordinates.
 */
const _reconstructPath = (
  buffers: PathfinderMemoryBuffers,
  startNodeId: number,
  goalNodeId: number,
  gridWidth: number,
): Array<[number, number]> => {
  const path: Array<[number, number]> = [];
  let current = goalNodeId;

  // Safety limit to prevent infinite loops
  let safety = 0;
  const maxPathLen = buffers.parentMap.length;

  while (current !== startNodeId && safety < maxPathLen) {
    path.push(fromNodeId(current, gridWidth));
    current = buffers.parentMap[current];
    if (current < 0) {
      break;
    }
    safety++;
  }

  path.push(fromNodeId(startNodeId, gridWidth));
  path.reverse();
  return path;
};
