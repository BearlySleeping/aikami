// scripts/src/lib/ops/emberwatch_bridge_assembly.test.ts
//
// C-546 — the authored bridge assembly: frame layout, collision footprint,
// bank validation and the atlas frames' pixel shape.

import { describe, expect, test } from 'bun:test';
import {
  BRIDGE_FRAMES,
  collisionRegion,
  G,
  isBridgeGid,
  placeBridge,
  setTile,
  waterRegion,
} from './emberwatch_authoring.ts';
import { makeMap } from './emberwatch_map_shared.ts';
import { packAtlas } from './generate_emberwatch_atlas.ts';

const at = (width: number, c: number, r: number): number => r * width + c;

/**
 * A synthetic crossing: land everywhere, water beside both long sides. The
 * approach ends stay walkable grass.
 */
const makeCrossingMap = (options: {
  width: number;
  height: number;
  axis: 'ns' | 'ew';
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}) => {
  const { width, height, axis, c0, r0, c1, r1 } = options;
  const map = makeMap(width, height);
  if (axis === 'ns') {
    waterRegion(map, { c0: c0 - 1, r0, c1: c0 - 1, r1 });
    waterRegion(map, { c0: c1 + 1, r0, c1: c1 + 1, r1 });
  } else {
    waterRegion(map, { c0, r0: r0 - 1, c1, r1: r0 - 1 });
    waterRegion(map, { c0, r0: r1 + 1, c1, r1: r1 + 1 });
  }
  return map;
};

describe('C-546 — placeBridge frame layout', () => {
  test('north–south 3×2 span: ends on the short sides, rails only at corners', () => {
    const map = makeCrossingMap({ width: 7, height: 6, axis: 'ns', c0: 2, r0: 2, c1: 4, r1: 3 });
    placeBridge(map, { region: { c0: 2, r0: 2, c1: 4, r1: 3 }, axis: 'ns', mapId: 'test_ns' });

    const expected = [
      [BRIDGE_FRAMES.cornerNwNs, BRIDGE_FRAMES.endN, BRIDGE_FRAMES.cornerNeNs],
      [BRIDGE_FRAMES.cornerSwNs, BRIDGE_FRAMES.endS, BRIDGE_FRAMES.cornerSeNs],
    ];
    for (let r = 0; r < expected.length; r++) {
      for (let c = 0; c < (expected[r]?.length ?? 0); c++) {
        expect(map.ground[at(7, 2 + c, 2 + r)], `(${2 + c},${2 + r})`).toBe(expected[r]?.[c]);
      }
    }
  });

  test('east–west 4×3 span: interior only inside, rails on the long sides, ends on the short sides', () => {
    const map = makeCrossingMap({ width: 8, height: 7, axis: 'ew', c0: 2, r0: 2, c1: 5, r1: 4 });
    placeBridge(map, { region: { c0: 2, r0: 2, c1: 5, r1: 4 }, axis: 'ew', mapId: 'test_ew' });

    const expected = [
      [
        BRIDGE_FRAMES.cornerNwEw,
        BRIDGE_FRAMES.railN,
        BRIDGE_FRAMES.railN,
        BRIDGE_FRAMES.cornerNeEw,
      ],
      [BRIDGE_FRAMES.endW, BRIDGE_FRAMES.deckEw, BRIDGE_FRAMES.deckEw, BRIDGE_FRAMES.endE],
      [
        BRIDGE_FRAMES.cornerSwEw,
        BRIDGE_FRAMES.railS,
        BRIDGE_FRAMES.railS,
        BRIDGE_FRAMES.cornerSeEw,
      ],
    ];
    for (let r = 0; r < expected.length; r++) {
      for (let c = 0; c < (expected[r]?.length ?? 0); c++) {
        expect(map.ground[at(8, 2 + c, 2 + r)], `(${2 + c},${2 + r})`).toBe(expected[r]?.[c]);
      }
    }

    // Collision is cleared on exactly the span; the water beside it stays blocked.
    for (let r = 2; r <= 4; r++) {
      for (let c = 2; c <= 5; c++) {
        expect(map.collision[at(8, c, r)], `span (${c},${r})`).toBe(0);
      }
    }
    for (let c = 2; c <= 5; c++) {
      expect(map.collision[at(8, c, 1)], `water above (${c},1)`).toBe(1);
      expect(map.collision[at(8, c, 5)], `water below (${c},5)`).toBe(1);
    }
  });

  test('every placed gid is recognised by isBridgeGid', () => {
    const map = makeCrossingMap({ width: 8, height: 7, axis: 'ew', c0: 2, r0: 2, c1: 5, r1: 4 });
    placeBridge(map, { region: { c0: 2, r0: 2, c1: 5, r1: 4 }, axis: 'ew', mapId: 'test_ew' });
    for (let r = 2; r <= 4; r++) {
      for (let c = 2; c <= 5; c++) {
        expect(isBridgeGid(map.ground[at(8, c, r)]), `(${c},${r})`).toBe(true);
      }
    }
  });
});

