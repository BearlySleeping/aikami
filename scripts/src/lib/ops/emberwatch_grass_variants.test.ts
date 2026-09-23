// scripts/src/lib/ops/emberwatch_grass_variants.test.ts
//
// C-549 — grass/terrain restraint (plan §1.6, the atlas painter only).
//
// `paintGrassDark` used a materially darker base than regular grass, so a dark
// cell read as an isolated square; the flower variant scattered seven saturated
// flecks per tile on a fixed per-tile grid, so the flecks repeated in a regular
// lattice. Both made the tile grid the loudest thing in a field.
//
// These assertions read the REAL painter output (`packAtlas()`, the same bytes
// the generator writes), not copied constants: a variant must stay within ±4%
// of the base mean luminance and its edge rows/columns must sit within a small
// delta of the base's, so a variant cell can never read as a square.

import { describe, expect, test } from 'bun:test';
import { G } from './emberwatch_authoring.ts';
import { makeMap, scatterPatches } from './emberwatch_map_shared.ts';
import { packAtlas } from './generate_emberwatch_atlas.ts';
import { ATLAS_TILE_SIZE } from './generate_emberwatch_tables.ts';

const TILE = ATLAS_TILE_SIZE;

const BASE = 'grass.png';
const VARIANTS = ['grass_dark.png', 'grass_variant.png'] as const;
const EDGE_FRAMES = [
  'grass_edge_n.png',
  'grass_edge_s.png',
  'grass_edge_w.png',
  'grass_edge_e.png',
] as const;
/** ±4% mean-luminance budget, per the contract's measurement. */
const MEAN_TOLERANCE = 0.04;
/** Edge luminance must stay within ~1.5 of 0..255 — a small delta, not a budget. */
const EDGE_TOLERANCE = 1.5;

const atlas = packAtlas();

/** Relative luminance of a frame pixel. */
const luminance = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

type Pixel = { x: number; y: number; r: number; g: number; b: number; a: number };

/** Every pixel of a frame's 32×32 content, in row-major order. */
const framePixels = (key: string): Pixel[] => {
  const frame = atlas.frames[key]?.frame;
  if (!frame) {
    throw new Error(`missing atlas frame ${key}`);
  }
  const pixels: Pixel[] = [];
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const index = ((frame.y + y) * atlas.width + frame.x + x) * 4;
      pixels.push({
        x,
        y,
        r: atlas.rgba[index] ?? 0,
        g: atlas.rgba[index + 1] ?? 0,
        b: atlas.rgba[index + 2] ?? 0,
        a: atlas.rgba[index + 3] ?? 0,
      });
    }
  }
  return pixels;
};

const pixelLuminance = (pixel: Pixel): number => luminance(pixel.r, pixel.g, pixel.b);
const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;
const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/** Mean luminance over a frame's 32×32 content. */
const frameMeanLuminance = (key: string): number => mean(framePixels(key).map(pixelLuminance));

/** The pixels on a frame's four edge rows/columns (the square-reading part). */
const edgePixels = (key: string): Pixel[] =>
  framePixels(key).filter(
    (pixel) => pixel.x === 0 || pixel.y === 0 || pixel.x === TILE - 1 || pixel.y === TILE - 1,
  );

/** Mean luminance of a frame's edges. */
const frameEdgeLuminance = (key: string): number => mean(edgePixels(key).map(pixelLuminance));

/** The largest max-channel-minus-min-channel spread present in a frame. */
const frameMaxChannelSpread = (key: string): number =>
  framePixels(key).reduce(
    (widest, pixel) =>
      Math.max(widest, Math.max(pixel.r, pixel.g, pixel.b) - Math.min(pixel.r, pixel.g, pixel.b)),
    0,
  );

/** How far a value set's extremes sit from a reference (the natural noise envelope). */
const valueSpread = (values: readonly number[], reference: number): number =>
  Math.max(Math.abs(Math.max(...values) - reference), Math.abs(reference - Math.min(...values)));

describe('C-549 — grass variants share the base value (plan §1.6)', () => {
  const baseMean = frameMeanLuminance(BASE);

  test('the base grass frame is fully opaque', () => {
    for (const pixel of framePixels(BASE)) {
      expect(pixel.a, `(${pixel.x},${pixel.y}) alpha`).toBe(255);
    }
  });

  for (const key of VARIANTS) {
    test(`${key} mean luminance is within ±${MEAN_TOLERANCE * 100}% of the base`, () => {
      const value = frameMeanLuminance(key);
      const relative = (value - baseMean) / baseMean;
      expect(
        Math.abs(relative),
        `${key} mean ${value.toFixed(2)} vs base ${baseMean.toFixed(2)} (${(relative * 100).toFixed(2)}%)`,
      ).toBeLessThanOrEqual(MEAN_TOLERANCE);
    });

    test(`${key} edge luminance is within ${EDGE_TOLERANCE} of the base edges`, () => {
      const delta = frameEdgeLuminance(key) - frameEdgeLuminance(BASE);
      expect(Math.abs(delta), `${key} edge delta ${delta.toFixed(3)}`).toBeLessThanOrEqual(
        EDGE_TOLERANCE,
      );
    });
  }

  for (const key of EDGE_FRAMES) {
    test(`${key} edge luminance is within ${EDGE_TOLERANCE} of the base edges`, () => {
      const delta = frameEdgeLuminance(key) - frameEdgeLuminance(BASE);
      expect(Math.abs(delta), `${key} edge delta ${delta.toFixed(3)}`).toBeLessThanOrEqual(
        EDGE_TOLERANCE,
      );
    });
  }

  test('the dark variant no longer paints from the old darker base colour', () => {
    // The pre-C-549 dark base was RGB(58,116,50) — a materially darker cell
    // than RGB(74,143,60). Assert the old bug cannot come back.
    const centre = framePixels('grass_dark.png').find((pixel) => pixel.x === 16 && pixel.y === 16);
    expect([centre?.r, centre?.g, centre?.b]).not.toEqual([58, 116, 50]);
  });
});

