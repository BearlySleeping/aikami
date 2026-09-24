// scripts/src/lib/ops/generate_emberwatch_grass_frames.ts
//
// The Emberwatch grass material and its variants (C-549, plan §1.6).
//
// Extracted from `generate_emberwatch_atlas.ts` so the grass family reads as
// one material instead of three unrelated painters, and so the restraint rules
// live next to the code that has to obey them.
//
// THE RULE: a grass variant must never read as a tile. Two defects motivated
// this module:
//   • `paintGrassDark` painted from RGB(58,116,50) against the base's
//     RGB(74,143,60) — a materially darker cell, so scattered dark tiles read
//     as isolated squares.
//   • the flower variant scattered up to seven saturated flecks (near-white
//     240,240,240 and magenta 201,91,210) per tile on a per-tile lattice, so
//     they repeated as a regular grid of bright dots.
//
// Every variant here therefore starts from the SAME base material and adds only
// a handful of decals that sit inside the base's own value envelope. The
// builders' side of the same rule — variants must be placed in broad correlated
// patches, not independently per cell — is `scatterPatches` in
// `emberwatch_map_shared.ts`.

import { fillCell, makeRng, noiseCell, setPx, TILE } from './generate_emberwatch_canvas.ts';

/** The one grass base colour, shared by the base frame and every variant. */
export const GRASS_BASE = [74, 143, 60] as const;

/**
 * The base grass material: a flat fill, per-pixel noise, and a light speckle.
 * Every grass frame — base, dark, flower, and the four `grass_edge_*` frames —
 * composes from this, so a variant can never drift in base value or edge value.
 */
export const paintGrass = (col: number, row: number): void => {
  fillCell(col, row, GRASS_BASE[0], GRASS_BASE[1], GRASS_BASE[2]);
  noiseCell(col, row, 0x7f4a7c15, 0.55, 26, 30, 20);
  const rng = makeRng(0x4a7c15f1);
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

/**
 * The flower/fleck variant: the base material plus a few sparse clumps barely
 * a shade off the base value. Placement is a seeded RNG over the whole cell —
 * irregular, never on a fixed pitch — and the clump colours sit inside the base
 * grass family's own value envelope, so the variant reads as a slightly
 * different patch of the same meadow.
 */
export const paintGrassFlowers = (col: number, row: number): void => {
  paintGrass(col, row);
  const rng = makeRng(0x2c1b3c6d);
  const clumps = [[88, 154, 70] as const, [64, 126, 52] as const];
  for (let index = 0; index < 2; index++) {
    const x = 3 + Math.floor(rng() * (TILE - 7));
    const y = 4 + Math.floor(rng() * (TILE - 8));
    const color = clumps[Math.floor(rng() * clumps.length)] ?? clumps[0];
    setPx(col * TILE + x, row * TILE + y, color[0], color[1], color[2]);
    setPx(col * TILE + x + 1, row * TILE + y, color[0], color[1], color[2]);
    setPx(col * TILE + x + 3, row * TILE + y, color[0], color[1], color[2]);
    if (index === 0) {
      setPx(col * TILE + x, row * TILE + y - 1, clumps[0][0], clumps[0][1], clumps[0][2]);
      setPx(col * TILE + x + 2, row * TILE + y + 1, clumps[1][0], clumps[1][1], clumps[1][2]);
    }
  }
};

/**
 * The dark grass variant: the same material value as the base with a sparse,
 * low-contrast dapple. It is a subtle texture variation, never an isolated
 * dark square.
 */
export const paintGrassDark = (col: number, row: number): void => {
  paintGrass(col, row);
  const rng = makeRng(0x6c8e9cf5);
  for (let i = 0; i < 9; i++) {
    const x = Math.floor(rng() * TILE);
    const y = Math.floor(rng() * TILE);
    setPx(col * TILE + x, row * TILE + y, 66, 130, 54);
    if (rng() < 0.35) {
      setPx(col * TILE + x, row * TILE + y, 70, 134, 58);
    }
  }
};
