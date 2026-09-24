// scripts/src/lib/ops/generate_emberwatch_terrain_frames.ts
//
// Emberwatch terrain materials and the organic corner16 compositor (C-552).
// The atlas generator owns packing; this module owns every outdoor material
// whose pixels must stay coherent across repeated cells and transition masks.

import {
  buf,
  fillCell,
  hline,
  makeRng,
  noiseCell,
  setPx,
  TILE,
  W,
} from './generate_emberwatch_canvas.ts';

/** Paints one complete 32×32 material into an atlas cell. */
export type TerrainPaint = (col: number, row: number) => void;

const BAYER_4X4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep = (value: number): number => value * value * (3 - 2 * value);
const mix = (from: number, to: number, amount: number): number => from + (to - from) * amount;

const mixChannel = (base: number, overlay: number, coverage: number): number =>
  Math.round(mix(base, overlay, clamp01(coverage)));

const mixCellPixel = (options: {
  col: number;
  row: number;
  x: number;
  y: number;
  base: readonly [number, number, number];
  overlay: readonly [number, number, number];
  coverage: number;
}): void => {
  const { col, row, x, y, base, overlay, coverage } = options;
  setPx(
    col * TILE + x,
    row * TILE + y,
    mixChannel(base[0], overlay[0], coverage),
    mixChannel(base[1], overlay[1], coverage),
    mixChannel(base[2], overlay[2], coverage),
  );
};

/** Packed-earth road material. Its phase is shared by every dirt mask. */
export const paintDirt: TerrainPaint = (col, row) => {
  fillCell(col, row, 138, 90, 51);
  noiseCell(col, row, 0x243f6a88, 0.6, 30, 24, 18);
  const rng = makeRng(0xd177);
  for (let index = 0; index < 18; index++) {
    const x = Math.floor(rng() * TILE);
    const y = Math.floor(rng() * TILE);
    const color = rng() < 0.5 ? ([153, 104, 63] as const) : ([122, 76, 42] as const);
    setPx(col * TILE + x, row * TILE + y, color[0], color[1], color[2]);
  }
};

/** Low-contrast dirt fringe keeps the grass/dirt handoff soft at cell scale. */
export const paintDirtFringe: TerrainPaint = (col, row) => {
  fillCell(col, row, 106, 116, 55);
  noiseCell(col, row, 0xbb67ae85, 0.35, 8, 10, 8);
  const rng = makeRng(0x3c6ef3);
  for (let index = 0; index < 10; index++) {
    const x = Math.floor(rng() * TILE);
    const y = Math.floor(rng() * TILE);
    const color = rng() < 0.5 ? ([112, 120, 60] as const) : ([98, 108, 52] as const);
    setPx(col * TILE + x, row * TILE + y, color[0], color[1], color[2]);
  }
};

/** Loose packed gravel, shared by the gravel overlay and earth base. */
export const paintGravel: TerrainPaint = (col, row) => {
  fillCell(col, row, 112, 108, 96);
  noiseCell(col, row, 0x85ebca6b, 0.7, 34, 32, 26);
  const rng = makeRng(0x6a09e667);
  for (let index = 0; index < 40; index++) {
    const x = Math.floor(rng() * TILE);
    const y = Math.floor(rng() * TILE);
    const value = rng();
    if (value < 0.4) {
      setPx(col * TILE + x, row * TILE + y, 138, 134, 122);
    } else if (value < 0.7) {
      setPx(col * TILE + x, row * TILE + y, 88, 84, 74);
    }
  }
};

/** Dark packed earth for the `earth` corner family and standalone terrain. */
export const paintEarth: TerrainPaint = (col, row) => {
  fillCell(col, row, 78, 58, 40);
  noiseCell(col, row, 0xbb67ae85, 0.65, 26, 20, 16);
  const rng = makeRng(0x3c6ef3);
  for (let index = 0; index < 22; index++) {
    const x = Math.floor(rng() * TILE);
    const y = Math.floor(rng() * TILE);
    const color = rng() < 0.5 ? ([96, 72, 50] as const) : ([62, 46, 32] as const);
    setPx(col * TILE + x, row * TILE + y, color[0], color[1], color[2]);
  }
};