describe('C-549 — the flower/fleck variant is sparse, low contrast and irregular', () => {
  const baseMedian = median(framePixels(BASE).map(pixelLuminance));

  test('the variant has no high-contrast decal pixels (low contrast)', () => {
    // The pre-C-549 flower painter wrote near-white (240) and saturated magenta
    // (201,91,210) flecks: ~110 luminance units above the grass median, which
    // is exactly what read as "regular bright flecks". A restrained decal is a
    // nudge, so the variant's value range stays inside the base grass family's.
    const baseSpread = valueSpread(framePixels(BASE).map(pixelLuminance), baseMedian);
    const variantSpread = valueSpread(
      framePixels('grass_variant.png').map(pixelLuminance),
      baseMedian,
    );
    expect(
      variantSpread,
      `variant spread ${variantSpread.toFixed(1)} vs base spread ${baseSpread.toFixed(1)}`,
    ).toBeLessThanOrEqual(baseSpread + 4);
  });

  test('the variant is sparse: only a handful of pixels sit off the grass value', () => {
    for (const key of [...VARIANTS]) {
      const outliers = framePixels(key).filter(
        (pixel) => Math.abs(pixelLuminance(pixel) - baseMedian) > 25,
      ).length;
      // The old variant wrote ~14 saturated flecks; the restrained one writes at
      // most a few muted decal pixels — a fraction of a percent of the tile.
      expect(outliers, `${key} high-contrast outlier pixels`).toBeLessThanOrEqual(8);
    }
  });

  test('the variant decals are not a non-grass hue (no bright white/magenta flecks)', () => {
    // Near-white and magenta both break green dominance outright, so a single
    // "green is the largest channel" check catches them without a magic spread
    // constant: the base grass family has zero such pixels, so must the variant.
    for (const key of [BASE, ...VARIANTS]) {
      const offHue = framePixels(key).filter((pixel) => pixel.g < pixel.r || pixel.g < pixel.b);
      expect(offHue.length, `${key} off-hue decal pixels`).toBe(0);
    }
  });

  test('the variant introduces no channel spread beyond the base grass family', () => {
    const baseSpread = frameMaxChannelSpread(BASE);
    const variantSpread = frameMaxChannelSpread('grass_variant.png');
    expect(
      variantSpread,
      `variant spread ${variantSpread} vs base spread ${baseSpread}`,
    ).toBeLessThanOrEqual(baseSpread + 4);
  });

  test('the variant has no fixed-grid placement: decal offsets are irregular', () => {
    // Decals are placed by a seeded RNG across the whole cell, so no row may
    // hold three or more decals at a constant stride (which a fixed 8px lattice
    // would produce). Off-hue detection is not usable here — the restrained
    // decals are green like the base — so identify them as the pixels whose
    // value sits clear of the frame median.
    const rows = new Map<number, number[]>();
    for (const pixel of framePixels('grass_variant.png')) {
      if (Math.abs(pixelLuminance(pixel) - baseMedian) <= 12) {
        continue;
      }
      rows.set(pixel.y, [...(rows.get(pixel.y) ?? []), pixel.x]);
    }
    for (const [y, xs] of rows) {
      if (xs.length < 3) {
        continue;
      }
      const stride = (xs[xs.length - 1] ?? 0) - (xs[0] ?? 0);
      const regular = xs.every(
        (x, i) => i === 0 || x - (xs[i - 1] ?? 0) === stride / (xs.length - 1),
      );
      expect(regular, `row ${y} decals ${xs.join(',')} form a fixed grid`).toBe(false);
    }
  });
});

describe('C-549 — scatterPatches forms broad deterministic patches', () => {
  test('the same seed reproduces the same layout', () => {
    const a = makeMap(40, 40);
    const b = makeMap(40, 40);
    const options = {
      c0: 2,
      r0: 2,
      c1: 37,
      r1: 37,
      baseGid: G.GRASS,
      gid: G.GRASS_DARK,
      threshold: 0.6,
      scale: 6,
    };
    scatterPatches({ map: a, seed: 1234, ...options });
    scatterPatches({ map: b, seed: 1234, ...options });
    expect(a.ground).toEqual(b.ground);
  });

  test('a different seed produces a different layout', () => {
    const a = makeMap(40, 40);
    const b = makeMap(40, 40);
    const options = {
      c0: 2,
      r0: 2,
      c1: 37,
      r1: 37,
      baseGid: G.GRASS,
      gid: G.GRASS_DARK,
      threshold: 0.6,
      scale: 6,
    };
    scatterPatches({ map: a, seed: 1, ...options });
    scatterPatches({ map: b, seed: 2, ...options });
    expect(a.ground).not.toEqual(b.ground);
  });

  test('it never repaints a cell that is not holding the base GID', () => {
    const region = makeMap(40, 40);
    // Paint a non-base cell in the middle of the region.
    region.ground[20 * 40 + 20] = G.DIRT;
    scatterPatches({
      map: region,
      seed: 7,
      c0: 2,
      r0: 2,
      c1: 37,
      r1: 37,
      baseGid: G.GRASS,
      gid: G.GRASS_DARK,
      threshold: 0.0,
    });
    expect(region.ground[20 * 40 + 20]).toBe(G.DIRT);
  });
});
