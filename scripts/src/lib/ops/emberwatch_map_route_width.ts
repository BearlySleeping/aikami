// scripts/src/lib/ops/emberwatch_map_route_width.ts
//
// Route-aware corridor-width validation for the Emberwatch maps.
//
// This is deliberately separate from the other validation rules: it is the one
// rule that pathfinds. It answers "can a companion-width actor actually get
// from each transition landing to the map's centre?" using the same walkability
// grid as every other rule (terrain + collision + solid prop origins).
//
// Algorithm: a widest-path (maximum-bottleneck) search over the walkable grid.
// Each orthogonal step's weight is the usable clearance PERPENDICULAR to that
// step at both endpoints (a horizontal move needs vertical room and vice versa),
// so a long horizontal run never disguises a one-cell vertical passage. The
// maximum-bottleneck value at the destination is the best corridor width any
// route can offer; `>= COMPANION_SAFE_ROUTE_WIDTH` means at least one route is
// wide enough. A destination that is walkable but unreachable yields 0 and is
// reported as an error, not silently ignored.

import {
  clearanceAt,
  gridIndex,
  isWalkable,
  type WalkabilityGrid,
} from './emberwatch_map_navigation.ts';
import {
  type MapContext,
  rectCells,
  str,
  type ValidationFinding,
} from './emberwatch_map_validation_context.ts';

/** Minimum companion-safe corridor width (cells) for a map-to-map route. */
export const COMPANION_SAFE_ROUTE_WIDTH = 3;

const finding = (
  rule: string,
  severity: ValidationFinding['severity'],
  map: string,
  subject: string,
  detail: string,
): ValidationFinding => ({ rule, severity, map, subject, detail });

const ROUTE_STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

const improveRouteNeighbors = (options: {
  context: MapContext;
  best: Uint16Array;
  queue: number[];
  index: number;
}): void => {
  const { context, best, queue, index } = options;
  const c = index % context.grid.width;
  const r = Math.floor(index / context.grid.width);
  for (const [dc, dr] of ROUTE_STEPS) {
    const nc = c + dc;
    const nr = r + dr;
    if (!isWalkable(context.grid, nc, nr)) {
      continue;
    }
    const step = { dc, dr };
    const edgeClearance = Math.min(
      clearanceAt(context.grid, c, r, step),
      clearanceAt(context.grid, nc, nr, step),
    );
    const next = gridIndex(context.grid, nc, nr);
    const candidate = Math.min(best[index] ?? 0, edgeClearance);
    if (candidate <= (best[next] ?? 0)) {
      continue;
    }
    best[next] = candidate;
    queue.push(next);
  }
};

/** Best achievable corridor width over every route from `from` to `to`. */
const maxRouteClearance = (
  context: MapContext,
  from: { c: number; r: number },
  to: { c: number; r: number },
): number => {
  if (!isWalkable(context.grid, from.c, from.r) || !isWalkable(context.grid, to.c, to.r)) {
    return 0;
  }
  if (from.c === to.c && from.r === to.r) {
    return Math.max(
      clearanceAt(context.grid, from.c, from.r, { dc: 1, dr: 0 }),
      clearanceAt(context.grid, from.c, from.r, { dc: 0, dr: 1 }),
    );
  }
  const best = new Uint16Array(context.grid.width * context.grid.height);
  const queue = [gridIndex(context.grid, from.c, from.r)];
  best[queue[0] ?? 0] = Math.max(context.grid.width, context.grid.height);
  let head = 0;
  while (head < queue.length) {
    const index = queue[head++];
    if (index === undefined) {
      continue;
    }
    improveRouteNeighbors({ context, best, queue, index });
  }
  return best[gridIndex(context.grid, to.c, to.r)] ?? 0;
};

/** Nearest walkable cell to `target`, row-major tie-break; `undefined` if none. */
const nearestWalkableCell = (
  grid: WalkabilityGrid,
  target: { c: number; r: number },
): { c: number; r: number } | undefined => {
  let best: { c: number; r: number } | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let r = 0; r < grid.height; r++) {
    for (let c = 0; c < grid.width; c++) {
      if (!isWalkable(grid, c, r)) {
        continue;
      }
      const distance = Math.abs(c - target.c) + Math.abs(r - target.r);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { c, r };
      }
    }
  }
  return best;
};

/**
 * Validates that every transition has a route of at least
 * {@link COMPANION_SAFE_ROUTE_WIDTH} cells to the map's centre. Unreachable
 * routes are errors; genuinely narrow ones are warnings.
 */
export const validateRouteWidth = (context: MapContext, findings: ValidationFinding[]): void => {
  const centre = nearestWalkableCell(context.grid, {
    c: Math.floor(context.raw.width / 2),
    r: Math.floor(context.raw.height / 2),
  });
  if (!centre) {
    return;
  }
  for (const gate of context.transitions) {
    const starts = rectCells(gate).filter((cell) => isWalkable(context.grid, cell.c, cell.r));
    if (starts.length === 0) {
      // A fully blocked trigger is already a `transition-source-unreachable`
      // error; do not double-report it as a route problem.
      continue;
    }
    const minClearance = starts.reduce(
      (widest, start) => Math.max(widest, maxRouteClearance(context, start, centre)),
      0,
    );
    if (minClearance === 0) {
      findings.push(
        finding(
          'route-unreachable',
          'error',
          context.id,
          `transition:${str(gate.props.targetMap)}`,
          `no walkable route from the transition landing to the map centre (${centre.c},${centre.r})`,
        ),
      );
      continue;
    }
    if (minClearance < COMPANION_SAFE_ROUTE_WIDTH) {
      findings.push(
        finding(
          'route-width-below-minimum',
          'warning',
          context.id,
          `transition:${str(gate.props.targetMap)}`,
          `clearance ${minClearance} cells is below the companion-safe minimum ${COMPANION_SAFE_ROUTE_WIDTH}`,
        ),
      );
    }
  }
};
