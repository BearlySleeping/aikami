// scripts/src/lib/ops/generate_emberwatch_atlas.ts
//
// Generates the Emberwatch coherent tileset atlas (C-375 AC-4).
//
// Replaces the 128×128 9-frame placeholder with a 512×256 (16×8 grid)
// procedurally-drawn 32px tileset: grass/dirt/path/floor/wall/roof/water
// tiles plus furniture + prop cells (well, notice board, gate, barrels,
// crates, counters, tables, beds, rugs...).
//
// Deterministic (seeded RNG) — every cell is fully opaque pixel art.
// Emits `atlas.webp` (via cwebp) + `atlas.json` (frame rects matching the
// grid layout). The map tileset blocks (imagewidth/imageheight/columns/
// tilecount) MUST match this layout — see the maps rebuilt in C-375 AC-5.
//
// Run: bun run scripts:generate-emberwatch-atlas  (or bun moon run scripts:...)
//     or directly: bun scripts/src/lib/ops/generate_emberwatch_atlas.ts

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import {
  ATLAS_CELL,
  ATLAS_COLS,
  ATLAS_HEIGHT,
  ATLAS_PADDING,
  ATLAS_ROWS,
  ATLAS_TILE_SIZE,
  ATLAS_WIDTH,
  buildFrames,
  CORNER16_FRAMES,
  cornerFrameName,
  readManifestTerrains,
} from './generate_emberwatch_tables.ts';

// ---------------------------------------------------------------------------
// Constants — atlas geometry is derived from the shared tables module so the
// atlas generator, the frame registry, and the map tileset blocks cannot
// drift independently (CodeRabbit review, C-376).
//
// C-378 AC-5: frames are packed with 1px edge extrusion. The painters draw
// the 32×32 CONTENT at the old content pitch (W=512, H=256) into a scratch
// buffer; a post-pass extrudes each frame into the final 544×272 atlas with
// a 1px border duplicated from the frame's edge pixels. The border makes
// adjacent-atlas sampling safe — the chunk renderer's half-texel inset is
// deleted (AC-5).
// ---------------------------------------------------------------------------

const TILE = ATLAS_TILE_SIZE; // 32 — frame content size
const CELL = ATLAS_CELL; // 34 — cell pitch in the final atlas
const PAD = ATLAS_PADDING; // 1 — extrusion border width
const CW = ATLAS_WIDTH; // 544 — final atlas width
const CH = ATLAS_HEIGHT; // 272 — final atlas height

// Content scratch buffer dimensions (painters write here at 32px pitch) —
// derived from the shared grid constants so the scratch buffer can never be
// smaller than the atlas grid it feeds (an ATLAS_ROWS/COLS change propagates
// instead of silently reading past the buffer end).
const W = ATLAS_COLS * TILE; // 512
const H = ATLAS_ROWS * TILE; // 256

/**
 * Allocates 16 contiguous cells (a full atlas row) per corner16 terrain
 * and registers the derived mask frame names into the caller's frames map.
 *
 * C-378 AC-5: frames are built into a LOCAL map per packAtlas() call so a
 * test can pack twice without the "collides with an existing atlas frame"
 * throw that a module-level singleton would cause.
 */
const registerTerrainFrames = (frames: Record<string, [number, number]>): void => {
  const terrains = readManifestTerrains();
  // Derive the first free cell from the OCCUPIED [col,row] coordinates —
  // never Object.keys(frames).length: a sparse baked-frames table (a tile
  // without a frame leaves a gap) would start terrain allocation on a cell
  // that may already be occupied by a higher-GID baked frame, silently
  // overwriting it in the atlas. Start after the highest occupied index.
  let nextCell = 0;
  for (const [col, row] of Object.values(frames)) {
    nextCell = Math.max(nextCell, row * ATLAS_COLS + col + 1);
  }
  for (const terrain of terrains) {
    if (terrain.wang !== 'corner16') {
      continue;
    }
    for (let mask = 0; mask < CORNER16_FRAMES; mask++) {
      const name = cornerFrameName(terrain.frameBase, mask);
      if (frames[name]) {
        throw new Error(
          `generate_emberwatch: corner frame "${name}" collides with an existing atlas frame`,
        );
      }
      const col = nextCell % ATLAS_COLS;
      const row = Math.floor(nextCell / ATLAS_COLS);
      if (row >= ATLAS_ROWS) {
        throw new Error(
          `generate_emberwatch: atlas full — cannot place corner frame "${name}" (row ${row})`,
        );
      }
      frames[name] = [col, row];
      nextCell += 1;
    }
  }
};

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

/** RGBA buffer (row-major). Fully opaque output. */
const buf = new Uint8Array(W * H * 4);

