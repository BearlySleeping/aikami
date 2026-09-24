// scripts/src/lib/ops/generate_emberwatch_house_frames.ts
//
// C-550 — procedural frames for the ordinary Emberwatch house assembly.
// The house is built from small, named tile frames rather than a second sprite
// or image sheet. Every recipe is a pure function of the tile-local pixel grid,
// so adjacent runs share an edge and repeated atlas generation is byte-stable.

import {
  buf,
  clearCell,
  fillCell,
  fillRect,
  hline,
  TILE,
  vline,
  W,
} from './generate_emberwatch_canvas.ts';

/** One of the deliberately small house-assembly frame families. */
export type HouseFrameRecipe =
  | {
      kind: 'roof';
      plane:
        | 'front'
        | 'back'
        | 'ridge'
        | 'gable-left'
        | 'gable-right'
        | 'eave-overhead'
        | 'eave-edge';
    }
  | { kind: 'facade'; variant: 'wall' | 'window' | 'corner-left' | 'corner-right' }
  | { kind: 'door'; open: boolean }
  | { kind: 'foundation'; shadow: boolean };

type RoofPlane = Extract<HouseFrameRecipe, { kind: 'roof' }>['plane'];
type FacadeVariant = Extract<HouseFrameRecipe, { kind: 'facade' }>['variant'];

type Rgb = readonly [number, number, number];

/** Six pixels is the authored upper bound for the visible base course. */
export const HOUSE_PLINTH_HEIGHT = 6;

/** Ten pixels keeps the contact band soft while staying below one tile. */
export const HOUSE_SHADOW_FADE_HEIGHT = 10;

/*
 * Weathered cedar shingles are intentional here: the neighboring village
 * buildings use warm wood, so a brown roof reads as one material family while
 * the value structure—not a blue-grey color shift—carries the three-quarter
 * roof read at tile scale.
 */
const ROOF = {
  base: [91, 66, 48] as const,
  light: [174, 132, 82] as const,
  dark: [67, 48, 37] as const,
  seam: [78, 55, 41] as const,
  ridge: [201, 157, 96] as const,
  ridgeShadow: [123, 85, 54] as const,
  gable: [132, 87, 56] as const,
  hipShadow: [82, 55, 40] as const,
  hip: [126, 91, 61] as const,
  highlight: [193, 151, 94] as const,
} satisfies Record<string, Rgb>;

const FACADE = {
  base: [126, 82, 48] as const,
  light: [158, 108, 61] as const,
  dark: [82, 51, 35] as const,
  trim: [55, 36, 28] as const,
  eaveShadow: [79, 48, 33] as const,
  window: [75, 116, 127] as const,
  windowLight: [153, 183, 174] as const,
  doorDark: [48, 32, 27] as const,
  door: [108, 67, 38] as const,
  doorLight: [145, 94, 52] as const,
  threshold: [174, 145, 99] as const,
} satisfies Record<string, Rgb>;

const FOUNDATION = {
  stone: [119, 105, 86] as const,
  light: [151, 136, 108] as const,
  dark: [73, 59, 49] as const,
  earth: [79, 64, 50] as const,
  shadow: [48, 43, 37] as const,
} satisfies Record<string, Rgb>;

const rect = (
  col: number,
  row: number,
  x0: number,
  y0: number,
  width: number,
  height: number,
  color: Rgb,
): void => {
  fillRect(col, row, x0, y0, width, height, color[0], color[1], color[2]);
};

const lineH = (col: number, row: number, y: number, color: Rgb): void => {
  hline(col, row, 0, TILE - 1, y, color[0], color[1], color[2]);
};

const lineV = (col: number, row: number, x: number, color: Rgb): void => {
  vline(col, row, x, 0, TILE - 1, color[0], color[1], color[2]);
};

const lineVRange = (
  col: number,
  row: number,
  x: number,
  y0: number,
  y1: number,
  color: Rgb,
): void => {
  vline(col, row, x, y0, y1, color[0], color[1], color[2]);
};