/** Warm timber planks used beneath the indoor cobblestone corner family. */
export const paintWoodFloor: TerrainPaint = (col, row) => {
  fillCell(col, row, 155, 106, 63);
  for (let y = 0; y < TILE; y++) {
    const plank = Math.floor(y / 4);
    const shade = plank % 2 === 0 ? 0 : -14;
    hline(col, row, 0, TILE - 1, y, 155 + shade, 106 + shade, 63 + shade);
    if (y % 4 === 3) {
      const seam = (plank * 7) % TILE;
      setPx(col * TILE + seam, row * TILE + y, 110, 68, 38);
      setPx(col * TILE + ((seam + 16) % TILE), row * TILE + y, 110, 68, 38);
    }
  }
  noiseCell(col, row, 0xa54ff53a, 0.2, 16, 12, 10);
};

const hashCell = (x: number, y: number, seed: number): number => {
  let value =
    (Math.imul(x, 0x1f123bb5) ^ Math.imul(y, 0x5f356495) ^ Math.imul(seed, 0x6c8e9cf5)) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
};

const toroidalDistance = (value: number, center: number): number => {
  const direct = Math.abs(value - center);
  return Math.min(direct, TILE - direct);
};

type StoneSeed = { x: number; y: number; tone: 0 | 1 | 2 };

/** Six large, jittered cells wrap at the tile edge to avoid an 8 px grid. */
const STONE_SEEDS: readonly StoneSeed[] = [
  { x: 4, y: 5, tone: 0 },
  { x: 20, y: 3, tone: 1 },
  { x: 8, y: 18, tone: 2 },
  { x: 25, y: 16, tone: 0 },
  { x: 3, y: 29, tone: 1 },
  { x: 21, y: 28, tone: 2 },
] as const;

const STONE_TONES = [
  [116, 120, 110],
  [120, 124, 113],
  [113, 118, 108],
] as const;
const STONE_MORTAR = [105, 110, 101] as const;

type StoneMatch = {
  nearestDistance: number;
  secondDistance: number;
  tone: 0 | 1 | 2;
};

const findNearestStone = (x: number, y: number): StoneMatch => {
  let nearestDistance = Number.POSITIVE_INFINITY;
  let secondDistance = Number.POSITIVE_INFINITY;
  let tone: 0 | 1 | 2 = 0;
  for (const stone of STONE_SEEDS) {
    const dx = toroidalDistance(x + 0.5, stone.x + 0.5);
    const dy = toroidalDistance(y + 0.5, stone.y + 0.5);
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance) {
      secondDistance = nearestDistance;
      nearestDistance = distance;
      tone = stone.tone;
    } else if (distance < secondDistance) {
      secondDistance = distance;
    }
  }
  return { nearestDistance, secondDistance, tone };
};

const stonePixelColor = (options: {
  x: number;
  y: number;
  tones: ReadonlyArray<readonly [number, number, number]>;
  mortar: readonly [number, number, number];
  seed: number;
  toneLift: number;
}): readonly [number, number, number] => {
  const { x, y, tones, mortar, seed, toneLift } = options;
  const match = findNearestStone(x, y);
  const grain = hashCell(x, y, seed) - 0.5;
  const isMortar = Math.sqrt(match.secondDistance) - Math.sqrt(match.nearestDistance) < 1.15;
  const tone = isMortar ? mortar : (tones[match.tone] ?? mortar);
  return [
    Math.round(tone[0] + toneLift + grain * 4),
    Math.round(tone[1] + toneLift + grain * 4),
    Math.round(tone[2] + toneLift + grain * 4),
  ];
};

const paintIrregularStone = (options: {
  col: number;
  row: number;
  tones: ReadonlyArray<readonly [number, number, number]>;
  mortar: readonly [number, number, number];
  seed: number;
  toneLift?: number;
}): void => {
  const { col, row, tones, mortar, seed } = options;
  const toneLift = options.toneLift ?? 0;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const color = stonePixelColor({ x, y, tones, mortar, seed, toneLift });
      setPx(col * TILE + x, row * TILE + y, color[0], color[1], color[2]);
    }
  }
};