const setPx = (x: number, y: number, r: number, g: number, b: number): void => {
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
const fillRect = (
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

/** Fills the whole cell with a color. */
const fillCell = (col: number, row: number, r: number, g: number, b: number): void => {
  fillRect(col, row, 0, 0, TILE, TILE, r, g, b);
};

/** Draws horizontal/vertical 1px lines within a cell. */
const hline = (
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

const vline = (
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
const makeRng = (seed: number): (() => number) => {
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
const noiseCell = (
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

// ---------------------------------------------------------------------------
// Tile painters
// ---------------------------------------------------------------------------

const paintGrass = (
  col: number,
  row: number,
  base: readonly [number, number, number] = [74, 143, 60],
): void => {
  fillCell(col, row, base[0], base[1], base[2]);
  noiseCell(col, row, col * 31 + row * 17 + 1, 0.55, 26, 30, 20);
  // Speckle highlights / shadows
  const rng = makeRng(col * 131 + row * 73 + 7);
  for (let i = 0; i < 24; i++) {
    const x = Math.floor(rng() * TILE);
    const y = Math.floor(rng() * TILE);
    const v = rng();
    if (v < 0.4) {
      setPx(col * TILE + x, row * TILE + y, 89, 158, 73);
    } else if (v < 0.7) {
      setPx(col * TILE + x, row * TILE + y, 53, 107, 43);
    }
  }
};

const paintGrassFlowers = (col: number, row: number): void => {
  paintGrass(col, row);
  const rng = makeRng(col * 211 + row * 97 + 13);
  const colors = [
    [232, 184, 74],
    [201, 91, 210],
    [240, 240, 240],
  ];
  for (let i = 0; i < 7; i++) {
    const x = 2 + Math.floor(rng() * (TILE - 4));
    const y = 2 + Math.floor(rng() * (TILE - 4));
    const c = colors[Math.floor(rng() * colors.length)];
    setPx(col * TILE + x, row * TILE + y, c[0], c[1], c[2]);
    if (rng() < 0.5) {
      setPx(col * TILE + x + 1, row * TILE + y, c[0], c[1], c[2]);
    }
  }
};

const paintGrassDark = (col: number, row: number): void => {
  paintGrass(col, row, [58, 116, 50] as const);
};

const paintDirt = (col: number, row: number): void => {
  fillCell(col, row, 138, 90, 51);
  noiseCell(col, row, col * 41 + row * 23 + 3, 0.6, 30, 24, 18);
  const rng = makeRng(col * 89 + row * 151 + 5);
  for (let i = 0; i < 18; i++) {
    const x = Math.floor(rng() * TILE);
    const y = Math.floor(rng() * TILE);
    const v = rng();
    if (v < 0.5) {
      setPx(col * TILE + x, row * TILE + y, 153, 104, 63);
    } else {
      setPx(col * TILE + x, row * TILE + y, 122, 76, 42);
    }
  }
};

const paintCobble = (
  col: number,
  row: number,
  base: readonly [number, number, number] = [154, 154, 154],
): void => {
  fillCell(col, row, base[0], base[1], base[2]);
  // Mortar grid
  for (let i = 1; i < TILE; i += 4) {
    hline(col, row, 0, TILE - 1, i, 126, 126, 126);
    vline(col, row, i, 0, TILE - 1, 126, 126, 126);
  }
  // Stone highlights + shadows
  const rng = makeRng(col * 47 + row * 61 + 9);
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(rng() * TILE);
    const y = Math.floor(rng() * TILE);
    const v = rng();
    if (v < 0.45) {
      setPx(col * TILE + x, row * TILE + y, 181, 181, 181);
    } else if (v < 0.8) {
      setPx(col * TILE + x, row * TILE + y, 130, 130, 130);
    }
  }
};

const paintStoneFloor = (col: number, row: number): void => {
  fillCell(col, row, 143, 143, 146);
  // Large slabs 8×8 with grout
  for (let sy = 0; sy < TILE; sy += 8) {
    for (let sx = 0; sx < TILE; sx += 8) {
      fillRect(col, row, sx, sy, 7, 7, 143, 143, 146);
      // slab shading
      hline(col, row, sx, sx + 6, sy, 168, 168, 172);
      hline(col, row, sx, sx + 6, sy + 6, 118, 118, 122);
      vline(col, row, sx, sy, sy + 6, 168, 168, 172);
      vline(col, row, sx + 6, sy, sy + 6, 118, 118, 122);
    }
  }
  noiseCell(col, row, col * 53 + row * 29 + 11, 0.25, 14, 14, 14);
};

const paintWoodFloor = (col: number, row: number): void => {
  fillCell(col, row, 155, 106, 63);
  // Horizontal planks 4px tall with seams every 8
  for (let y = 0; y < TILE; y++) {
    const plank = Math.floor(y / 4);
    const shade = plank % 2 === 0 ? 0 : -14;
    hline(col, row, 0, TILE - 1, y, 155 + shade, 106 + shade, 63 + shade);
    // vertical seam staggered per plank row
    const seam = (plank * 7) % TILE;
    if (y % 4 === 3) {
      setPx(col * TILE + seam, row * TILE + y, 110, 68, 38);
      setPx(col * TILE + ((seam + 16) % TILE), row * TILE + y, 110, 68, 38);
    }
  }
  noiseCell(col, row, col * 71 + row * 13 + 5, 0.2, 16, 12, 10);
};

const paintBrick = (col: number, row: number): void => {
  fillCell(col, row, 143, 63, 51);
  // Brick courses 6px with 2px offset
  for (let y = 0; y < TILE; y++) {
    const course = Math.floor(y / 6);
    const offset = course % 2 === 0 ? 0 : 8;
    const mortar = y % 6 === 5;
    for (let x = 0; x < TILE; x++) {
      const isMortarX = (x - offset) % 16 === 15;
      if (mortar || isMortarX) {
        setPx(col * TILE + x, row * TILE + y, 201, 183, 168);
      } else {
        const bright = (x + y) % 3 === 0;
        setPx(
          col * TILE + x,
          row * TILE + y,
          bright ? 160 : 143,
          bright ? 78 : 63,
          bright ? 63 : 51,
        );
      }
    }
  }
};

const paintBrickVariant = (col: number, row: number): void => {
  paintBrick(col, row);
  // Darken overlay for the variant
  const rng = makeRng(col * 33 + row * 89 + 2);
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(rng() * TILE);
    const y = Math.floor(rng() * TILE);
    const i2 = ((row * TILE + y) * W + (col * TILE + x)) * 4;
    buf[i2] = Math.max(0, buf[i2] - 22);
    buf[i2 + 1] = Math.max(0, buf[i2 + 1] - 18);
    buf[i2 + 2] = Math.max(0, buf[i2 + 2] - 14);
  }
};

const paintWoodWall = (col: number, row: number): void => {
  fillCell(col, row, 122, 74, 42);
  // Vertical planks 8px
  for (let x = 0; x < TILE; x++) {
    const plank = Math.floor(x / 8);
    const shade = plank % 2 === 0 ? 0 : -16;
    for (let y = 0; y < TILE; y++) {
      setPx(col * TILE + x, row * TILE + y, 122 + shade, 74 + shade, 42 + shade);
    }
    if (x % 8 === 7) {
      vline(col, row, x, 0, TILE - 1, 94, 56, 32);
    }
  }
  noiseCell(col, row, col * 13 + row * 101 + 17, 0.2, 14, 10, 8);
};

const paintStoneWall = (col: number, row: number): void => {
  fillCell(col, row, 125, 125, 128);
  // Irregular stones ~10×8
  const stones: Array<[number, number, number, number]> = [
    [0, 0, 10, 8],
    [10, 0, 12, 8],
    [22, 0, 10, 8],
    [5, 8, 11, 8],
    [16, 8, 9, 8],
    [25, 8, 7, 8],
    [0, 16, 9, 8],
    [9, 16, 12, 8],
    [21, 16, 11, 8],
    [3, 24, 10, 8],
    [13, 24, 11, 8],
    [24, 24, 8, 8],
  ];
  for (const [sx, sy, sw, sh] of stones) {
    fillRect(col, row, sx, sy, sw, sh, 125, 125, 128);
    hline(col, row, sx, sx + sw - 1, sy, 152, 152, 156);
    hline(col, row, sx, sx + sw - 1, sy + sh - 1, 100, 100, 104);
    vline(col, row, sx, sy, sy + sh - 1, 152, 152, 156);
    vline(col, row, sx + sw - 1, sy, sy + sh - 1, 100, 100, 104);
    setPx(col * TILE + sx + 1, row * TILE + sy + 2, 108, 108, 112);
    setPx(col * TILE + sx + 3, row * TILE + sy + 4, 141, 141, 145);
  }
};

const paintWallTop = (col: number, row: number): void => {
  paintStoneWall(col, row);
  // Grass rim on top 6 rows
  fillRect(col, row, 0, 0, TILE, 6, 74, 143, 60);
  noiseCell(col, row, col * 61 + row * 5 + 21, 0.4, 20, 24, 16);
  hline(col, row, 0, TILE - 1, 6, 96, 96, 100);
};

const paintRoof = (col: number, row: number): void => {
  fillCell(col, row, 154, 68, 58);
  // Shingle rows with scallops
  for (let y = 0; y < TILE; y++) {
    const rowShade = y % 4 === 3 ? -20 : 0;
    for (let x = 0; x < TILE; x++) {
      const scallop = (x + Math.floor(y / 4) * 4) % 8 < 4;
      setPx(
        col * TILE + x,
        row * TILE + y,
        scallop ? 154 + rowShade : 138 + rowShade,
        scallop ? 68 + rowShade : 58 + rowShade,
        scallop ? 58 + rowShade : 46 + rowShade,
      );
    }
  }
};

const paintWater = (col: number, row: number): void => {
  fillCell(col, row, 46, 111, 176);
  const rng = makeRng(col * 37 + row * 83 + 15);
  for (let i = 0; i < 30; i++) {
    const x = Math.floor(rng() * TILE);
    const y = Math.floor(rng() * TILE);
    const v = rng();
    if (v < 0.5) {
      setPx(col * TILE + x, row * TILE + y, 63, 132, 196);
    } else {
      setPx(col * TILE + x, row * TILE + y, 39, 97, 156);
    }
  }
  // Wave streaks
  for (let y = 4; y < TILE; y += 8) {
    for (let x = 2; x < TILE - 4; x += 3) {
      setPx(col * TILE + x, row * TILE + y, 82, 158, 214);
    }
  }
};

const paintFence = (col: number, row: number): void => {
  fillCell(col, row, 74, 143, 60); // grass behind
  noiseCell(col, row, col * 29 + row * 71 + 23, 0.3, 20, 22, 14);
  // vertical slats at x=6..9 and x=22..25
  for (const sx of [6, 22]) {
    fillRect(col, row, sx, 0, 4, 30, 110, 68, 38);
    // pointy top
    setPx(col * TILE + sx + 2, row * TILE + 0, 140, 92, 52);
  }
  // horizontal rails
  hline(col, row, 0, TILE - 1, 10, 150, 100, 58);
  hline(col, row, 0, TILE - 1, 11, 110, 68, 38);
  hline(col, row, 0, TILE - 1, 20, 150, 100, 58);
  hline(col, row, 0, TILE - 1, 21, 110, 68, 38);
};

const paintFencePost = (col: number, row: number): void => {
  paintFence(col, row);
  // thicker center post
  fillRect(col, row, 13, 0, 5, 30, 122, 74, 42);
  setPx(col * TILE + 15, row * TILE + 0, 150, 96, 56);
};

// ---- Props ----------------------------------------------------------------

const paintWell = (col: number, row: number): void => {
  fillCell(col, row, 74, 143, 60); // grass base
  noiseCell(col, row, col * 19 + row * 41 + 31, 0.3, 18, 20, 12);
  // stone ring
  fillRect(col, row, 4, 12, 24, 16, 130, 130, 134);
  hline(col, row, 4, 27, 12, 160, 160, 164);
  hline(col, row, 4, 27, 27, 104, 104, 108);
  // opening
  fillRect(col, row, 9, 16, 14, 12, 34, 34, 38);
  // roof posts
  vline(col, row, 7, 2, 12, 122, 74, 42);
  vline(col, row, 24, 2, 12, 122, 74, 42);
  // roof
  fillRect(col, row, 4, 0, 24, 4, 154, 68, 58);
  fillRect(col, row, 5, 1, 22, 2, 172, 84, 70);
  hline(col, row, 4, 27, 4, 120, 52, 44);
  // bucket hint
  setPx(col * TILE + 15, row * TILE + 14, 100, 100, 104);
};

const paintNoticeBoard = (col: number, row: number): void => {
  fillCell(col, row, 74, 143, 60);
  noiseCell(col, row, col * 23 + row * 67 + 19, 0.3, 18, 20, 12);
  // posts
  fillRect(col, row, 3, 10, 4, 20, 110, 68, 38);
  fillRect(col, row, 25, 10, 4, 20, 110, 68, 38);
  // board
  fillRect(col, row, 2, 4, 28, 12, 181, 132, 90);
  hline(col, row, 2, 29, 4, 150, 100, 60);
  hline(col, row, 2, 29, 15, 150, 100, 60);
  // papers
  fillRect(col, row, 5, 6, 8, 8, 240, 230, 208);
  fillRect(col, row, 18, 6, 8, 8, 236, 224, 196);
  // board roof
  fillRect(col, row, 0, 2, 32, 2, 122, 74, 42);
};

const paintVillageGate = (col: number, row: number): void => {
  fillCell(col, row, 74, 143, 60);
  noiseCell(col, row, col * 43 + row * 53 + 41, 0.3, 18, 20, 12);
  // stone base posts
  fillRect(col, row, 1, 8, 6, 22, 130, 130, 134);
  fillRect(col, row, 25, 8, 6, 22, 130, 130, 134);
  // wood gate planks
  for (let x = 7; x < 25; x += 3) {
    fillRect(col, row, x, 4, 3, 26, 155, 106, 63);
    vline(col, row, x + 2, 4, 29, 110, 68, 38);
  }
  // cross beams
  hline(col, row, 7, 24, 9, 110, 68, 38);
  hline(col, row, 7, 24, 20, 110, 68, 38);
  // top beam
  fillRect(col, row, 0, 0, 32, 4, 122, 74, 42);
  hline(col, row, 0, 31, 4, 96, 56, 32);
};

const paintChest = (
  col: number,
  row: number,
  band: readonly [number, number, number] = [192, 192, 196],
): void => {
  fillCell(col, row, 74, 143, 60);
  noiseCell(col, row, col * 11 + row * 79 + 27, 0.3, 18, 20, 12);
  // body
  fillRect(col, row, 4, 14, 24, 14, 181, 132, 90);
  fillRect(col, row, 5, 15, 22, 12, 160, 112, 76);
  // lid
  fillRect(col, row, 4, 8, 24, 8, 201, 152, 106);
  hline(col, row, 4, 27, 14, 150, 100, 60);
  // metal bands
  vline(col, row, 9, 8, 27, band[0], band[1], band[2]);
  vline(col, row, 22, 8, 27, band[0], band[1], band[2]);
  // lock
  fillRect(col, row, 14, 10, 4, 6, 210, 210, 214);
  setPx(col * TILE + 15, row * TILE + 12, 90, 90, 94);
};

const paintBarrel = (col: number, row: number): void => {
  fillCell(col, row, 74, 143, 60);
  noiseCell(col, row, col * 7 + row * 91 + 37, 0.3, 18, 20, 12);
  // barrel body (tapered)
  fillRect(col, row, 6, 6, 20, 24, 160, 106, 63);
  // shading
  vline(col, row, 6, 6, 29, 130, 82, 48);
  vline(col, row, 25, 6, 29, 130, 82, 48);
  setPx(col * TILE + 10, row * TILE + 10, 180, 130, 84);
  // bands
  hline(col, row, 6, 25, 10, 74, 74, 78);
  hline(col, row, 6, 25, 11, 96, 96, 100);
  hline(col, row, 6, 25, 20, 74, 74, 78);
  hline(col, row, 6, 25, 21, 96, 96, 100);
  // top ellipse
  fillRect(col, row, 10, 3, 12, 4, 170, 118, 74);
  setPx(col * TILE + 15, row * TILE + 3, 130, 82, 48);
};

const paintCrate = (col: number, row: number): void => {
  fillCell(col, row, 74, 143, 60);
  noiseCell(col, row, col * 17 + row * 13 + 45, 0.3, 18, 20, 12);
  // body
  fillRect(col, row, 5, 8, 22, 22, 160, 106, 63);
  hline(col, row, 5, 26, 8, 185, 132, 84);
  hline(col, row, 5, 26, 29, 122, 78, 46);
  // diagonal cross planks
  for (let i = 0; i < 8; i++) {
    setPx(col * TILE + 8 + i, row * TILE + 12 + i, 122, 78, 46);
    setPx(col * TILE + 8 + i, row * TILE + 24 - i, 122, 78, 46);
  }
  // border planks
  vline(col, row, 5, 8, 29, 122, 78, 46);
  vline(col, row, 26, 8, 29, 122, 78, 46);
};

const paintCounter = (col: number, row: number): void => {
  fillCell(col, row, 110, 68, 38); // dark floor behind
  // top
  fillRect(col, row, 2, 8, 28, 6, 185, 132, 84);
  hline(col, row, 2, 29, 8, 205, 152, 100);
  // front panel
  fillRect(col, row, 2, 14, 28, 16, 122, 74, 42);
  noiseCell(col, row, col * 5 + row * 37 + 29, 0.25, 12, 10, 8);
  // trim
  hline(col, row, 2, 29, 14, 96, 56, 32);
  hline(col, row, 2, 29, 29, 90, 52, 30);
};

const paintTable = (col: number, row: number): void => {
  fillCell(col, row, 110, 68, 38); // floor
  // legs
  fillRect(col, row, 3, 16, 5, 12, 96, 56, 32);
  fillRect(col, row, 24, 16, 5, 12, 96, 56, 32);
  // top
  fillRect(col, row, 1, 10, 30, 7, 181, 132, 90);
  hline(col, row, 1, 30, 10, 201, 152, 106);
  hline(col, row, 1, 30, 16, 140, 92, 58);
};

const paintBed = (col: number, row: number): void => {
  fillCell(col, row, 110, 68, 38); // floor
  // frame
  fillRect(col, row, 1, 6, 30, 22, 96, 56, 32);
  // mattress
  fillRect(col, row, 3, 8, 26, 12, 232, 224, 208);
  // blanket
  fillRect(col, row, 3, 14, 26, 12, 201, 69, 90);
  hline(col, row, 3, 28, 14, 220, 96, 116);
  // pillow
  fillRect(col, row, 4, 8, 10, 6, 244, 240, 232);
  // headboard
  fillRect(col, row, 1, 2, 6, 26, 90, 52, 30);
};

const paintRug = (col: number, row: number): void => {
  fillCell(col, row, 110, 68, 38); // floor
  // rug body
  fillRect(col, row, 4, 6, 24, 20, 160, 48, 64);
  // border
  fillRect(col, row, 4, 6, 24, 2, 232, 184, 74);
  fillRect(col, row, 4, 24, 24, 2, 232, 184, 74);
  fillRect(col, row, 4, 6, 2, 20, 232, 184, 74);
  fillRect(col, row, 26, 6, 2, 20, 232, 184, 74);
  // inner diamond
  setPx(col * TILE + 16, row * TILE + 9, 232, 184, 74);
  setPx(col * TILE + 14, row * TILE + 11, 232, 184, 74);
  setPx(col * TILE + 16, row * TILE + 11, 232, 184, 74);
  setPx(col * TILE + 18, row * TILE + 11, 232, 184, 74);
  setPx(col * TILE + 14, row * TILE + 16, 232, 184, 74);
  setPx(col * TILE + 16, row * TILE + 16, 232, 184, 74);
  setPx(col * TILE + 18, row * TILE + 16, 232, 184, 74);
  setPx(col * TILE + 16, row * TILE + 19, 232, 184, 74);
};

const paintBookshelf = (col: number, row: number): void => {
  fillCell(col, row, 110, 68, 38); // floor
  // frame
  fillRect(col, row, 4, 2, 24, 28, 110, 68, 38);
  hline(col, row, 4, 27, 2, 140, 92, 56);
  hline(col, row, 4, 27, 29, 84, 50, 28);
  // shelves
  hline(col, row, 5, 26, 10, 84, 50, 28);
  hline(col, row, 5, 26, 19, 84, 50, 28);
  // books (top shelf)
  const bookColors: Array<[number, number, number]> = [
    [58, 90, 160],
    [90, 160, 58],
    [160, 58, 90],
    [200, 180, 90],
  ];
  let bx = 6;
  for (let i = 0; i < 5 && bx < 26; i++) {
    const c = bookColors[(i + col) % bookColors.length];
    fillRect(col, row, bx, 3, 3, 6, c[0], c[1], c[2]);
    bx += 4;
  }
  bx = 6;
  for (let i = 0; i < 5 && bx < 26; i++) {
    const c = bookColors[(i + row + 2) % bookColors.length];
    fillRect(col, row, bx, 12, 3, 6, c[0], c[1], c[2]);
    bx += 4;
  }
};

const paintFireplace = (col: number, row: number): void => {
  fillCell(col, row, 110, 68, 38); // floor
  // stone hearth
  fillRect(col, row, 3, 8, 26, 22, 125, 125, 128);
  hline(col, row, 3, 28, 8, 152, 152, 156);
  hline(col, row, 3, 28, 29, 96, 96, 100);
  // fire opening
  fillRect(col, row, 8, 14, 16, 16, 40, 40, 44);
  // fire
  setPx(col * TILE + 15, row * TILE + 27, 255, 130, 42);
  setPx(col * TILE + 14, row * TILE + 25, 255, 190, 58);
  setPx(col * TILE + 16, row * TILE + 25, 255, 190, 58);
  setPx(col * TILE + 15, row * TILE + 23, 255, 230, 120);
  // mantle
  fillRect(col, row, 1, 2, 30, 4, 140, 92, 56);
  hline(col, row, 1, 30, 2, 170, 118, 74);
};

const paintCandle = (col: number, row: number): void => {
  fillCell(col, row, 110, 68, 38); // floor
  // stand
  fillRect(col, row, 13, 20, 6, 10, 96, 56, 32);
  fillRect(col, row, 11, 26, 10, 4, 122, 74, 42);
  // candle
  fillRect(col, row, 14, 12, 4, 9, 232, 226, 210);
  // flame
  setPx(col * TILE + 15, row * TILE + 9, 255, 210, 80);
  setPx(col * TILE + 16, row * TILE + 10, 255, 160, 60);
  setPx(col * TILE + 15, row * TILE + 7, 255, 240, 160);
};

const paintPlant = (col: number, row: number): void => {
  fillCell(col, row, 110, 68, 38); // floor
  // pot
  fillRect(col, row, 9, 20, 14, 10, 170, 84, 58);
  hline(col, row, 8, 21, 20, 190, 104, 72);
  hline(col, row, 9, 20, 29, 130, 60, 40);
  // leaves
  fillRect(col, row, 12, 6, 8, 14, 63, 143, 63);
  setPx(col * TILE + 10, row * TILE + 8, 63, 143, 63);
  setPx(col * TILE + 22, row * TILE + 10, 63, 143, 63);
  setPx(col * TILE + 11, row * TILE + 13, 84, 168, 84);
  setPx(col * TILE + 20, row * TILE + 14, 84, 168, 84);
};

const paintAnvil = (col: number, row: number): void => {
  fillCell(col, row, 110, 68, 38); // floor
  // base
  fillRect(col, row, 8, 22, 16, 8, 58, 58, 62);
  // body
  fillRect(col, row, 10, 14, 12, 8, 74, 74, 78);
  // horn
  fillRect(col, row, 4, 16, 7, 4, 74, 74, 78);
  setPx(col * TILE + 4, row * TILE + 17, 96, 96, 100);
  // face
  fillRect(col, row, 10, 10, 12, 4, 96, 96, 100);
  hline(col, row, 10, 21, 10, 130, 130, 134);
};

// ---- Row 2 extras ---------------------------------------------------------

const paintWaterEdge = (col: number, row: number): void => {
  paintWater(col, row);
  // sandy top edge
  fillRect(col, row, 0, 0, TILE, 4, 216, 194, 140);
  hline(col, row, 0, TILE - 1, 4, 180, 160, 110);
};

const paintBridge = (col: number, row: number): void => {
  paintWater(col, row);
  // wooden planks
  fillRect(col, row, 0, 8, TILE, 16, 155, 106, 63);
  for (let x = 2; x < TILE; x += 6) {
    vline(col, row, x, 8, 23, 122, 78, 46);
  }
  hline(col, row, 0, TILE - 1, 8, 185, 132, 84);
  hline(col, row, 0, TILE - 1, 23, 110, 68, 38);
  // side rails
  hline(col, row, 0, TILE - 1, 6, 140, 92, 56);
  hline(col, row, 0, TILE - 1, 26, 140, 92, 56);
};

const paintSteps = (col: number, row: number): void => {
  fillCell(col, row, 143, 143, 146);
  // descending steps
  for (let i = 0; i < 4; i++) {
    fillRect(col, row, 0, i * 8, TILE - i * 6, 8, 143, 143, 146);
    hline(col, row, 0, TILE - 1 - i * 6, i * 8, 168, 168, 172);
    hline(col, row, 0, TILE - 1 - i * 6, i * 8 + 7, 110, 110, 114);
  }
};

const paintColumn = (col: number, row: number): void => {
  fillCell(col, row, 110, 68, 38);
  // stone column
  fillRect(col, row, 10, 0, 12, 32, 143, 143, 146);
  vline(col, row, 10, 0, 31, 168, 168, 172);
  vline(col, row, 21, 0, 31, 110, 110, 114);
  // capital + base
  fillRect(col, row, 7, 0, 18, 3, 160, 160, 164);
  fillRect(col, row, 7, 29, 18, 3, 160, 160, 164);
};

const paintWindow = (col: number, row: number): void => {
  paintStoneWall(col, row);
  // window frame
  fillRect(col, row, 8, 6, 16, 20, 96, 56, 32);
  // glass
  fillRect(col, row, 10, 8, 12, 16, 122, 196, 226);
  setPx(col * TILE + 12, row * TILE + 10, 180, 228, 244);
  // cross
  vline(col, row, 15, 8, 23, 96, 56, 32);
  hline(col, row, 10, 21, 15, 96, 56, 32);
};

const paintWoodDoor = (col: number, row: number): void => {
  paintStoneWall(col, row);
  // door frame
  fillRect(col, row, 6, 2, 20, 28, 96, 56, 32);
  // door planks
  for (let x = 8; x < 24; x += 3) {
    fillRect(col, row, x, 4, 3, 26, 155, 106, 63);
    vline(col, row, x + 2, 4, 29, 110, 68, 38);
  }
  // handle
  setPx(col * TILE + 21, row * TILE + 17, 210, 210, 214);
  // arch
  setPx(col * TILE + 10, row * TILE + 2, 140, 92, 56);
  setPx(col * TILE + 21, row * TILE + 2, 140, 92, 56);
};

const paintFlagstone = (col: number, row: number): void => {
  paintStoneFloor(col, row);
  // bigger irregular slabs
  fillRect(col, row, 1, 1, 13, 13, 155, 155, 158);
  fillRect(col, row, 17, 2, 13, 12, 155, 155, 158);
  fillRect(col, row, 3, 17, 12, 12, 155, 155, 158);
  fillRect(col, row, 18, 17, 12, 12, 155, 155, 158);
  noiseCell(col, row, col * 3 + row * 17 + 33, 0.2, 12, 12, 12);
};

const paintRugRound = (col: number, row: number): void => {
  fillCell(col, row, 110, 68, 38);
  // round rug
  for (let y = 8; y < 26; y++) {
    for (let x = 8; x < 24; x++) {
      const dx = x - 15.5;
      const dy = y - 16.5;
      if (dx * dx + dy * dy < 64) {
        setPx(col * TILE + x, row * TILE + y, 63, 143, 63);
      }
    }
  }
  for (let y = 8; y < 26; y++) {
    for (let x = 8; x < 24; x++) {
      const dx = x - 15.5;
      const dy = y - 16.5;
      const d = dx * dx + dy * dy;
      if (d < 64 && d > 49) {
        setPx(col * TILE + x, row * TILE + y, 232, 184, 74);
      }
    }
  }
};

const paintSand = (col: number, row: number): void => {
  fillCell(col, row, 216, 194, 140);
  noiseCell(col, row, col * 27 + row * 19 + 25, 0.5, 22, 20, 14);
};

// ---------------------------------------------------------------------------
// Paint all frames
// ---------------------------------------------------------------------------

// ---- Corner-16 terrain frames (C-378) ------------------------------------
//
// Each corner frame composites the terrain (dirt/water) onto the base
// (grass) using the corner-16 geometry:
//   - the four corner wedges are the triangles cut by the tile diagonals
//     through the edge midpoints — a corner whose mask bit is set owns its
//     wedge;
//   - the center diamond (pixels in no wedge) is ALWAYS terrain — the
//     cell's own terrain owns its core regardless of the corners.
// Mask bit order is the documented contract: bit0=NW, bit1=NE, bit2=SE,
// bit3=SW (clockwise from north-west). This produces the diagonal blended
// edges the autotiler relies on (mask 3 = top half, mask 12 = bottom half,
// mask 5 = diagonal pair, …).

/** Corner bit → wedge test (tile-local x,y in 0..TILE-1, center at 16). */
// The four wedges are true mirror images around the tile center
// ((x,y) → (31-x,31-y)) and each selects exactly 136 pixels for TILE = 32
// (the triangle cut by the two edge-midpoint diagonals). Bit order is the
// documented contract: bit0=NW, bit1=NE, bit2=SE, bit3=SW.
export const CORNER_WEDGE_TESTS: Array<{
  bit: number;
  test: (x: number, y: number) => boolean;
}> = [
  { bit: 0b0001, test: (x, y) => x + y < 16 }, // NW: top-left triangle
  { bit: 0b0010, test: (x, y) => x - y > 15 }, // NE: top-right triangle (mirror of NW across the vertical axis)
  { bit: 0b0100, test: (x, y) => x + y > 46 }, // SE: bottom-right triangle (mirror of NW through the center)
  { bit: 0b1000, test: (x, y) => y - x > 15 }, // SW: bottom-left triangle (mirror of NW across the horizontal axis)
];

/** True when the pixel is in the center diamond (always terrain). */
const inCenterDiamond = (x: number, y: number): boolean =>
  !CORNER_WEDGE_TESTS.some(({ test }) => test(x, y));

/** True when the pixel is owned by a set-corner wedge (or the diamond). */
export const terrainOwnsPixel = (mask: number, x: number, y: number): boolean => {
  if (inCenterDiamond(x, y)) {
    return true;
  }
  return CORNER_WEDGE_TESTS.some(({ bit, test }) => (mask & bit) !== 0 && test(x, y));
};

/**
 * Paints a corner-16 frame: base fill everywhere, terrain stamped into the
 * owned wedges + center diamond.
 *
 * The terrain/base painters write the full cell; we snapshot both into
 * scratch buffers then composite pixel-by-pixel (deterministic — the
 * painters' rng is driven by cell coordinates only).
 */
const paintCornerFrame = (
  col: number,
  row: number,
  mask: number,
  paintBase: (col: number, row: number) => void,
  paintTerrain: (col: number, row: number) => void,
): void => {
  const cx = col * TILE;
  const cy = row * TILE;

  // Snapshot the base fill (grass) into a scratch array.
  const basePixels = new Uint8Array(TILE * TILE * 3);
  paintBase(col, row);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = ((cy + y) * W + (cx + x)) * 4;
      const o = (y * TILE + x) * 3;
      basePixels[o] = buf[i];
      basePixels[o + 1] = buf[i + 1];
      basePixels[o + 2] = buf[i + 2];
    }
  }

  // Snapshot the terrain fill (dirt/water) into a scratch array.
  const terrainPixels = new Uint8Array(TILE * TILE * 3);
  paintTerrain(col, row);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = ((cy + y) * W + (cx + x)) * 4;
      const o = (y * TILE + x) * 3;
      terrainPixels[o] = buf[i];
      terrainPixels[o + 1] = buf[i + 1];
      terrainPixels[o + 2] = buf[i + 2];
    }
  }

  // Composite: owned wedges + diamond → terrain; everything else → base.
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = ((cy + y) * W + (cx + x)) * 4;
      const o = (y * TILE + x) * 3;
      if (terrainOwnsPixel(mask, x, y)) {
        buf[i] = terrainPixels[o];
        buf[i + 1] = terrainPixels[o + 1];
        buf[i + 2] = terrainPixels[o + 2];
      } else {
        buf[i] = basePixels[o];
        buf[i + 1] = basePixels[o + 1];
        buf[i + 2] = basePixels[o + 2];
      }
    }
  }
};

