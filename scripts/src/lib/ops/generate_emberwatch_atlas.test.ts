// scripts/src/lib/ops/generate_emberwatch_atlas.test.ts
//
// C-378 AC-5 — atlas packer determinism + 1px extrusion (Evidence Matrix).
//
// The packer is now a PURE function (`packAtlas`) with `main()` guarded by
// `import.meta.main`, so a test can pack twice and assert byte-identical
// output without regenerating the committed atlas or requiring `cwebp`.
// This file is co-located (scripts uses co-located .test.ts, no __tests__
// dir) — the contract's Evidence Matrix path is updated to match.

import { describe, expect, test } from 'bun:test';
import { CORNER_WEDGE_TESTS, packAtlas, terrainOwnsPixel } from './generate_emberwatch_atlas.ts';
import {
  ATLAS_CELL,
  ATLAS_HEIGHT,
  ATLAS_PADDING,
  ATLAS_TILE_SIZE,
  ATLAS_WIDTH,
} from './generate_emberwatch_tables.ts';

describe('C-378 AC-5 — atlas packer', () => {
  test('packing a fixture twice produces byte-identical output', () => {
    const a = packAtlas();
    const b = packAtlas();

    // Atlas geometry pinned by the shared tables module.
    expect(a.width).toBe(ATLAS_WIDTH);
    expect(a.height).toBe(ATLAS_HEIGHT);
    expect(a.rgba.length).toBe(ATLAS_WIDTH * ATLAS_HEIGHT * 4);

    // Byte-identical RGBA and frame rects across two independent packs.
    expect(Buffer.from(a.rgba).equals(Buffer.from(b.rgba))).toBe(true);
    expect(JSON.stringify(a.frames)).toBe(JSON.stringify(b.frames));
  });

  test('the 1px border duplicates the frame edge row/column', () => {
    const { rgba, width } = packAtlas();
    const px = (x: number, y: number): number[] => {
      const i = (y * width + x) * 4;
      return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
    };

    // Sample PAINTED cells only: (0,3) is dirt_0.png (the first corner-16
    // frame, row 3 after the 48 baked frames). (15,7) is deliberately NOT
    // sampled — it is an unpainted cell beyond the last frame, so its
    // zero-pixel border would trivially pass the edge-duplication check.
    for (const [col, row] of [
      [0, 0],
      [3, 2],
      [0, 3],
    ] as const) {
      const x0 = col * ATLAS_CELL + ATLAS_PADDING;
      const y0 = row * ATLAS_CELL + ATLAS_PADDING;
      const xLast = x0 + ATLAS_TILE_SIZE - 1;
      const yLast = y0 + ATLAS_TILE_SIZE - 1;

      for (let d = 0; d < ATLAS_TILE_SIZE; d++) {
        // top border = top content row
        expect(px(x0 + d, y0 - 1), `top border col ${col},row ${row}`).toEqual(px(x0 + d, y0));
        // bottom border = bottom content row
        expect(px(x0 + d, yLast + 1), `bottom border col ${col},row ${row}`).toEqual(
          px(x0 + d, yLast),
        );
        // left border = left content column
        expect(px(x0 - 1, y0 + d), `left border col ${col},row ${row}`).toEqual(px(x0, y0 + d));
        // right border = right content column
        expect(px(xLast + 1, y0 + d), `right border col ${col},row ${row}`).toEqual(
          px(xLast, y0 + d),
        );
      }
      // C-378 AC-5: the four border CORNERS duplicate the clamped content
      // corners (the extrusion clamps border pixels to the frame edge).
      expect(px(x0 - 1, y0 - 1), `top-left border col ${col},row ${row}`).toEqual(px(x0, y0));
      expect(px(xLast + 1, y0 - 1), `top-right border col ${col},row ${row}`).toEqual(
        px(xLast, y0),
      );
      expect(px(x0 - 1, yLast + 1), `bottom-left border col ${col},row ${row}`).toEqual(
        px(x0, yLast),
      );
      expect(px(xLast + 1, yLast + 1), `bottom-right border col ${col},row ${row}`).toEqual(
        px(xLast, yLast),
      );
    }
  });

  test('all four corner wedges are mirror images selecting 136 pixels each', () => {
    const TILE = ATLAS_TILE_SIZE; // 32

    // Each diagonal wedge predicate must select exactly 136 pixels — the
    // triangle cut by the two edge-midpoint diagonals. An asymmetric wedge
    // (e.g. the old NE/SW shapes) would shift the terrain cut and break
    // the corner-16 visual contract.
    for (const { bit, test: testFn } of CORNER_WEDGE_TESTS) {
      let count = 0;
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          if (testFn(x, y)) {
            count += 1;
          }
        }
      }
      expect(count, `wedge bit ${bit.toString(2)} area`).toBe(136);
    }

    // True mirror images around the tile center: NW(x,y) is SE(31-x,31-y),
    // NE(31-x,y), and SW(x,31-y).
    const [nw, ne, se, sw] = CORNER_WEDGE_TESTS.map(({ test: testFn }) => testFn);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        expect(nw(x, y), `NW≡SE mirror at (${x},${y})`).toBe(se(31 - x, 31 - y));
        expect(nw(x, y), `NW≡NE vertical mirror at (${x},${y})`).toBe(ne(31 - x, y));
        expect(nw(x, y), `NW≡SW horizontal mirror at (${x},${y})`).toBe(sw(x, 31 - y));
      }
    }

    // Documented mask-3 top-half behavior: NW+NE (plus the always-terrain
    // center diamond) covers the ENTIRE top half (y < 16) — preserved.
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < TILE; x++) {
        expect(terrainOwnsPixel(0b0011, x, y), `mask 3 owns top-half pixel (${x},${y})`).toBe(true);
      }
    }

    // Complementary bottom-half coverage: mask 12 (SE+SW) owns the entire
    // bottom half (y >= 16) — the vertical mirror of the mask-3 top half.
    for (let y = 16; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        expect(terrainOwnsPixel(0b1100, x, y), `mask 12 owns bottom-half pixel (${x},${y})`).toBe(
          true,
        );
      }
    }
  });

  test('frame rects sit at col*CELL+PAD / row*CELL+PAD with exact 32×32 content', () => {
    const { frames } = packAtlas();

    // First baked frame: (0,0) → content at (1,1).
    expect(frames['grass.png'].frame).toEqual({ x: 1, y: 1, w: 32, h: 32 });

    // First corner-16 terrain frame: 48 baked frames fill rows 0-2
    // (16 cols × 3 rows), so dirt_0 lands at row 3, col 0 →
    // y = 3*34 + 1 = 103.
    expect(frames['dirt_0.png'].frame).toEqual({ x: 1, y: 3 * ATLAS_CELL + 1, w: 32, h: 32 });

    // All 16 corner masks derived from frameBase are present.
    for (let mask = 0; mask < 16; mask++) {
      expect(frames[`dirt_${mask}.png`], `dirt_${mask}.png`).toBeDefined();
      expect(frames[`water_${mask}.png`], `water_${mask}.png`).toBeDefined();
    }
  });
});
