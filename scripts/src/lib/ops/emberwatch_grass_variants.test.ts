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
const isClumpPixel = (pixel: Pixel): boolean =>
  (pixel.r === 88 && pixel.g === 154 && pixel.b === 70) ||
  (pixel.r === 64 && pixel.g === 126 && pixel.b === 52);
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
});

describe('C-549 — the flower/fleck variant is sparse, low contrast and irregular', () => {
  const basePixels = framePixels(BASE);
  const variantPixels = framePixels('grass_variant.png');
  const baseMedian = median(basePixels.map(pixelLuminance));
  // These are the painter's explicit clump colours. Selecting by RGB keeps
  // base noise/speckles out of the decal measurement; the whole-frame checks
  // below still catch legacy high-contrast pixels that are not clumps.
  const decalPixels = variantPixels.filter(isClumpPixel);

  test('the variant has non-empty, low-contrast decals', () => {
    expect(decalPixels.length, 'explicit flower decal pixels').toBeGreaterThan(0);
    const highContrastDecals = decalPixels.filter(
      (pixel) => Math.abs(pixelLuminance(pixel) - baseMedian) > 25,
    );
    expect(highContrastDecals.length, 'high-contrast decal pixels').toBe(0);
    const baseSpread = valueSpread(basePixels.map(pixelLuminance), baseMedian);
    const decalSpread = valueSpread(decalPixels.map(pixelLuminance), baseMedian);
    expect(decalSpread, 'decal luminance spread').toBeLessThanOrEqual(baseSpread + 4);
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
    const regularXs = [2, 10, 18, 26];
    const regularStride = (regularXs[regularXs.length - 1] ?? 0) - (regularXs[0] ?? 0);
    const regularProbe = regularXs.every(
      (x, i) => i === 0 || x - (regularXs[i - 1] ?? 0) === regularStride / (regularXs.length - 1),
    );
    expect(regularProbe, 'the fixed-grid detector rejects a known regular row').toBe(true);

    const rows = new Map<number, number[]>();
    for (const pixel of decalPixels) {
      const rowBand = Math.floor(pixel.y / 8);
      rows.set(rowBand, [...(rows.get(rowBand) ?? []), pixel.x]);
    }
    expect(decalPixels.length, 'explicit decals checked for grid placement').toBeGreaterThan(0);
    let checkedRows = 0;
    for (const [rowBand, xs] of rows) {
      if (xs.length < 3) {
        continue;
      }
      checkedRows += 1;
      const stride = (xs[xs.length - 1] ?? 0) - (xs[0] ?? 0);
      const regular = xs.every(
        (x, i) => i === 0 || x - (xs[i - 1] ?? 0) === stride / (xs.length - 1),
      );
      expect(
        regular,
        `rows ${rowBand * 8}–${rowBand * 8 + 7} decals ${xs.join(',')} form a fixed grid`,
      ).toBe(false);
    }
    expect(checkedRows, 'rows with at least three decals').toBeGreaterThan(0);
  });
});

describe('C-549 — scatterPatches forms broad deterministic patches', () => {
  test('the same seed reproduces the same non-empty layout', () => {
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
    const variantCells = a.ground.filter((gid) => gid === G.GRASS_DARK).length;
    expect(variantCells, 'variant cells painted by the same seed').toBeGreaterThan(0);
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
    const aVariantCells = a.ground.filter((gid) => gid === G.GRASS_DARK).length;
    const bVariantCells = b.ground.filter((gid) => gid === G.GRASS_DARK).length;
    expect(aVariantCells, 'first seed variant cells').toBeGreaterThan(0);
    expect(bVariantCells, 'second seed variant cells').toBeGreaterThan(0);
    expect(a.ground).not.toEqual(b.ground);
  });

  test('it paints base cells in broad patches without repainting other terrain', () => {
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

    const variantCells: Array<{ c: number; r: number }> = [];
    for (let r = 2; r <= 37; r++) {
      for (let c = 2; c <= 37; c++) {
        if (region.ground[r * 40 + c] === G.GRASS_DARK) {
          variantCells.push({ c, r });
        }
      }
    }
    expect(variantCells.length, 'base cells painted by the patch pass').toBeGreaterThan(0);
    expect(region.ground[20 * 40 + 20], 'non-base cell remains untouched').toBe(G.DIRT);

    const isolatedCells = variantCells.filter(({ c, r }) =>
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].every(([dc, dr]) => region.ground[(r + (dr ?? 0)) * 40 + c + (dc ?? 0)] !== G.GRASS_DARK),
    );
    expect(isolatedCells.length / variantCells.length, 'isolated patch-cell ratio').toBeLessThan(
      0.5,
    );
  });
});
