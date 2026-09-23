// scripts/src/lib/ops/emberwatch_map_bridge_route.ts
//
// C-549 — "the crossing is on the route" validation.
//
// A bridge that is merely reachable is not enough: a crossing that the player
// can walk past, or that sits off the natural path to the place it serves,
// reads as decoration. This rule asserts that a named crossing lies ON the
// shortest walkable path between two named anchors, using the same
// walkability grid (terrain + collision + solid prop origins) every other rule
// uses and the breadth-first `shortestPath` helper.
//
// The anchor pairs are authored data, not discovered: a route assertion needs
// to know which cells are the two ends of the journey it cares about. When an
// anchor cell is blocked the rule SKIPS (the walkability rules already report
// that as a blocker with a better message) rather than failing twice.

import { isWalkable, shortestPath } from './emberwatch_map_navigation.ts';
import type { MapContext, ValidationFinding } from './emberwatch_map_validation_context.ts';

/** A cell rectangle, inclusive on both ends. */
type Cells = { c0: number; r0: number; c1: number; r1: number };

/** A named pair of endpoints plus the cells a correct route must traverse. */
type RouteAssertion = {
  /** Rule subject, e.g. `square→notice_board`. */
  label: string;
  from: Cells;
  to: Cells;
  /** The crossing span; the shortest path must include at least one of its cells. */
  via: Cells;
};

/** Human-readable description of a cell rectangle, for finding text. */
const describeCells = (cells: Cells): string =>
  `(${cells.c0},${cells.r0})–(${cells.c1},${cells.r1})`;

/** Every cell in an inclusive rectangle. */
const rectangleCells = (cells: Cells): Array<{ c: number; r: number }> => {
  const out: Array<{ c: number; r: number }> = [];
  for (let r = cells.r0; r <= cells.r1; r++) {
    for (let c = cells.c0; c <= cells.c1; c++) {
      out.push({ c, r });
    }
  }
  return out;
};

const inside = (c: number, r: number, cells: Cells): boolean =>
  c >= cells.c0 && c <= cells.c1 && r >= cells.r0 && r <= cells.r1;

/**
 * The shortest-path-through-crossing assertions, by map id.
 *
 * `village` is the C-549 case: the notice board moved to the crossing's north
 * bank, so the board is now reached from the square by going over the span.
 * A crossing that stopped being on that path — because a builder repainted a
 * bank, or someone widened the stream past the approach — fails here with the
 * two anchor regions named, instead of showing up only as a visual oddity.
 */
export const BRIDGE_ROUTE_ASSERTIONS: Record<string, readonly RouteAssertion[]> = {
  village: [
    {
      label: 'square→notice_board',
      // The square's walkable paving inside the ward ring's west arc, and the
      // notice-board pad's walkable cells. Both rectangles span more than one
      // cell so a prop or a paving change inside them does not silently
      // invalidate the assertion.
      from: { c0: 31, r0: 21, c1: 33, r1: 23 },
      to: { c0: 35, r0: 5, c1: 36, r1: 5 },
      via: { c0: 36, r0: 7, c1: 37, r1: 8 },
    },
  ],
};

const finding = (
  rule: string,
  map: string,
  subject: string,
  detail: string,
): ValidationFinding => ({ rule, severity: 'error', map, subject, detail });

/**
 * A walkable cell in `cells` that the map's own arrival spawns can actually
 * reach, preferring the rectangle's row-major first cell.
 *
 * Reachability matters, not just walkability: the route assertion is about the
 * path a player takes from where they arrive, so an anchor cell walled off
 * from the arrivals would make the answer meaningless. A rectangle with no
 * reachable cell returns `undefined` and the rule skips (the connectivity rules
 * report the isolation).
 */
const firstReachable = (context: MapContext, cells: Cells): { c: number; r: number } | undefined =>
  rectangleCells(cells).find(
    (cell) =>
      isWalkable(context.grid, cell.c, cell.r) &&
      context.reachable[cell.r * context.grid.width + cell.c] === 1,
  );

/** Asserts one route: reachable, and its shortest path touches the crossing. */
const routeFindings = (context: MapContext, assertion: RouteAssertion): ValidationFinding[] => {
  const from = firstReachable(context, assertion.from);
  const to = firstReachable(context, assertion.to);
  if (!from || !to) {
    // The blocked endpoint itself is already a blocker elsewhere (an
    // `npc-on-blocked-cell`/`unreachable-anchor`/route-width finding). This
    // rule only speaks about routes between walkable anchors.
    return [];
  }
  const path = shortestPath(context.grid, from, to);
  if (!path) {
    return [
      finding(
        'crossing-route-unreachable',
        context.id,
        assertion.label,
        `no walkable route from ${describeCells(assertion.from)} to ${describeCells(assertion.to)}`,
      ),
    ];
  }
  const crosses = path.some((cell) => inside(cell.c, cell.r, assertion.via));
  if (crosses) {
    return [];
  }
  return [
    finding(
      'crossing-not-on-shortest-route',
      context.id,
      assertion.label,
      `the shortest route (${path.length} cells) from ${describeCells(assertion.from)} to ` +
        `${describeCells(assertion.to)} never touches the crossing at ${describeCells(assertion.via)} — ` +
        'the crossing is bypassable, so it does not read as the way there',
    ),
  ];
};

/** Runs every authored crossing-route assertion for a map. */
export const validateBridgeRoutes = (context: MapContext, findings: ValidationFinding[]): void => {
  for (const assertion of BRIDGE_ROUTE_ASSERTIONS[context.id] ?? []) {
    findings.push(...routeFindings(context, assertion));
  }
};
