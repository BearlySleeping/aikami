// scripts/src/lib/ops/emberwatch_village_crossing.test.ts
//
// C-549 — the village crossing on the straight E–W reach, the re-routed
// notice-board approach, and the authored crossing-route assertion.
//
// These read the BUILDERS (not the committed JSON) so a builder edit cannot
// drift from its own test, plus the real pack for the route rule.

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BRIDGE_FRAMES, G, isBridgeGid } from './emberwatch_authoring.ts';
import { BRIDGE_ROUTE_ASSERTIONS, validateBridgeRoutes } from './emberwatch_map_bridge_route.ts';
import { cellOfPoint, cloneGrid, gridIndex, reachableFrom } from './emberwatch_map_navigation.ts';
import { buildVillage } from './emberwatch_map_retained.ts';
import { validateEmberwatchMaps } from './emberwatch_map_validation.ts';
import {
  buildContexts,
  type Manifest,
  packRoot,
  readJson,
  type ValidationFinding,
} from './emberwatch_map_validation_context.ts';

/** The village builder is re-exported through the retained module. */
const { map } = buildVillage();
const at = (c: number, r: number): number => r * map.width + c;
const groundAt = (c: number, r: number): number => map.ground[at(c, r)] ?? -1;
const blockedAt = (c: number, r: number): boolean => map.collision[at(c, r)] === 1;

const villageContext = buildContexts(readJson<Manifest>(join(packRoot, 'manifest.json'))).get(
  'village',
);
if (villageContext === undefined) {
  throw new Error('C-549 route test fixture is missing the village map');
}

describe('C-549 — the crossing sits on the straight E–W reach', () => {
  const SPAN = [
    [36, 7],
    [37, 7],
    [38, 7],
    [36, 8],
    [37, 8],
    [38, 8],
  ] as const;

  test('every span cell carries a bridge-assembly frame and is walkable', () => {
    for (const [c, r] of SPAN) {
      expect(isBridgeGid(groundAt(c, r)), `(${c},${r}) is a bridge frame`).toBe(true);
      expect(blockedAt(c, r), `(${c},${r}) is walkable`).toBe(false);
    }
  });

  test('the span is 3×2 at cols 36–38 × rows 7–8 with rails on the long sides', () => {
    // axis 'ns' → the long sides are the outer columns, so the rail frames sit
    // on cols 36 and 38 and the travel ends are rows 7 and 8.
    expect(groundAt(36, 7)).toBe(BRIDGE_FRAMES.cornerNwNs);
    expect(groundAt(37, 7)).toBe(BRIDGE_FRAMES.endN);
    expect(groundAt(38, 7)).toBe(BRIDGE_FRAMES.cornerNeNs);
    expect(groundAt(36, 8)).toBe(BRIDGE_FRAMES.cornerSwNs);
    expect(groundAt(37, 8)).toBe(BRIDGE_FRAMES.endS);
    expect(groundAt(38, 8)).toBe(BRIDGE_FRAMES.cornerSeNs);
  });

  test('both travel ends are dry land and both long sides are water', () => {
    for (const c of [36, 37, 38]) {
      expect(groundAt(c, 6), `north end (${c},6) is land`).not.toBe(G.WATER);
      expect(blockedAt(c, 6), `north end (${c},6) is walkable`).toBe(false);
      expect(groundAt(c, 9), `south end (${c},9) is land`).not.toBe(G.WATER);
      expect(blockedAt(c, 9), `south end (${c},9) is walkable`).toBe(false);
    }
    for (const r of [7, 8]) {
      expect(groundAt(35, r), `west long side (35,${r}) is water`).toBe(G.WATER);
      expect(groundAt(39, r), `east long side (39,${r}) is water`).toBe(G.WATER);
    }
  });

  test('the E–W reach is two rows deep (7–8) from its west end to the elbow', () => {
    // West end col 26 (where the reach turns south) through the elbow col 40,
    // minus the three-column crossing span itself.
    for (let c = 26; c <= 39; c++) {
      if (c >= 36 && c <= 38) {
        continue;
      }
      expect(groundAt(c, 7), `(${c},7) is water`).toBe(G.WATER);
      expect(groundAt(c, 8), `(${c},8) is water`).toBe(G.WATER);
    }
    // The elbow cell itself is water too (the N–S reach, not a crossing).
    expect(groundAt(40, 7)).toBe(G.WATER);
    expect(groundAt(40, 8)).toBe(G.WATER);
  });

  test('the elbow carries no bridge: the N–S reach is a plain water column', () => {
    // The N–S reach comes down at col 40 and meets the E–W reach without a
    // crossing, so the elbow cells are water (or bank) and NOT bridge frames.
    for (let r = 3; r <= 8; r++) {
      expect(isBridgeGid(groundAt(40, r)), `elbow (40,${r}) carries no bridge`).toBe(false);
    }
  });

  test('no bridge frame remains anywhere on the old 39–41 span', () => {
    for (let r = 6; r <= 10; r++) {
      for (let c = 39; c <= 41; c++) {
        expect(isBridgeGid(groundAt(c, r)), `old span (${c},${r}) is clear`).toBe(false);
      }
    }
  });
});

