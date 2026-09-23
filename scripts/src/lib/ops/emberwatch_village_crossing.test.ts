// scripts/src/lib/ops/emberwatch_village_crossing.test.ts
//
// C-549 — the village crossing on the straight E–W reach, the re-routed
// notice-board approach, and the authored crossing-route assertion.
//
// These read the BUILDERS (not the committed JSON) so a builder edit cannot
// drift from its own test, plus the real pack for the route rule.

import { describe, expect, test } from 'bun:test';
import { BRIDGE_FRAMES, G, isBridgeGid } from './emberwatch_authoring.ts';
import { buildVillage } from './emberwatch_map_retained.ts';
import { validateEmberwatchMaps } from './emberwatch_map_validation.ts';

/** The village builder is re-exported through the retained module. */
const { map } = buildVillage();
const at = (c: number, r: number): number => r * map.width + c;
const groundAt = (c: number, r: number): number => map.ground[at(c, r)] ?? -1;
const blockedAt = (c: number, r: number): boolean => map.collision[at(c, r)] === 1;

describe('C-549 — the crossing sits on the straight E–W reach', () => {
  const SPAN = [
    [36, 7],
    [37, 7],
    [36, 8],
    [37, 8],
  ] as const;

  test('every span cell carries a bridge-assembly frame and is walkable', () => {
    for (const [c, r] of SPAN) {
      expect(isBridgeGid(groundAt(c, r)), `(${c},${r}) is a bridge frame`).toBe(true);
      expect(blockedAt(c, r), `(${c},${r}) is walkable`).toBe(false);
    }
  });

  test('the span is 2×2 at cols 36–37 × rows 7–8 with rails on the long sides', () => {
    // axis 'ns' → the long sides are the columns, so the rail frames sit on
    // col 36 (west) and col 37 (east) and the travel ends are rows 7 and 8.
    expect(groundAt(36, 7)).toBe(BRIDGE_FRAMES.cornerNwNs);
    expect(groundAt(37, 7)).toBe(BRIDGE_FRAMES.cornerNeNs);
    expect(groundAt(36, 8)).toBe(BRIDGE_FRAMES.cornerSwNs);
    expect(groundAt(37, 8)).toBe(BRIDGE_FRAMES.cornerSeNs);
  });

  test('both travel ends are dry land and both long sides are water', () => {
    for (const c of [36, 37]) {
      expect(groundAt(c, 6), `north end (${c},6) is land`).not.toBe(G.WATER);
      expect(blockedAt(c, 6), `north end (${c},6) is walkable`).toBe(false);
      expect(groundAt(c, 9), `south end (${c},9) is land`).not.toBe(G.WATER);
      expect(blockedAt(c, 9), `south end (${c},9) is walkable`).toBe(false);
    }
    for (const r of [7, 8]) {
      expect(groundAt(35, r), `west long side (35,${r}) is water`).toBe(G.WATER);
      expect(groundAt(38, r), `east long side (38,${r}) is water`).toBe(G.WATER);
    }
  });

  test('the E–W reach is two rows deep (7–8) from its west end to the elbow', () => {
    // West end col 26 (where the reach turns south) through the elbow col 40,
    // minus the two-column crossing span itself.
    for (let c = 26; c <= 39; c++) {
      if (c === 36 || c === 37) {
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
  test('the south approach links the existing path at cols 39–40 to the span', () => {
    // The existing dirt path runs north at cols 39–40; the approach row 9 ties
    // it to the span's south end, and the span's south end is walkable dirt.
    expect(groundAt(39, 9), '(39,9) is the existing path').toBe(G.DIRT);
    expect(groundAt(36, 9), '(36,9) south-bank approach is dirt').toBe(G.DIRT);
    expect(groundAt(37, 9), '(37,9) south-bank approach is dirt').toBe(G.DIRT);
  });

  test('the north approach links the span to the notice-board walk', () => {
    for (const c of [36, 37]) {
      expect(groundAt(c, 6), `(${c},6) north-bank approach is dirt`).toBe(G.DIRT);
      expect(blockedAt(c, 6), `(${c},6) north-bank approach is walkable`).toBe(false);
    }
  });

  test('the board sits on the crossing side of the stream and stays walkable around', () => {
    // Rows 3–6 are north of the widened E–W reach: the board moved there, so
    // the approach from the square has to use the crossing. The pad is worn
    // earth, not paving (C-549) — the stone floor painter is out of scope.
    for (let r = 3; r <= 6; r++) {
      for (let c = 34; c <= 39; c++) {
        if (c === 37 && r === 4) {
          // The board prop's own origin cell is solid.
          continue;
        }
        expect(blockedAt(c, r), `board pad (${c},${r}) is walkable`).toBe(false);
        expect(groundAt(c, r), `board pad (${c},${r}) is worn earth`).toBe(G.DIRT);
      }
    }
  });
});

describe('C-549 — the crossing is on the shortest route from the square to the board', () => {
  test('the real pack has no crossing-route blocker', () => {
    const validation = validateEmberwatchMaps();
    const routeFindings = validation.findings.filter((entry) => entry.rule.startsWith('crossing-'));
    expect(routeFindings).toEqual([]);
  });

  test('the assertion is registered for the village map and passes on it', () => {
    const validation = validateEmberwatchMaps();
    const village = validation.maps.find((summary) => summary.id === 'village');
    expect(village).toBeDefined();
    expect(validation.blockers.filter((entry) => entry.map === 'village')).toEqual([]);
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
