// scripts/src/lib/ops/generate_emberwatch_canvas.ts
//
// Shared RGBA scratch canvas + pixel helpers for the Emberwatch atlas
// generator. Extracted from `generate_emberwatch_atlas.ts` so that file keeps
// its painters readable without growing past its source-size ratchet. The
// canvas is the 512×256 content scratch painters write into at 32px pitch;
// `packAtlas` extrudes it into the 544×272 atlas separately.

import { ATLAS_COLS, ATLAS_ROWS, ATLAS_TILE_SIZE } from './generate_emberwatch_tables.ts';

export const TILE = ATLAS_TILE_SIZE; // 32 — frame content size

// Content scratch buffer dimensions (painters write here at 32px pitch) —
// derived from the shared grid constants so the scratch buffer can never be
// smaller than the atlas grid it feeds (an ATLAS_ROWS/COLS change propagates
// instead of silently reading past the buffer end).
export const W = ATLAS_COLS * TILE; // 512
export const H = ATLAS_ROWS * TILE; // 256

/** RGBA buffer (row-major). Fully opaque output for terrain. */
export const buf = new Uint8Array(W * H * 4);

export const setPx = (x: number, y: number, r: number, g: number, b: number): void => {
  if (x < 0 || x >= W || y < 0 || y >= H) {
    return;
  }
  const i = (y * W + x) * 4;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
  buf[i + 3] = 255;
};

/** Fills a tile-local rectangle (0..TILE coords) at a grid cell. */
export const fillRect = (
  col: number,
  row: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
): void => {
  const ox = col * TILE;
  const oy = row * TILE;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      setPx(ox + x, oy + y, r, g, b);
    }
  }
};

/** Fills the whole cell with a color (opaque). */
export const fillCell = (col: number, row: number, r: number, g: number, b: number): void => {
  fillRect(col, row, 0, 0, TILE, TILE, r, g, b);
};

/**
 * Clears the whole cell to fully transparent (C-504).
 *
 * Prop/decor painters call this instead of an opaque grass/floor background
 * so their unpainted regions stay transparent and never show an opaque
 * substrate when placed over grass/dirt/indoor flooring. Terrain painters
 * keep painting their full cell opaque.
 */
export const clearCell = (col: number, row: number): void => {
  const ox = col * TILE;
  const oy = row * TILE;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = ((oy + y) * W + (ox + x)) * 4;
      buf[i] = 0;
      buf[i + 1] = 0;
      buf[i + 2] = 0;
      buf[i + 3] = 0;
    }
  }
};

/** Draws horizontal/vertical 1px lines within a cell. */
export const hline = (
  col: number,
  row: number,
  x0: number,
  x1: number,
  y: number,
  r: number,
  g: number,
  b: number,
): void => {
  for (let x = x0; x <= x1; x++) {
    setPx(col * TILE + x, row * TILE + y, r, g, b);
  }
};

export const vline = (
  col: number,
  row: number,
  x: number,
  y0: number,
  y1: number,
  r: number,
  g: number,
  b: number,
): void => {
  for (let y = y0; y <= y1; y++) {
    setPx(col * TILE + x, row * TILE + y, r, g, b);
  }
};

/** Deterministic PRNG (mulberry32). */
export const makeRng = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Applies deterministic per-pixel noise within a cell (single channel shift). */
export const noiseCell = (
  col: number,
  row: number,
  seed: number,
  amount: number,
  rShift: number,
  gShift: number,
  bShift: number,
): void => {
  const rng = makeRng(seed);
  const ox = col * TILE;
  const oy = row * TILE;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = ((oy + y) * W + (ox + x)) * 4;
      if (rng() < amount) {
        const dr = Math.floor((rng() - 0.5) * rShift);
        const dg = Math.floor((rng() - 0.5) * gShift);
        const db = Math.floor((rng() - 0.5) * bShift);
        buf[i] = Math.max(0, Math.min(255, buf[i] + dr));
        buf[i + 1] = Math.max(0, Math.min(255, buf[i + 1] + dg));
        buf[i + 2] = Math.max(0, Math.min(255, buf[i + 2] + db));
      }
    }
  }
};