const paintDirtCorner = (col: number, row: number, mask: number): void => {
  paintCornerFrame(col, row, mask, paintGrass, paintDirt);
};

const paintWaterCorner = (col: number, row: number, mask: number): void => {
  paintCornerFrame(col, row, mask, paintGrass, paintWater);
};

const paintFrame = (key: string, col: number, row: number): void => {
  // C-378 corner-16 terrain frames: `dirt_<mask>.png` / `water_<mask>.png`.
  const cornerMatch = /^(dirt|water)_(\d{1,2})\.png$/.exec(key);
  if (cornerMatch) {
    const terrain = cornerMatch[1];
    const mask = Number(cornerMatch[2]);
    if (mask >= 0 && mask < 16) {
      if (terrain === 'dirt') {
        paintDirtCorner(col, row, mask);
      } else {
        paintWaterCorner(col, row, mask);
      }
      return;
    }
  }
  switch (key) {
    case 'grass.png':
      paintGrass(col, row);
      break;
    case 'grass_variant.png':
      paintGrassFlowers(col, row);
      break;
    case 'grass_dark.png':
      paintGrassDark(col, row);
      break;
    case 'dirt.png':
      paintDirt(col, row);
      break;
    case 'path_tough.png':
      paintCobble(col, row);
      break;
    case 'path_tough_variant.png':
      paintCobble(col, row, [166, 166, 166] as const);
      break;
    case 'stone_floor.png':
      paintStoneFloor(col, row);
      break;
    case 'stone_floor_variant.png':
      paintFlagstone(col, row);
      break;
    case 'wood_floor.png':
      paintWoodFloor(col, row);
      break;
    case 'wood_floor_variant.png':
      paintWoodFloor(col, row);
      noiseCell(col, row, col * 9 + row * 33 + 39, 0.25, 20, 16, 12);
      break;
    case 'brick.png':
      paintBrick(col, row);
      break;
    case 'brick_wall.png':
      paintBrickVariant(col, row);
      break;
    case 'wood_wall.png':
      paintWoodWall(col, row);
      break;
    case 'stone_wall.png':
      paintStoneWall(col, row);
      break;
    case 'wall_top.png':
      paintWallTop(col, row);
      break;
    case 'roof.png':
      paintRoof(col, row);
      break;
    case 'water.png':
      paintWater(col, row);
      break;
    case 'water_edge.png':
      paintWaterEdge(col, row);
      break;
    case 'fence.png':
      paintFence(col, row);
      break;
    case 'wood_fence.png':
      paintFencePost(col, row);
      break;
    case 'well.png':
      paintWell(col, row);
      break;
    case 'notice_board.png':
      paintNoticeBoard(col, row);
      break;
    case 'village_gate.png':
      paintVillageGate(col, row);
      break;
    case 'chest.png':
      paintChest(col, row);
      break;
    case 'red_chest.png':
      paintChest(col, row, [216, 74, 74] as const);
      break;
    case 'barrel.png':
      paintBarrel(col, row);
      break;
    case 'crate.png':
      paintCrate(col, row);
      break;
    case 'counter.png':
      paintCounter(col, row);
      break;
    case 'table.png':
      paintTable(col, row);
      break;
    case 'bed.png':
      paintBed(col, row);
      break;
    case 'rug.png':
      paintRug(col, row);
      break;
    case 'rug_round.png':
      paintRugRound(col, row);
      break;
    case 'bookshelf.png':
      paintBookshelf(col, row);
      break;
    case 'fireplace.png':
      paintFireplace(col, row);
      break;
    case 'candle.png':
      paintCandle(col, row);
      break;
    case 'plant.png':
      paintPlant(col, row);
      break;
    case 'anvil.png':
      paintAnvil(col, row);
      break;
    case 'sand.png':
      paintSand(col, row);
      break;
    case 'bridge.png':
      paintBridge(col, row);
      break;
    case 'steps.png':
      paintSteps(col, row);
      break;
    case 'column.png':
      paintColumn(col, row);
      break;
    case 'window.png':
      paintWindow(col, row);
      break;
    case 'wood_door.png':
      paintWoodDoor(col, row);
      break;
    case 'flagstone.png':
      paintFlagstone(col, row);
      break;
    case 'grass_edge_n.png':
    case 'grass_edge_s.png':
    case 'grass_edge_w.png':
    case 'grass_edge_e.png':
      paintGrass(col, row);
      break;
    default:
      // Unused/unknown frames — dark neutral tile so accidental references
      // render as muted grass rather than void or white.
      fillCell(col, row, 47, 95, 42);
      noiseCell(col, row, col * 101 + row * 103 + 1, 0.3, 14, 16, 10);
      break;
  }
};