describe('C-546 — placeBridge bank validation', () => {
  test('rejects out-of-bounds span endpoints before changing the map', () => {
    const cases = [
      { c0: -1, r0: 1, c1: 1, r1: 2 },
      { c0: 2, r0: 1, c1: 4, r1: 2 },
    ] as const;
    for (const region of cases) {
      const map = makeMap(4, 4);
      const groundBefore = [...map.ground];
      const collisionBefore = [...map.collision];
      expect(() => placeBridge(map, { region, axis: 'ns', assertBanks: false })).toThrow(
        /must be inside the 4×4 map/,
      );
      expect(map.ground).toEqual(groundBefore);
      expect(map.collision).toEqual(collisionBefore);
    }
  });

  test('throws when an approach end cell is water', () => {
    const map = makeCrossingMap({ width: 7, height: 6, axis: 'ns', c0: 2, r0: 2, c1: 4, r1: 3 });
    waterRegion(map, { c0: 3, r0: 1, c1: 3, r1: 1 });
    expect(() =>
      placeBridge(map, { region: { c0: 2, r0: 2, c1: 4, r1: 3 }, axis: 'ns', mapId: 'bad_end' }),
    ).toThrow(/bad_end bridge end\(s\) at \(3,1\)/);
  });

  test('throws when a long-side cell is land', () => {
    const map = makeCrossingMap({ width: 7, height: 6, axis: 'ns', c0: 2, r0: 2, c1: 4, r1: 3 });
    collisionRegion(map, { c0: 1, r0: 2, c1: 1, r1: 3 }, false);
    setTile(map, 1, 2, G.GRASS);
    setTile(map, 1, 3, G.GRASS);
    expect(() =>
      placeBridge(map, { region: { c0: 2, r0: 2, c1: 4, r1: 3 }, axis: 'ns', mapId: 'bad_side' }),
    ).toThrow(/bad_side bridge side\(s\) at \(1,2\), \(1,3\)/);
  });
});

describe('C-546 — bridge atlas frames', () => {
  const atlas = packAtlas();

  const pixel = (key: string, x: number, y: number): [number, number, number, number] => {
    const frame = atlas.frames[key]?.frame;
    if (!frame) {
      throw new Error(`missing atlas frame ${key}`);
    }
    const index = ((frame.y + y) * atlas.width + frame.x + x) * 4;
    return [
      atlas.rgba[index] ?? 0,
      atlas.rgba[index + 1] ?? 0,
      atlas.rgba[index + 2] ?? 0,
      atlas.rgba[index + 3] ?? 0,
    ];
  };

  const colorKey = (px: [number, number, number, number]): string => px.slice(0, 3).join(',');

  /** Every distinct RGB used by a frame. */
  const frameColors = (key: string): Set<string> => {
    const colors = new Set<string>();
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        colors.add(colorKey(pixel(key, x, y)));
      }
    }
    return colors;
  };

  test('the deck interior shows no water and no rail colour', () => {
    const waterColors = frameColors('water.png');
    const railColor = colorKey(pixel('bridge_rail_w.png', 4, 16));
    const sillColor = colorKey(pixel('bridge_end_n.png', 16, 2));
    for (const key of ['bridge.png', 'bridge_deck_ew.png']) {
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const px = pixel(key, x, y);
          expect(px[3], `${key} (${x},${y}) opaque`).toBe(255);
          const color = colorKey(px);
          expect(waterColors.has(color), `${key} (${x},${y}) is water`).toBe(false);
          expect(color, `${key} (${x},${y}) is rail`).not.toBe(railColor);
          expect(color, `${key} (${x},${y}) is sill`).not.toBe(sillColor);
        }
      }
    }
  });

  test('a side frame differs from the deck interior only on its outer edge', () => {
    const deck = 'bridge.png';
    const cases = [
      { key: 'bridge_rail_w.png', predicate: (x: number) => x < 8, label: 'west' },
      { key: 'bridge_rail_e.png', predicate: (x: number) => x >= 24, label: 'east' },
      { key: 'bridge_end_n.png', predicate: (_x: number, y: number) => y < 8, label: 'north' },
      { key: 'bridge_end_s.png', predicate: (_x: number, y: number) => y >= 24, label: 'south' },
    ] as const;
    for (const { key, predicate, label } of cases) {
      let changed = 0;
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          if (colorKey(pixel(key, x, y)) === colorKey(pixel(deck, x, y))) {
            continue;
          }
          changed += 1;
          expect(predicate(x, y), `${key} differs at (${x},${y}) outside the ${label} edge`).toBe(
            true,
          );
        }
      }
      expect(changed, `${key} paints something`).toBeGreaterThan(0);
    }
  });

  test('east–west side frames put the rail on their own long edge', () => {
    const deck = 'bridge_deck_ew.png';
    const cases = [
      { key: 'bridge_rail_n.png', predicate: (_x: number, y: number) => y < 8 },
      { key: 'bridge_rail_s.png', predicate: (_x: number, y: number) => y >= 24 },
    ] as const;
    for (const { key, predicate } of cases) {
      let changed = 0;
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          if (colorKey(pixel(key, x, y)) === colorKey(pixel(deck, x, y))) {
            continue;
          }
          changed += 1;
          expect(predicate(x, y), `${key} differs at (${x},${y})`).toBe(true);
        }
      }
      expect(changed, `${key} paints something`).toBeGreaterThan(0);
    }
  });
});