describe('C-549 — the notice-board approach meets the crossing on both banks', () => {
  test('the south approach links the existing path to the span with an organic contour', () => {
    // The dirt contour starts exactly at the three bridge columns, then shifts
    // east one cell per row into the existing cols 39–40 path. No repeated span
    // creates the rejected five-by-two slab.
    for (const c of [36, 37, 38]) {
      expect(groundAt(c, 9), `(${c},9) south-bank approach is dirt`).toBe(G.DIRT);
    }
    for (const [row, columns] of [
      [9, [36, 37, 38]],
      [10, [37, 38, 39]],
      [11, [38, 39]],
      [12, [39, 40]],
      [13, [39, 40]],
    ] as const) {
      const actual = Array.from({ length: 6 }, (_, index) => index + 35).filter(
        (column) => groundAt(column, row) === G.DIRT,
      );
      expect(actual, `crossing approach row ${row}`).toEqual([...columns]);
    }
    expect(groundAt(39, 8), '(39,8) east bank remains river').toBe(G.WATER);
  });

  test('the north approach links the span to the notice-board walk', () => {
    for (const c of [36, 37, 38]) {
      expect(groundAt(c, 6), `(${c},6) north-bank approach is dirt`).toBe(G.DIRT);
      expect(blockedAt(c, 6), `(${c},6) north-bank approach is walkable`).toBe(false);
    }
    expect(groundAt(35, 6), '(35,6) west bank remains sand').toBe(G.SAND);
    expect(groundAt(39, 6), '(39,6) east bank remains sand').toBe(G.SAND);
  });

  test('the board has a short worn landing instead of a broad dirt pad', () => {
    const padSpans: ReadonlyArray<readonly [number, number, number]> = [
      [5, 36, 38],
      [6, 36, 38],
    ];
    for (const [r, c0, c1] of padSpans) {
      for (let c = c0; c <= c1; c++) {
        expect(blockedAt(c, r), `board pad (${c},${r}) is walkable`).toBe(false);
        expect(groundAt(c, r), `board pad (${c},${r}) is worn earth`).toBe(G.DIRT);
      }
    }
    // The board keeps a grass surround; only the short approach is dirt.
    for (const [c, r] of [
      [36, 4],
      [38, 4],
      [35, 5],
      [39, 5],
    ] as const) {
      expect(groundAt(c, r), `(${c},${r}) is outside the short landing`).not.toBe(G.DIRT);
    }
  });
});

describe('C-549 — the crossing is on the shortest route from the square to the board', () => {
  test('the village crossing-route assertion is registered', () => {
    expect(BRIDGE_ROUTE_ASSERTIONS.village.length).toBeGreaterThan(0);
  });

  test('accepts the real village route through the authored crossing', () => {
    const findings: ValidationFinding[] = [];
    validateBridgeRoutes(villageContext, findings);
    expect(findings).toEqual([]);
  });

  test('reports crossing-not-on-shortest-route when a ford bypasses the span', () => {
    const fordContext = {
      ...villageContext,
      grid: cloneGrid(villageContext.grid),
      reachable: new Uint8Array(villageContext.grid.blocked.length),
    };
    // Close the authored span in this hypothesis, then carve a ford west of
    // it. Without the close, the real three-column bridge remains the shorter
    // route and a second dry cell would not prove the rule can fire.
    for (const c of [36, 37, 38]) {
      for (const r of [7, 8]) {
        fordContext.grid.blocked[gridIndex(fordContext.grid, c, r)] = 1;
      }
    }
    for (const c of [32, 33]) {
      for (const r of [7, 8]) {
        fordContext.grid.blocked[gridIndex(fordContext.grid, c, r)] = 0;
      }
    }
    const fordReachable = new Uint8Array(new ArrayBuffer(villageContext.grid.blocked.length));
    fordReachable.set(
      reachableFrom(
        fordContext.grid,
        villageContext.spawns.map((spawn) => cellOfPoint(spawn.x, spawn.y)),
      ),
    );
    fordContext.reachable = fordReachable;

    const findings: ValidationFinding[] = [];
    validateBridgeRoutes(fordContext, findings);
    expect(
      findings.filter((finding) => finding.rule === 'crossing-not-on-shortest-route'),
    ).toHaveLength(1);
    expect(findings.map((finding) => finding.rule)).toContain('crossing-not-on-shortest-route');
  });

  test('the real pack has no crossing-route blocker', () => {
    const validation = validateEmberwatchMaps();
    const routeFindings = validation.findings.filter((entry) => entry.rule.startsWith('crossing-'));
    expect(routeFindings).toEqual([]);
  });
});

describe('C-549 — the village grass variants are a minority of the grass', () => {
  test('neither variant outnumbers the base, so the map is not a two-tone checker', () => {
    let grass = 0;
    let dark = 0;
    let variant = 0;
    for (let i = 0; i < map.ground.length; i++) {
      if (map.ground[i] === G.GRASS) {
        grass += 1;
      } else if (map.ground[i] === G.GRASS_DARK) {
        dark += 1;
      } else if (map.ground[i] === G.GRASS_VARIANT) {
        variant += 1;
      }
    }
    expect(grass).toBeGreaterThan(0);
    // Both variants stay well under half so the base still dominates and the
    // map does not read as a two-tone checker.
    expect(dark).toBeLessThan(grass);
    expect(variant).toBeLessThan(grass);
  });
});