const drawAll = (frames: Record<string, [number, number]>): void => {
  // Base fill: dark neutral for unused cells
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      setPx(x, y, 47, 95, 42);
    }
  }
  for (const [key, [col, row]] of Object.entries(frames)) {
    paintFrame(key, col, row);
  }
};

// ---------------------------------------------------------------------------
// PNG encoder (minimal, deterministic) + WebP conversion
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (data: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};

const encodePng = (width: number, height: number, rgba: Uint8Array): Uint8Array => {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  // Scanlines with filter byte 0
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  const png = new Uint8Array(
    signature.length +
      chunk('IHDR', ihdr).length +
      chunk('IDAT', idat).length +
      chunk('IEND', new Uint8Array(0)).length,
  );
  let offset = 0;
  png.set(signature, offset);
  offset += signature.length;
  const ihdrChunk = chunk('IHDR', ihdr);
  png.set(ihdrChunk, offset);
  offset += ihdrChunk.length;
  const idatChunk = chunk('IDAT', idat);
  png.set(idatChunk, offset);
  offset += idatChunk.length;
  const iendChunk = chunk('IEND', new Uint8Array(0));
  png.set(iendChunk, offset);
  return png;
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const outDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../apps/frontend/client/static/game-data/sprites/tilesets',
);

// ---------------------------------------------------------------------------
// Pure pack (C-378 AC-5 Evidence Matrix) — no file I/O, no cwebp
// ---------------------------------------------------------------------------