/** Calm shared floor/cobble material: six large wrapped stones, low mortar contrast. */
export const paintStoneFloor: TerrainPaint = (col, row) => {
  paintIrregularStone({
    col,
    row,
    tones: STONE_TONES,
    mortar: STONE_MORTAR,
    seed: 0x510e527f,
  });
};

const COBBLE_TONES = [
  [142, 145, 139],
  [147, 149, 143],
  [138, 142, 136],
] as const;
const COBBLE_MORTAR = [128, 132, 126] as const;

const paintCobbleTone = (options: { col: number; row: number; toneLift: number }): void => {
  const { col, row, toneLift } = options;
  paintIrregularStone({
    col,
    row,
    tones: COBBLE_TONES,
    mortar: COBBLE_MORTAR,
    seed: 0x1f83d9ab,
    toneLift,
  });
};

/** Indoor cobble overlay with the same wrapped, irregular construction. */
export const paintCobble: TerrainPaint = (col, row) => {
  paintCobbleTone({ col, row, toneLift: 0 });
};

/** Existing worn-path variant, now a lighter value of the same calm cobble. */
export const paintCobbleLight: TerrainPaint = (col, row) => {
  paintCobbleTone({ col, row, toneLift: 12 });
};

const INTERIOR_FLAGSTONE_TONES = [
  [136, 132, 120],
  [140, 136, 123],
  [132, 130, 119],
] as const;
const INTERIOR_FLAGSTONE_MORTAR = [123, 125, 118] as const;

/** Restrained indoor flagstone; its wrapped cells never form bright square decals. */
export const paintInteriorFlagstone: TerrainPaint = (col, row) => {
  paintIrregularStone({
    col,
    row,
    tones: INTERIOR_FLAGSTONE_TONES,
    mortar: INTERIOR_FLAGSTONE_MORTAR,
    seed: 0x6a09e667,
  });
};

/** Blue water material shared by the standalone and corner16 frames. */
export const paintWater: TerrainPaint = (col, row) => {
  fillCell(col, row, 46, 111, 176);
  const rng = makeRng(0x5be0cd19);
  for (let index = 0; index < 30; index++) {
    const x = Math.floor(rng() * TILE);
    const y = Math.floor(rng() * TILE);
    const color = rng() < 0.5 ? ([63, 132, 196] as const) : ([39, 97, 156] as const);
    setPx(col * TILE + x, row * TILE + y, color[0], color[1], color[2]);
  }
  for (let y = 4; y < TILE; y += 8) {
    for (let x = 2; x < TILE - 4; x += 3) {
      setPx(col * TILE + x, row * TILE + y, 82, 158, 214);
    }
  }
};

/**
 * Wet-bank under-material for water corner frames.
 *
 * Water cells are rendered above the grass base by the layered autotiler. If
 * that base remains grass, every partial water mask leaks bright green pixels
 * through the ripple field. A blue-grey under-material keeps the transition
 * readable without introducing a second grass family into water tiles.
 */
export const paintWaterUnderlay: TerrainPaint = (col, row) => {
  fillCell(col, row, 44, 88, 116);
  noiseCell(col, row, 0x3c6ef3, 0.45, 10, 12, 10);
  const rng = makeRng(0x1f83d9ab);
  for (let index = 0; index < 14; index++) {
    const x = Math.floor(rng() * TILE);
    const y = Math.floor(rng() * TILE);
    const color = rng() < 0.5 ? ([54, 102, 132] as const) : ([36, 76, 104] as const);
    setPx(col * TILE + x, row * TILE + y, color[0], color[1], color[2]);
  }
};

/** Warm sand base. Slightly more yellow separation prevents a muddy dawn read. */
export const paintSand: TerrainPaint = (col, row) => {
  fillCell(col, row, 218, 198, 132);
  noiseCell(col, row, 0x5748fe9d, 0.5, 22, 20, 14);
};