const shiftColor = (color: Rgb, amount: number): Rgb => [
  Math.max(0, Math.min(255, color[0] + amount)),
  Math.max(0, Math.min(255, color[1] + amount)),
  Math.max(0, Math.min(255, color[2] + amount)),
];

const setPixelRgba = (
  col: number,
  row: number,
  x: number,
  y: number,
  color: Rgb,
  alpha: number,
): void => {
  if (x < 0 || x >= TILE || y < 0 || y >= TILE) {
    return;
  }
  const index = ((row * TILE + y) * W + col * TILE + x) * 4;
  buf[index] = color[0];
  buf[index + 1] = color[1];
  buf[index + 2] = color[2];
  buf[index + 3] = Math.max(0, Math.min(255, alpha));
};

/** Makes a repeatable interior run meet itself exactly at the tile seam. */
const copyLeftEdgeToRight = (col: number, row: number): void => {
  const left = col * TILE;
  const right = left + TILE - 1;
  const top = row * TILE;
  for (let y = 0; y < TILE; y++) {
    const source = ((top + y) * W + left) * 4;
    const target = ((top + y) * W + right) * 4;
    buf[target] = buf[source];
    buf[target + 1] = buf[source + 1];
    buf[target + 2] = buf[source + 2];
    buf[target + 3] = buf[source + 3];
  }
};

/** Repeating cedar courses shared by the front and back roof planes. */
const paintRoofPlane = (col: number, row: number, light: boolean): void => {
  const base = light ? ROOF.light : ROOF.base;
  fillCell(col, row, base[0], base[1], base[2]);
  for (let y = 0; y < TILE; y++) {
    const course = Math.floor(y / 4);
    const shade = course % 2 === 0 ? 0 : -10;
    lineH(col, row, y, shiftColor(base, shade));
    if (y % 4 === 0) {
      lineH(col, row, y, light ? ROOF.highlight : ROOF.ridgeShadow);
    }
    if (y % 4 === 3) {
      lineH(col, row, y, ROOF.dark);
    }
  }
  for (let band = 0; band < 8; band++) {
    const joint = ((band * 9 + 3) % 28) + 2;
    lineVRange(col, row, joint, band * 4 + 1, band * 4 + 2, ROOF.seam);
  }
};

const paintRoofFront = (col: number, row: number): void => {
  paintRoofPlane(col, row, true);
  lineH(col, row, 1, ROOF.highlight);
  lineH(col, row, 29, ROOF.dark);
  lineH(col, row, 30, ROOF.hipShadow);
  copyLeftEdgeToRight(col, row);
};

const paintRoofBack = (col: number, row: number): void => {
  paintRoofPlane(col, row, false);
  lineH(col, row, 0, ROOF.hipShadow);
  lineH(col, row, 29, ROOF.dark);
  copyLeftEdgeToRight(col, row);
};

const paintRoofRidge = (col: number, row: number): void => {
  paintRoofPlane(col, row, true);
  rect(col, row, 0, 10, TILE, 4, ROOF.ridge);
  lineH(col, row, 10, ROOF.highlight);
  rect(col, row, 0, 14, TILE, 4, ROOF.ridgeShadow);
  lineH(col, row, 18, ROOF.hipShadow);
  copyLeftEdgeToRight(col, row);
};

/** Fill a solid hip/gable wedge instead of drawing a pair of thin diagonals. */
const paintGable = (col: number, row: number, left: boolean): void => {
  paintRoofPlane(col, row, false);
  for (let y = 2; y <= 29; y++) {
    const rise = Math.min(y - 2, 29 - y);
    const width = Math.min(16, 3 + Math.floor(rise * 0.6));
    const x = left ? 0 : TILE - width;
    rect(col, row, x, y, width, 1, ROOF.gable);
    if (width >= 6) {
      rect(col, row, left ? x + 2 : x + 1, y, width - 3, 1, ROOF.hip);
    }
  }
  lineH(col, row, 1, ROOF.ridge);
  lineH(col, row, 30, ROOF.dark);
  copyLeftEdgeToRight(col, row);
};

