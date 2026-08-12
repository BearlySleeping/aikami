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
import {
  ATLAS_CELL,
  ATLAS_HEIGHT,
  ATLAS_PADDING,
  ATLAS_TILE_SIZE,
  ATLAS_WIDTH,
} from './generate_emberwatch_tables.ts';
import { packAtlas } from './generate_emberwatch_atlas.ts';

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

    // Sample a spread of frames (corner, mid, far) — content lives at
    // (col*CELL + PAD, row*CELL + PAD) sized TILE×TILE; the 1px border
    // must equal the adjacent edge row/column of the frame's own content.
    for (const [col, row] of [
      [0, 0],
      [3, 2],
      [15, 7],
    ] as const) {
      const x0 = col * ATLAS_CELL + ATLAS_PADDING;
      const y0 = row * ATLAS_CELL + ATLAS_PADDING;
      const xLast = x0 + ATLAS_TILE_SIZE - 1;
      const yLast = y0 + ATLAS_TILE_SIZE - 1;

      // Bounds: col 15 → x0 = 511, xLast = 542, xLast+1 = 543 < 544 ✓
      //          col 0  → x0-1 = 0 ✓
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