const CORNERS = [
  { bit: 0b0001, x: 0, y: 0 },
  { bit: 0b0010, x: 32, y: 0 },
  { bit: 0b0100, x: 32, y: 32 },
  { bit: 0b1000, x: 0, y: 32 },
] as const;

/** Shared seed values keep each material's boundary phase stable across masks. */
export const CORNER_TERRAIN_SEEDS = {
  dirt: 107,
  water: 111,
  gravel: 117,
  earth: 120,
  cobblestone: 128,
  path: 131,
} as const;

const isOuterEdge = (x: number, y: number): boolean =>
  x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1;

const edgeCoverage = (options: { mask: number; x: number; y: number; seed: number }): number => {
  const { mask, x, y, seed } = options;
  let first = false;
  let second = false;
  let along = 0;
  if (y === 0) {
    first = (mask & 0b0001) !== 0;
    second = (mask & 0b0010) !== 0;
    along = x;
  } else if (x === TILE - 1) {
    first = (mask & 0b0010) !== 0;
    second = (mask & 0b0100) !== 0;
    along = y;
  } else if (y === TILE - 1) {
    first = (mask & 0b1000) !== 0;
    second = (mask & 0b0100) !== 0;
    along = x;
  } else {
    first = (mask & 0b0001) !== 0;
    second = (mask & 0b1000) !== 0;
    along = y;
  }
  if (first === second) {
    return first ? 1 : 0;
  }

  const firstHalf = along < 16;
  const active = first ? firstHalf : !firstHalf;
  if (Math.abs(along - 15.5) > 3) {
    return active ? 1 : 0;
  }
  const noise = hashCell(along, first ? 37 : 73, seed);
  return active ? 0.58 + (noise - 0.5) * 0.12 : 0.42 + (noise - 0.5) * 0.12;
};

/**
 * Returns a signed diagonal field for the three-corner masks.
 *
 * The missing corner owns the low-distance side of the field; the other three
 * corners own the high-distance side. This replaces four repeated radial lobes
 * at the real landing masks (13/14) with one coherent noisy contour.
 */
const diagonalCornerField = (options: {
  mask: number;
  x: number;
  y: number;
  seed: number;
}): number | undefined => {
  const { mask, x, y, seed } = options;
  const px = x + 0.5;
  const py = y + 0.5;
  let distanceFromMissingCorner: number;
  if (mask === 14) {
    distanceFromMissingCorner = px + py;
  } else if (mask === 13) {
    distanceFromMissingCorner = py + TILE - px;
  } else if (mask === 7) {
    distanceFromMissingCorner = px + TILE - py;
  } else if (mask === 11) {
    distanceFromMissingCorner = TILE - px + TILE - py;
  } else {
    return undefined;
  }
  const boundary =
    18.5 +
    1.6 * Math.sin(distanceFromMissingCorner * 0.23 + seed * 0.047) +
    1.0 * Math.sin((px - py) * 0.17 - seed * 0.031) +
    0.6 * Math.sin(distanceFromMissingCorner * 0.61 + seed * 0.019) +
    0.45 * Math.sin(distanceFromMissingCorner * 1.13 - seed * 0.023);
  return distanceFromMissingCorner - boundary + 2.4;
};

/**
 * Returns a signed field for the four adjacent-corner masks.
 *
 * A radial union is attractive in isolation, but repeating one circle per cell
 * makes a row of masks read as a row of triangular teeth. Adjacent-corner
 * masks instead get a noisy, tile-local boundary across the owned half. The
 * frequencies are deliberately incommensurate with the 32 px tile, so the
 * contour does not settle into a short repeating sawtooth.
 */
const adjacentCornerField = (options: {
  mask: number;
  x: number;
  y: number;
  seed: number;
}): number | undefined => {
  const { mask, x, y, seed } = options;
  const px = x + 0.5;
  const py = y + 0.5;
  const along = mask === 3 || mask === 12 ? px : py;
  const boundary =
    15.5 +
    1.4 * Math.sin(along * 0.29 + seed * 0.071) +
    1.0 * Math.sin(along * 0.17 - seed * 0.113) +
    0.5 * Math.sin(along * 0.73 + seed * 0.037) +
    0.45 * Math.sin(along * 1.19 + seed * 0.029);
  if (mask === 3) {
    return boundary - py + 2.4;
  }
  if (mask === 12) {
    return py - boundary + 2.4;
  }
  if (mask === 6) {
    return px - boundary + 2.4;
  }
  if (mask === 9) {
    return boundary - px + 2.4;
  }
  return undefined;
};