const paintEave = (col: number, row: number, overhead: boolean): void => {
  paintRoofPlane(col, row, !overhead);
  if (overhead) {
    lineH(col, row, 0, ROOF.ridge);
    rect(col, row, 0, 26, TILE, 6, ROOF.hipShadow);
  } else {
    lineH(col, row, 0, ROOF.highlight);
    rect(col, row, 0, 25, TILE, 5, ROOF.ridgeShadow);
    lineH(col, row, 30, ROOF.hipShadow);
  }
  copyLeftEdgeToRight(col, row);
};

/** A short, warm shadow at the top of the lower facade row reads as eave shade. */
const paintEaveShadow = (col: number, row: number): void => {
  rect(col, row, 0, 0, TILE, 4, FACADE.eaveShadow);
  lineH(col, row, 4, FACADE.dark);
};

const paintPlinth = (col: number, row: number): void => {
  const top = TILE - HOUSE_PLINTH_HEIGHT;
  rect(col, row, 0, top, TILE, HOUSE_PLINTH_HEIGHT, FOUNDATION.stone);
  lineH(col, row, top, FOUNDATION.light);
  for (let x = 4; x < TILE; x += 10) {
    lineVRange(col, row, x, top + 1, TILE - 1, FOUNDATION.dark);
  }
  lineH(col, row, TILE - 1, FOUNDATION.dark);
};

const paintUpperFacade = (col: number, row: number): void => {
  fillCell(col, row, FACADE.base[0], FACADE.base[1], FACADE.base[2]);
  for (let x = 0; x < TILE; x += 8) {
    rect(col, row, x, 0, 1, TILE, FACADE.dark);
    if (x + 1 < TILE) {
      rect(col, row, x + 1, 0, 2, TILE, FACADE.light);
    }
  }
  paintEaveShadow(col, row);
  lineH(col, row, 29, FACADE.trim);
  copyLeftEdgeToRight(col, row);
};

const paintLowerFacade = (col: number, row: number): void => {
  fillCell(col, row, FACADE.base[0], FACADE.base[1], FACADE.base[2]);
  for (let x = 0; x < TILE; x += 8) {
    rect(col, row, x, 0, 1, TILE - HOUSE_PLINTH_HEIGHT, FACADE.dark);
    if (x + 1 < TILE) {
      rect(col, row, x + 1, 0, 2, TILE - HOUSE_PLINTH_HEIGHT, FACADE.light);
    }
  }
  paintEaveShadow(col, row);
  paintPlinth(col, row);
  copyLeftEdgeToRight(col, row);
};

const paintFacadeWall = (col: number, row: number): void => {
  paintUpperFacade(col, row);
};

const paintFacadeWindow = (col: number, row: number): void => {
  paintLowerFacade(col, row);
  rect(col, row, 8, 7, 16, 18, FACADE.trim);
  rect(col, row, 10, 9, 12, 14, FACADE.window);
  rect(col, row, 11, 10, 4, 4, FACADE.windowLight);
  lineVRange(col, row, 15, 9, 22, FACADE.trim);
  lineH(col, row, 16, FACADE.trim);
};

const paintFacadeCorner = (col: number, row: number, left: boolean): void => {
  paintUpperFacade(col, row);
  const x = left ? 2 : 28;
  rect(col, row, x, 3, 3, 26, FACADE.trim);
  lineV(col, row, left ? 4 : 27, FACADE.light);
};

const paintDoor = (col: number, row: number, open: boolean): void => {
  paintLowerFacade(col, row);
  rect(col, row, 6, 2, 20, 24, FACADE.trim);
  if (open) {
    rect(col, row, 8, 4, 16, 21, FACADE.doorDark);
    rect(col, row, 9, 5, 5, 18, [42, 36, 31]);
    rect(col, row, 17, 5, 5, 18, [58, 45, 37]);
  } else {
    rect(col, row, 8, 4, 16, 21, FACADE.door);
    for (let y = 6; y < 24; y += 6) {
      lineH(col, row, y, FACADE.doorLight);
    }
    for (let x = 10; x < 23; x += 5) {
      lineVRange(col, row, x, 5, 24, FACADE.trim);
    }
    // Boarded, closed, and deliberately knobless: there is no hut transition.
    lineH(col, row, 24, FACADE.threshold);
  }
  lineH(col, row, 25, FACADE.trim);
};