/**
 * Frame rects in atlas.json shape (extruded layout).
 */
export type PackedAtlasFrame = {
  frame: { x: number; y: number; w: number; h: number };
  rotated: boolean;
  trimmed: boolean;
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
};

/**
 * The pure result of packing the emberwatch atlas.
 */
export type PackedAtlas = {
  /** Extruded RGBA pixels, CW×CH×4 (544×272). */
  rgba: Uint8Array;
  width: number;
  height: number;
  /** atlas.json-shaped frame rects keyed by frame name. */
  frames: Record<string, PackedAtlasFrame>;
};

/**
 * Packs the emberwatch atlas: builds the frame registry (baked tiles +
 * corner-16 terrain frames), paints every frame into the 512×256 content
 * scratch, extrudes each frame 1px into the final 544×272 atlas, and
 * returns the RGBA pixels + frame rects.
 *
 * Pure and deterministic — no file I/O, no `cwebp`. A test can call it
 * twice and assert byte-identical output (C-378 AC-5 Evidence Matrix).
 * Each call builds its own local frame registry, so repeated calls never
 * collide with a previous call's frame registrations.
 */
export const packAtlas = (): PackedAtlas => {
  // Local frame registry per call — derived from manifest.tiles (C-376
  // AC-6 D5) + the `terrains` block (C-378). GID = row*COLS + col + 1.
  const frames = buildFrames();
  registerTerrainFrames(frames);

  drawAll(frames);

  // ── C-378 AC-5: 1px edge extrusion ──
  // The content scratch is 512×256 at 32px pitch. The final atlas is
  // CW×CH (544×272) at 34px pitch: every frame gets a 1px border that
  // duplicates its own edge pixels, so adjacent-atlas sampling never bleeds
  // and the chunk renderer can use exact UV rects (no half-texel inset).
  // Deterministic for identical inputs (pure copy pass).
  const extruded = new Uint8Array(CW * CH * 4);
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      const cellX = Math.floor(x / CELL);
      const cellY = Math.floor(y / CELL);
      const localX = x - cellX * CELL; // 0..33
      const localY = y - cellY * CELL;
      // Map the final pixel back to the content cell (clamp to the frame's
      // edge for the 1px border).
      const srcLocalX = Math.min(TILE - 1, Math.max(0, localX - PAD));
      const srcLocalY = Math.min(TILE - 1, Math.max(0, localY - PAD));
      const srcX = cellX * TILE + srcLocalX;
      const srcY = cellY * TILE + srcLocalY;
      const si = (srcY * W + srcX) * 4;
      const di = (y * CW + x) * 4;
      extruded[di] = buf[si];
      extruded[di + 1] = buf[si + 1];
      extruded[di + 2] = buf[si + 2];
      extruded[di + 3] = 255;
    }
  }

  // Frame rects matching the extruded layout: content lives at
  // (col*CELL + PAD, row*CELL + PAD) sized TILE×TILE. The 1px border
  // belongs to the frame's own edge (extrusion), so UVs are exact.
  const frameRects: Record<string, PackedAtlasFrame> = {};
  for (const [key, [col, row]] of Object.entries(frames)) {
    frameRects[key] = {
      frame: { x: col * CELL + PAD, y: row * CELL + PAD, w: TILE, h: TILE },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: TILE, h: TILE },
      sourceSize: { w: TILE, h: TILE },
    };
  }

  return { rgba: extruded, width: CW, height: CH, frames: frameRects };
};