/** Material-independent organic coverage: rounded corners, coherent noise, opaque dither. */
const cornerCoverage = (options: { mask: number; x: number; y: number; seed: number }): number => {
  const { mask, x, y, seed } = options;
  if (isOuterEdge(x, y)) {
    return edgeCoverage(options);
  }
  // A fully-owned cell must never fall back to its base material. The noisy
  // fields are for transition interiors only; mask 15 is an invariant.
  if (mask === 0b1111) {
    return 1;
  }

  const px = x + 0.5;
  const py = y + 0.5;
  const foldX = Math.min(px, TILE - px);
  const foldY = Math.min(py, TILE - py);
  const adjacentField = diagonalCornerField(options) ?? adjacentCornerField(options);
  let field = adjacentField ?? 10.5 - Math.hypot(px - 16, py - 16);
  if (adjacentField === undefined) {
    for (const corner of CORNERS) {
      if ((mask & corner.bit) === 0) {
        continue;
      }
      const dx = px - corner.x;
      const dy = py - corner.y;
      const distance = Math.hypot(dx, dy);
      const angle = Math.atan2(Math.abs(dy), Math.abs(dx));
      const radius =
        20.5 + 1.6 * Math.sin(angle * 3 + seed * 0.01) + 0.9 * Math.sin(angle * 7 - seed * 0.013);
      field = Math.max(field, radius - distance);
    }
  }

  const organic =
    0.8 * Math.sin(foldX * 0.37 + foldY * 0.23 + seed * 0.017) +
    0.5 * Math.sin(foldY * 0.51 - foldX * 0.19 - seed * 0.011) +
    0.3 * Math.sin((foldX + foldY) * 0.29 + seed * 0.007);
  const ordered = BAYER_4X4[(y & 3) * 4 + (x & 3)] / 15 - 0.5;
  const grain = hashCell(x, y, seed + 911) - 0.5;
  return smoothstep(clamp01((field + organic + ordered * 0.3 + grain * 0.05 + 3.25) / 6.5));
};

/** Material-independent organic coverage used by the compositor and pixel tests. */
export const cornerCoverageForPixel = (options: {
  mask: number;
  x: number;
  y: number;
  seed: number;
}): number => cornerCoverage(options);

const snapshotCell = (options: { col: number; row: number; paint: TerrainPaint }): Uint8Array => {
  const { col, row, paint } = options;
  const snapshot = new Uint8Array(TILE * TILE * 3);
  paint(col, row);
  const cellX = col * TILE;
  const cellY = row * TILE;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const source = ((cellY + y) * W + cellX + x) * 4;
      const target = (y * TILE + x) * 3;
      snapshot[target] = buf[source] ?? 0;
      snapshot[target + 1] = buf[source + 1] ?? 0;
      snapshot[target + 2] = buf[source + 2] ?? 0;
    }
  }
  return snapshot;
};

const materialMean = (pixels: Uint8Array): readonly [number, number, number] => {
  const total = TILE * TILE;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let index = 0; index < pixels.length; index += 3) {
    red += pixels[index] ?? 0;
    green += pixels[index + 1] ?? 0;
    blue += pixels[index + 2] ?? 0;
  }
  return [red / total, green / total, blue / total];
};

type CornerColor = readonly [number, number, number];
type CornerFrameSnapshot = {
  basePixels: Uint8Array;
  overlayPixels: Uint8Array;
  fringePixels: Uint8Array;
  baseMean: CornerColor;
  overlayMean: CornerColor;
};