const paintFoundation = (col: number, row: number, shadow: boolean): void => {
  if (shadow) {
    clearCell(col, row);
    for (let y = 0; y < TILE; y++) {
      const verticalFade = Math.max(0, 1 - y / HOUSE_SHADOW_FADE_HEIGHT);
      const alpha = Math.floor(92 * verticalFade);
      if (alpha === 0) {
        continue;
      }
      for (let x = 0; x < TILE; x++) {
        setPixelRgba(col, row, x, y, FOUNDATION.shadow, alpha);
      }
    }
    return;
  }
  paintLowerFacade(col, row);
};

const ROOF_PAINTERS: Readonly<Record<RoofPlane, (col: number, row: number) => void>> = {
  front: paintRoofFront,
  back: paintRoofBack,
  ridge: paintRoofRidge,
  'gable-left': (col, row) => paintGable(col, row, true),
  'gable-right': (col, row) => paintGable(col, row, false),
  'eave-overhead': (col, row) => paintEave(col, row, true),
  'eave-edge': (col, row) => paintEave(col, row, false),
};

const FACADE_PAINTERS: Readonly<Record<FacadeVariant, (col: number, row: number) => void>> = {
  wall: paintFacadeWall,
  window: paintFacadeWindow,
  'corner-left': (col, row) => paintFacadeCorner(col, row, true),
  'corner-right': (col, row) => paintFacadeCorner(col, row, false),
};

/** Writes one recipe into an atlas cell; exported for the packer's dispatch. */
export const paintHouseFrame = (options: {
  col: number;
  row: number;
  recipe: HouseFrameRecipe;
}): void => {
  const { col, row, recipe } = options;
  if (recipe.kind === 'roof') {
    ROOF_PAINTERS[recipe.plane](col, row);
    return;
  }
  if (recipe.kind === 'facade') {
    FACADE_PAINTERS[recipe.variant](col, row);
    return;
  }
  if (recipe.kind === 'door') {
    paintDoor(col, row, recipe.open);
    return;
  }
  paintFoundation(col, row, recipe.shadow);
};

/** Frame name → recipe. Keys mirror the append-only manifest entries. */
export const HOUSE_FRAME_PAINT: Readonly<Record<string, HouseFrameRecipe>> = {
  'house_roof_front.png': { kind: 'roof', plane: 'front' },
  'house_roof_back.png': { kind: 'roof', plane: 'back' },
  'house_roof_ridge.png': { kind: 'roof', plane: 'ridge' },
  'house_roof_gable_left.png': { kind: 'roof', plane: 'gable-left' },
  'house_roof_gable_right.png': { kind: 'roof', plane: 'gable-right' },
  'house_roof_eave_overhead.png': { kind: 'roof', plane: 'eave-overhead' },
  'house_roof_eave_edge.png': { kind: 'roof', plane: 'eave-edge' },
  'house_facade_wall.png': { kind: 'facade', variant: 'wall' },
  'house_facade_window.png': { kind: 'facade', variant: 'window' },
  'house_facade_corner_left.png': { kind: 'facade', variant: 'corner-left' },
  'house_facade_corner_right.png': { kind: 'facade', variant: 'corner-right' },
  'house_door_closed.png': { kind: 'door', open: false },
  'house_door_open.png': { kind: 'door', open: true },
  'house_foundation.png': { kind: 'foundation', shadow: false },
  'house_foundation_shadow.png': { kind: 'foundation', shadow: true },
};

/**
 * Paint a named house frame when it belongs to the C-550 kit.
 *
 * Keeping the lookup here gives the atlas generator a single table-driven
 * dispatch seam without coupling the large painter registry to house details.
 */
export const paintHouseFrameByName = (options: {
  key: string;
  col: number;
  row: number;
}): boolean => {
  const recipe = HOUSE_FRAME_PAINT[options.key];
  if (!recipe) {
    return false;
  }
  paintHouseFrame({ col: options.col, row: options.row, recipe });
  return true;
};
