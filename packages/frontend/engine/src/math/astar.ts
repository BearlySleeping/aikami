// packages/frontend/engine/src/math/astar.ts
//
// Weighted A* pathfinding (C-379 AC-6) — replaces math/jps.
//
// Maps at this scale (20×20 to 200×200) complete a full A* search in tens
// of microseconds synchronously, so no time-slicing is needed. Unlike JPS,
// A* honours weighted movement costs (C-378 terrain cost × 16) and is
// trivially correct with diagonals when corner-cutting is suppressed.
//
// Performance: search state (heap, g-scores, came-from, closed) is cached
// in module-level typed arrays and reused across calls, so repeated path
// requests never re-allocate. A full 200×200 worst-case grid resolves well
// under the 2ms budget (AC-6).

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single grid cell coordinate. */
export type GridCell = {
  x: number;
  y: number;
};

/**
 * Input grid for the A* search.
 *
 * `cost` is a row-major Uint8Array: 0 = impassable, otherwise movement
 * cost × 16 (1.0 → 16, 0.8 → 13). Cost is a byte so the grid is memory-
 * cheap and reads are cache-friendly.
 */
export type AstarGrid = {
  width: number;
  height: number;
  cost: Uint8Array;
};

/** Result of a search: the waypoint path (start..goal inclusive) or empty. */
export type AstarResult = {
  /** Path cells from start to goal inclusive. Empty when unreachable. */
  path: GridCell[];
  /** Total movement cost along the path. */
  totalCost: number;
  /** Nodes expanded during the search (observability, AC-6). */
  expanded: number;
  /** Elapsed wall-clock time in ms (observability, AC-6). */
  elapsedMs: number;
};

// ---------------------------------------------------------------------------
// Reusable search state (zero per-call allocation)
// ---------------------------------------------------------------------------

/** Cached capacity — grows to the largest grid seen, never shrinks. */
let _capacity = 0;

/** Reusable binary min-heap (nodeId → f). */
let _heap: Int32Array | undefined;
let _heapF: Float64Array | undefined;
let _heapSize = 0;

/** Reusable g-scores (index → best known cost). */
let _gScore: Float64Array | undefined;

/** Reusable came-from (index → parent node id, -1 = none). */
let _cameFrom: Int32Array | undefined;

/** Reusable closed set (index → 0/1). */
let _closed: Uint8Array | undefined;

/** Ensures the cached buffers are large enough for a cellCount. */
const _ensureCapacity = (cellCount: number): void => {
  if (_capacity >= cellCount) {
    return;
  }
  _capacity = cellCount;
  // The heap can hold MORE than one entry per cell: every g-score
  // improvement pushes a duplicate node id, and stale entries are only
  // skipped on pop (lazy deletion). Allocate 8× so the search's bounded
  // pushes never overflow; the per-cell arrays stay at cellCount.
  _heap = new Int32Array(cellCount * 8);
  _heapF = new Float64Array(cellCount * 8);
  _gScore = new Float64Array(cellCount);
  _cameFrom = new Int32Array(cellCount);
  _closed = new Uint8Array(cellCount);
};

// ---------------------------------------------------------------------------
// Heap helpers (binary min-heap on node ids, f-scores in _heapF)
// ---------------------------------------------------------------------------

const _heapPush = (nodeId: number, f: number): void => {
  let i = _heapSize++;
  (_heap as Int32Array)[i] = nodeId;
  (_heapF as Float64Array)[i] = f;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if ((_heapF as Float64Array)[parent] <= (_heapF as Float64Array)[i]) {
      break;
    }
    const h = (_heap as Int32Array)[parent];
    (_heap as Int32Array)[parent] = (_heap as Int32Array)[i];
    (_heap as Int32Array)[i] = h;
    const fv = (_heapF as Float64Array)[parent];
    (_heapF as Float64Array)[parent] = (_heapF as Float64Array)[i];
    (_heapF as Float64Array)[i] = fv;
    i = parent;
  }
};

