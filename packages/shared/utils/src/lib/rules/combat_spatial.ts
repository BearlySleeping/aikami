// packages/shared/utils/src/lib/rules/combat_spatial.ts
//
// Pure spatial primitives for Combat 2.0 — quantization, line of sight and
// movement reachability over a `BattlefieldState`.
//
// This is a LEAF module: it imports only domain types, never another
// rules-layer module, and performs no I/O, ECS, engine, client, AI or network
// access. Every function is a pure function of its arguments and never mutates
// its input.
//
// Module graph (must stay acyclic):
//   combat_spatial.ts  ← combat_kernel.ts
//   combat_spatial.ts  ← combat_tactical.ts ← combat_kernel.ts
//
// Mechanical conventions (architecture §10):
//   - Cells are integer `GridPoint`s; the flat index is `y * width + x`.
//   - Tile centre is `cell * tileSize + tileSize / 2`.
//   - Movement is 4-directional — it matches `validateMove`'s
//     `manhattan(prev, next) === 1` contiguity.
//   - Impassability is the union of three rules: `movementCost[index] === 0`,
//     membership in `blockedCells`, and out-of-bounds.
//   - Absent `movementCost` means uniform cost 1 per step; absent `blocksSight`
//     means "no occlusion data" (every line of sight is clear).
//
// Contract: C-515 AC-2, AC-3, AC-8

import type { BattlefieldState, GridPoint } from '@aikami/types';

// ---------------------------------------------------------------------------
// Cell keys
// ---------------------------------------------------------------------------

/**
 * Canonical map key for a cell — `"x,y"`.
 *
 * Used for `costTo`/`movementCostTo` records so a serialized result is
 * byte-identical across runs (insertion order follows the sorted endpoint
 * list, never a `Set`/`Map` runtime order).
 */
export const cellKey = (cell: GridPoint): string => `${cell.x},${cell.y}`;

/** Parses a {@link cellKey} back into a {@link GridPoint}. */
export const keyToCell = (key: string): GridPoint => {
  const separator = key.indexOf(',');
  return {
    x: Number.parseInt(key.slice(0, separator), 10),
    y: Number.parseInt(key.slice(separator + 1), 10),
  };
};

// ---------------------------------------------------------------------------
// Quantization (AC-8)
// ---------------------------------------------------------------------------

export type WorldPixelToCellOptions = {
  /** World pixel X. */
  px: number;
  /** World pixel Y. */
  py: number;
  /** Tile size in world pixels — `getTerrainTileSize()`, never a literal. */
  tileSize: number;
};

/**
 * Maps a world pixel position to the cell that contains it.
 *
 * `Math.floor`, never `Math.trunc`: the two differ for negative coordinates
 * (`-1 / 32` floors to cell `-1`, truncates to cell `0`).
 */
export const worldPixelToCell = (options: WorldPixelToCellOptions): GridPoint => ({
  x: Math.floor(options.px / options.tileSize),
  y: Math.floor(options.py / options.tileSize),
});

export type CellToWorldPixelOptions = {
  cell: GridPoint;
  /** Tile size in world pixels — `getTerrainTileSize()`, never a literal. */
  tileSize: number;
};

/**
 * Maps a cell to its centre in world pixels — `cell * tileSize + tileSize / 2`.
 *
 * The centre (not the corner) is the convention every consumer must agree on.
 */
export const cellToWorldPixel = (options: CellToWorldPixelOptions): { x: number; y: number } => ({
  x: options.cell.x * options.tileSize + options.tileSize / 2,
  y: options.cell.y * options.tileSize + options.tileSize / 2,
});

// ---------------------------------------------------------------------------
// Battlefield queries
// ---------------------------------------------------------------------------

/** Whether a cell is inside the battlefield bounds. */
export const isCellInBounds = (options: {
  battlefield: BattlefieldState;
  cell: GridPoint;
}): boolean => {
  const { battlefield, cell } = options;
  return cell.x >= 0 && cell.y >= 0 && cell.x < battlefield.width && cell.y < battlefield.height;
};

/** Traversal cost of an in-bounds, passable cell (cells, 1 = flat ground). */
export const cellTraversalCost = (options: {
  battlefield: BattlefieldState;
  cell: GridPoint;
}): number => {
  const { battlefield, cell } = options;
  const cost = battlefield.movementCost;
  if (cost === undefined) {
    return 1;
  }
  const value = cost[cell.y * battlefield.width + cell.x];
  return value === undefined ? 1 : value;
};

/**
 * Impassability for movement: out of bounds, cost `0`, or listed in
 * `blockedCells`. Occupancy is a caller concern (`occupied` on
 * {@link computeReachableEndpoints}) — it never blocks line of sight.
 */
export const isCellImpassable = (options: {
  battlefield: BattlefieldState;
  cell: GridPoint;
}): boolean => {
  const { battlefield, cell } = options;
  if (!isCellInBounds(options)) {
    return true;
  }
  if (battlefield.blockedCells.some((blocked) => blocked.x === cell.x && blocked.y === cell.y)) {
    return true;
  }
  const cost = battlefield.movementCost;
  if (cost === undefined) {
    return false;
  }
  return (cost[cell.y * battlefield.width + cell.x] ?? 0) === 0;
};