const snapshotCornerFrame = (options: {
  col: number;
  row: number;
  base: TerrainPaint;
  overlay: TerrainPaint;
  fringe?: TerrainPaint;
}): CornerFrameSnapshot => {
  const basePixels = snapshotCell({ col: options.col, row: options.row, paint: options.base });
  const overlayPixels = snapshotCell({
    col: options.col,
    row: options.row,
    paint: options.overlay,
  });
  const fringePixels = snapshotCell({
    col: options.col,
    row: options.row,
    paint: options.fringe ?? options.overlay,
  });
  return {
    basePixels,
    overlayPixels,
    fringePixels,
    baseMean: materialMean(basePixels),
    overlayMean: materialMean(overlayPixels),
  };
};

const cornerPixelColor = (pixels: Uint8Array, offset: number): CornerColor => [
  pixels[offset] ?? 0,
  pixels[offset + 1] ?? 0,
  pixels[offset + 2] ?? 0,
];

const paintOuterCornerPixel = (options: {
  col: number;
  row: number;
  x: number;
  y: number;
  coverage: number;
  baseColor: CornerColor;
  overlayColor: CornerColor;
  snapshot: CornerFrameSnapshot;
}): void => {
  const { snapshot } = options;
  const canonical: CornerColor = [
    mixChannel(snapshot.baseMean[0], snapshot.overlayMean[0], options.coverage),
    mixChannel(snapshot.baseMean[1], snapshot.overlayMean[1], options.coverage),
    mixChannel(snapshot.baseMean[2], snapshot.overlayMean[2], options.coverage),
  ];
  mixCellPixel({
    col: options.col,
    row: options.row,
    x: options.x,
    y: options.y,
    base: [
      mixChannel(options.baseColor[0], options.overlayColor[0], options.coverage),
      mixChannel(options.baseColor[1], options.overlayColor[1], options.coverage),
      mixChannel(options.baseColor[2], options.overlayColor[2], options.coverage),
    ],
    overlay: canonical,
    coverage: 0.8,
  });
};

const selectCornerColor = (options: {
  coverage: number;
  baseColor: CornerColor;
  fringeColor: CornerColor;
  overlayColor: CornerColor;
}): CornerColor => {
  if (options.coverage >= 0.72) {
    return options.overlayColor;
  }
  if (options.coverage >= 0.28) {
    return options.fringeColor;
  }
  return options.baseColor;
};

const paintCornerPixel = (options: {
  col: number;
  row: number;
  x: number;
  y: number;
  mask: number;
  seed: number;
  snapshot: CornerFrameSnapshot;
}): void => {
  const offset = (options.y * TILE + options.x) * 3;
  const coverage = cornerCoverage({
    mask: options.mask,
    x: options.x,
    y: options.y,
    seed: options.seed,
  });
  const baseColor = cornerPixelColor(options.snapshot.basePixels, offset);
  const overlayColor = cornerPixelColor(options.snapshot.overlayPixels, offset);
  const fringeColor = cornerPixelColor(options.snapshot.fringePixels, offset);
  if (isOuterEdge(options.x, options.y)) {
    paintOuterCornerPixel({
      col: options.col,
      row: options.row,
      x: options.x,
      y: options.y,
      coverage,
      baseColor,
      overlayColor,
      snapshot: options.snapshot,
    });
    return;
  }
  const materialColor = selectCornerColor({ coverage, baseColor, fringeColor, overlayColor });
  setPx(
    options.col * TILE + options.x,
    options.row * TILE + options.y,
    materialColor[0],
    materialColor[1],
    materialColor[2],
  );
};

/**
 * Paints one organic corner16 frame while keeping every pixel opaque.
 * Outer-edge coverage is shared by compatible masks; material phase is
 * tile-local, so neighbouring masks do not change texture at the seam.
 */
export const paintCornerFrame = (options: {
  col: number;
  row: number;
  mask: number;
  base: TerrainPaint;
  overlay: TerrainPaint;
  fringe?: TerrainPaint;
  seed: number;
}): void => {
  const snapshot = snapshotCornerFrame(options);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      paintCornerPixel({
        col: options.col,
        row: options.row,
        x,
        y,
        mask: options.mask,
        seed: options.seed,
        snapshot,
      });
    }
  }
};