const _heapPop = (): number | undefined => {
  if (_heapSize === 0) {
    return undefined;
  }
  const top = (_heap as Int32Array)[0];
  _heapSize--;
  if (_heapSize > 0) {
    (_heap as Int32Array)[0] = (_heap as Int32Array)[_heapSize];
    (_heapF as Float64Array)[0] = (_heapF as Float64Array)[_heapSize];
    let i = 0;
    const half = _heapSize >> 1;
    while (i < half) {
      let child = (i << 1) + 1;
      const right = child + 1;
      if (right < _heapSize && (_heapF as Float64Array)[right] < (_heapF as Float64Array)[child]) {
        child = right;
      }
      if ((_heapF as Float64Array)[child] >= (_heapF as Float64Array)[i]) {
        break;
      }
      const h = (_heap as Int32Array)[child];
      (_heap as Int32Array)[child] = (_heap as Int32Array)[i];
      (_heap as Int32Array)[i] = h;
      const fv = (_heapF as Float64Array)[child];
      (_heapF as Float64Array)[child] = (_heapF as Float64Array)[i];
      (_heapF as Float64Array)[i] = fv;
      i = child;
    }
  }
  return top;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Octile distance heuristic (admissible for 8-connected grids). */
const _octile = (x1: number, y1: number, x2: number, y2: number): number => {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const min = Math.min(dx, dy);
  const max = Math.max(dx, dy);
  return min * Math.SQRT2 + (max - min);
};

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Runs a weighted A* search from start to goal on a cost grid.
 *
 * Eight-directional movement with a corner-cutting guard: a diagonal step
 * is allowed only when both orthogonal neighbours are passable, so a path
 * never clips through a diagonally-adjacent pair of blocked cells.
 *
 * Heuristic: octile distance × minimum cell cost, admissible for
 * 8-connected movement. The min-cost pass keeps the estimate informative
 * (without it, weighted g-scores dwarf the heuristic and A* degenerates to
 * Dijkstra on open grids).
 *
 * Search state is cached and reused — repeated calls allocate nothing.
 *
 * @param grid - The cost grid.
 * @param start - Start cell (in bounds).
 * @param goal - Goal cell (in bounds).
 * @returns The path (start..goal), total cost, expanded count, and timing.
 *   `path` is empty when the goal is unreachable or the start is blocked.
 */
export const findPath = (options: {
  grid: AstarGrid;
  start: GridCell;
  goal: GridCell;
}): AstarResult => {
  const { grid, start, goal } = options;
  const startMs = performance.now();

  const empty = { path: [], totalCost: 0, expanded: 0, elapsedMs: 0 };
  const { width, height, cost } = grid;
  const cellCount = width * height;

  const startIndex = start.y * width + start.x;
  const goalIndex = goal.y * width + goal.x;

  // Bounds + impassable start/goal → no path.
  if (
    start.x < 0 ||
    start.x >= width ||
    start.y < 0 ||
    start.y >= height ||
    goal.x < 0 ||
    goal.x >= width ||
    goal.y < 0 ||
    goal.y >= height
  ) {
    return { ...empty, elapsedMs: performance.now() - startMs };
  }
  if (cost[startIndex] === 0 || cost[goalIndex] === 0) {
    return { ...empty, elapsedMs: performance.now() - startMs };
  }

  _ensureCapacity(cellCount);

  // Minimum cell cost in the grid — scales the heuristic so it stays
  // admissible AND informative.
  let minCost = cost[startIndex];
  for (let i = 0; i < cellCount; i++) {
    const c = cost[i];
    if (c > 0 && c < minCost) {
      minCost = c;
    }
  }

  const gScore = _gScore as Float64Array;
  const cameFrom = _cameFrom as Int32Array;
  const closed = _closed as Uint8Array;
  gScore.fill(Number.POSITIVE_INFINITY);
  cameFrom.fill(-1);
  closed.fill(0);
  _heapSize = 0;

  const startG = cost[startIndex];
  gScore[startIndex] = startG;
  const startH = _octile(start.x, start.y, goal.x, goal.y) * minCost;
  // Epsilon tie-breaking toward the goal: f = g + h × (1 + ε). This keeps
  // gScore exact (the returned totalCost is the true path cost) while
  // making the search expand deeper nodes first on f-ties, which cuts the
  // expanded set dramatically on obstacle grids (36k → ~6k on the
  // segmented-wall case) and keeps the 200×200 budget under 2ms.
  _heapPush(startIndex, startG + startH * 1.001);
  let expanded = 0;

  while (_heapSize > 0) {
    const current = _heapPop() as number;
    if (closed[current] === 1) {
      continue;
    }
    closed[current] = 1;
    expanded++;

    if (current === goalIndex) {
      // Reconstruct path (goal → start).
      const path: GridCell[] = [];
      let node = current;
      while (node !== -1) {
        path.push({ x: node % width, y: Math.floor(node / width) });
        node = cameFrom[node];
      }
      path.reverse();
      return {
        path,
        totalCost: gScore[current],
        expanded,
        elapsedMs: performance.now() - startMs,
      };
    }

    const cx = current % width;
    const cy = Math.floor(current / width);
    const currentG = gScore[current];

    // 8 neighbours — orthogonals first, then diagonals with corner guard.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) {
          continue;
        }
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          continue;
        }

        // Corner-cutting guard: diagonal steps require both orthogonals open.
        if (dx !== 0 && dy !== 0) {
          const straightX = ny * width + nx - dx; // (cx, ny)
          const straightY = cy * width + nx; // (nx, cy)
          if (cost[straightX] === 0 || cost[straightY] === 0) {
            continue;
          }
        }

        const nIndex = ny * width + nx;
        if (closed[nIndex] === 1) {
          continue;
        }
        const stepCost = cost[nIndex];
        if (stepCost === 0) {
          continue;
        }

        const isDiagonal = dx !== 0 && dy !== 0;
        const moveCost = isDiagonal ? stepCost * Math.SQRT2 : stepCost;
        const tentativeG = currentG + moveCost;

        if (tentativeG < gScore[nIndex]) {
          gScore[nIndex] = tentativeG;
          cameFrom[nIndex] = current;
          const h = _octile(nx, ny, goal.x, goal.y) * minCost;
          _heapPush(nIndex, tentativeG + h * 1.001);
        }
      }
    }
  }

  return { ...empty, expanded, elapsedMs: performance.now() - startMs };
};