// ---------------------------------------------------------------------------
// Line of sight (AC-3)
// ---------------------------------------------------------------------------

export type HasLineOfSightOptions = {
  battlefield: BattlefieldState;
  from: GridPoint;
  to: GridPoint;
};

/**
 * Integer Bresenham line of sight over `battlefield.blocksSight`.
 *
 * Origin and target cells are skipped (a unit standing in a doorway must be
 * able to see out). An absent `blocksSight` grid means "no occlusion data" —
 * every line is clear, which keeps every C-509 fixture valid.
 *
 * Occupancy is deliberately NOT consulted: only terrain makes a cell opaque.
 */
export const hasLineOfSight = (options: HasLineOfSightOptions): boolean => {
  const { battlefield, from, to } = options;
  const blocksSight = battlefield.blocksSight;
  if (blocksSight === undefined) {
    return true;
  }
  if (from.x === to.x && from.y === to.y) {
    return true;
  }

  const width = battlefield.width;
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const stepX = from.x < to.x ? 1 : -1;
  const stepY = from.y < to.y ? 1 : -1;

  let x = from.x;
  let y = from.y;
  let err = dx - dy;
  let firstStep = true;

  // A Bresenham line visits at most `dx + dy + 1` cells — bounded loop.
  for (let step = 0; step <= dx + dy; step++) {
    const isTarget = x === to.x && y === to.y;
    if (!firstStep && !isTarget && blocksSight[y * width + x] === true) {
      return false;
    }
    firstStep = false;
    if (isTarget) {
      return true;
    }

    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += stepX;
    }
    if (e2 < dx) {
      err += dx;
      y += stepY;
    }
  }

  return true;
};

// ---------------------------------------------------------------------------
// Reachability (AC-2)
// ---------------------------------------------------------------------------

/** 4-directional adjacency — matches `validateMove`'s contiguity rule. */
const NEIGHBOUR_OFFSETS: readonly GridPoint[] = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
];

export type ComputeReachableEndpointsOptions = {
  battlefield: BattlefieldState;
  origin: GridPoint;
  /** Movement cells available this turn. */
  movementBudget: number;
  /** Occupied cells — not traversable and never reported as endpoints. */
  occupied?: readonly GridPoint[];
};

export type ReachableEndpoints = {
  /** Reachable cells at cost ≤ budget, sorted by `y` then `x` (origin excluded). */
  endpoints: GridPoint[];
  /** Shortest-path cost per endpoint, keyed `"x,y"` in endpoint order. */
  costTo: Record<string, number>;
};

/**
 * Dijkstra over the battlefield cost grid, bounded by `movementBudget`.
 *
 * The origin cell is always traversable (a unit always stands somewhere) and is
 * never reported as an endpoint. Impassable and occupied cells are neither
 * traversable nor reachable. Output order is deterministic: endpoints sorted by
 * `y` then `x`, with `costTo` keys inserted in that same order.
 */
export const computeReachableEndpoints = (
  options: ComputeReachableEndpointsOptions,
): ReachableEndpoints => {
  const { battlefield, origin, movementBudget } = options;
  const originKey = cellKey(origin);
  const occupiedKeys = new Set<string>();
  for (const cell of options.occupied ?? []) {
    occupiedKeys.add(cellKey(cell));
  }

  const bestCost = new Map<string, number>();
  bestCost.set(originKey, 0);
  const frontier: Array<{ cell: GridPoint; cost: number }> = [
    { cell: { x: origin.x, y: origin.y }, cost: 0 },
  ];

  while (frontier.length > 0) {
    // Linear-scan extract-min: tactical maps are small and this keeps the
    // module allocation-light and dependency-free.
    let bestIndex = 0;
    for (let index = 1; index < frontier.length; index++) {
      if (frontier[index].cost < frontier[bestIndex].cost) {
        bestIndex = index;
      }
    }
    const current = frontier.splice(bestIndex, 1)[0];
    const currentKey = cellKey(current.cell);
    if ((bestCost.get(currentKey) ?? Number.POSITIVE_INFINITY) < current.cost) {
      continue;
    }

    for (const offset of NEIGHBOUR_OFFSETS) {
      const next: GridPoint = { x: current.cell.x + offset.x, y: current.cell.y + offset.y };
      const nextKey = cellKey(next);
      if (nextKey === originKey) {
        continue;
      }
      if (isCellImpassable({ battlefield, cell: next }) || occupiedKeys.has(nextKey)) {
        continue;
      }
      const total = current.cost + cellTraversalCost({ battlefield, cell: next });
      if (total > movementBudget) {
        continue;
      }
      if (total < (bestCost.get(nextKey) ?? Number.POSITIVE_INFINITY)) {
        bestCost.set(nextKey, total);
        frontier.push({ cell: next, cost: total });
      }
    }
  }

  const endpoints = [...bestCost.keys()]
    .filter((key) => key !== originKey)
    .map((key) => keyToCell(key))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const costTo: Record<string, number> = {};
  for (const cell of endpoints) {
    costTo[cellKey(cell)] = bestCost.get(cellKey(cell)) ?? 0;
  }

  return { endpoints, costTo };
};