const main = (): void => {
  const packed = packAtlas();
  const png = encodePng(packed.width, packed.height, packed.rgba);

  // The intermediate PNG is written to a temp dir OUTSIDE the public
  // tileset dir — only the final atlas.webp belongs in static/. The temp
  // dir is removed after cwebp processing (CodeRabbit review, C-375).
  const tmpDir = mkdtempSync(join(tmpdir(), 'aikami-atlas-'));
  const pngPath = join(tmpDir, 'atlas.png');
  const webpPath = join(outDir, 'atlas.webp');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(pngPath, png);

  // Convert PNG → WebP via cwebp (available in the Nix devShell).
  // (vips `copy` with the [Q=90] suffix misbehaves under Bun's execFileSync.)
  try {
    execFileSync('cwebp', ['-q', '90', pngPath, '-o', webpPath], { stdio: 'inherit' });
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    const hint =
      code === 'ENOENT'
        ? 'cwebp is required to encode the atlas. Install it (available in the Nix devShell) and re-run.'
        : 'cwebp failed to encode the atlas.';
    throw new Error(
      `${hint} Output target: ${webpPath} — ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  const atlasJson = {
    frames: packed.frames,
    meta: {
      app: 'aikami-emberwatch-atlas',
      version: '1.0',
      image: 'atlas.webp',
      format: 'RGBA8888',
      size: { w: packed.width, h: packed.height },
      scale: '1',
    },
  };
  writeFileSync(join(outDir, 'atlas.json'), `${JSON.stringify(atlasJson, null, 2)}\n`);

  console.log(
    `Generated atlas: ${webpPath} (${packed.width}x${packed.height}, ${Object.keys(packed.frames).length} frames, extruded ${PAD}px)`,
  );
};

if (import.meta.main) {
  main();
}
