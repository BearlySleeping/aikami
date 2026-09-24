// scripts/src/lib/ops/generate_emberwatch_house_frames.ts
//
// C-550 — procedural frames for the ordinary Emberwatch house assembly.
// The house is built from small, named tile frames rather than a second sprite
// or image sheet. Every recipe is a pure function of the tile-local pixel grid,
// so adjacent runs share an edge and repeated atlas generation is byte-stable.

import {
  buf,
  fillCell,
  fillRect,
  hline,
  setPx,
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

const ROOF = {
  base: [88, 104, 116] as const,
  light: [132, 146, 154] as const,
  dark: [54, 68, 82] as const,
  seam: [39, 52, 65] as const,
  ridge: [166, 173, 176] as const,
} satisfies Record<string, Rgb>;

const FACADE = {
  base: [124, 94, 67] as const,
  light: [153, 116, 80] as const,
  dark: [79, 58, 42] as const,
  trim: [57, 43, 33] as const,
  window: [79, 126, 139] as const,
  windowLight: [144, 184, 185] as const,
  doorDark: [42, 37, 37] as const,
  door: [133, 88, 53] as const,
  doorLight: [176, 121, 69] as const,
  threshold: [162, 151, 126] as const,
} satisfies Record<string, Rgb>;

const FOUNDATION = {
  stone: [105, 108, 110] as const,
  light: [143, 145, 143] as const,
  dark: [61, 65, 69] as const,
  earth: [79, 64, 50] as const,
  shadow: [48, 47, 45] as const,
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

const pixel = (col: number, row: number, x: number, y: number, color: Rgb): void => {
  setPx(col * TILE + x, row * TILE + y, color[0], color[1], color[2]);
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

/** Repeating shingle courses shared by the front and back roof planes. */
const paintRoofPlane = (col: number, row: number, light: boolean): void => {
  const base = light ? ROOF.light : ROOF.base;
  fillCell(col, row, base[0], base[1], base[2]);
  for (let y = 0; y < TILE; y++) {
    const course = Math.floor(y / 4);
    const shade = course % 2 === 0 ? 0 : -12;
    lineH(col, row, y, [base[0] + shade, base[1] + shade, base[2] + shade] as const);
    if (y % 4 === 0) {
      lineH(col, row, y, ROOF.light);
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
  paintRoofPlane(col, row, false);
  lineH(col, row, 1, ROOF.ridge);
  lineH(col, row, 30, ROOF.dark);
  copyLeftEdgeToRight(col, row);
};

const paintRoofBack = (col: number, row: number): void => {
  paintRoofPlane(col, row, true);
  lineH(col, row, 0, ROOF.ridge);
  lineH(col, row, 29, ROOF.dark);
  copyLeftEdgeToRight(col, row);
};

const paintRoofRidge = (col: number, row: number): void => {
  paintRoofPlane(col, row, false);
  rect(col, row, 0, 12, TILE, 8, ROOF.ridge);
  lineH(col, row, 12, ROOF.light);
  lineH(col, row, 19, ROOF.dark);
  lineH(col, row, 20, ROOF.seam);
  copyLeftEdgeToRight(col, row);
};

const paintGable = (col: number, row: number, left: boolean): void => {
  paintRoofPlane(col, row, false);
  for (let y = 2; y < 30; y++) {
    const inset = Math.min(y, 31 - y);
    const x = left ? inset : TILE - 1 - inset;
    pixel(col, row, x, y, ROOF.ridge);
    pixel(col, row, left ? x + 1 : x - 1, y, ROOF.dark);
  }
  lineH(col, row, 30, ROOF.seam);
};

const paintEave = (col: number, row: number, overhead: boolean): void => {
  paintRoofPlane(col, row, false);
  if (overhead) {
    lineH(col, row, 0, ROOF.ridge);
    lineH(col, row, 27, ROOF.dark);
  } else {
    rect(col, row, 0, 25, TILE, 7, ROOF.dark);
    lineH(col, row, 25, ROOF.light);
    lineH(col, row, 31, ROOF.seam);
  }
  copyLeftEdgeToRight(col, row);
};

const paintFacadeWall = (col: number, row: number): void => {
  fillCell(col, row, FACADE.base[0], FACADE.base[1], FACADE.base[2]);
  for (let x = 0; x < TILE; x += 8) {
    rect(col, row, x, 0, 1, TILE, FACADE.dark);
    if (x + 1 < TILE) {
      rect(col, row, x + 1, 0, 2, TILE, FACADE.light);
    }
  }
  lineH(col, row, 2, FACADE.trim);
  lineH(col, row, 29, FACADE.trim);
  for (let y = 7; y < 26; y += 6) {
    lineH(col, row, y, FACADE.dark);
  }
  copyLeftEdgeToRight(col, row);
};

const paintFacadeWindow = (col: number, row: number): void => {
  paintFacadeWall(col, row);
  rect(col, row, 8, 7, 16, 19, FACADE.trim);
  rect(col, row, 10, 9, 12, 15, FACADE.window);
  rect(col, row, 11, 10, 4, 4, FACADE.windowLight);
  lineVRange(col, row, 15, 9, 23, FACADE.trim);
  lineH(col, row, 16, FACADE.trim);
};

const paintFacadeCorner = (col: number, row: number, left: boolean): void => {
  paintFacadeWall(col, row);
  const x = left ? 2 : 28;
  rect(col, row, x, 3, 3, 26, FACADE.trim);
  lineV(col, row, left ? 4 : 27, FACADE.light);
};

const paintDoor = (col: number, row: number, open: boolean): void => {
  paintFacadeWall(col, row);
  rect(col, row, 6, 2, 20, 28, FACADE.trim);
  rect(col, row, 8, 4, 16, 24, open ? FACADE.doorDark : FACADE.door);
  if (open) {
    rect(col, row, 9, 5, 5, 20, [55, 53, 51] as const);
    rect(col, row, 17, 5, 5, 20, [67, 60, 53] as const);
    lineH(col, row, 25, FACADE.threshold);
  } else {
    for (let x = 9; x < 24; x += 4) {
      rect(col, row, x, 5, 2, 22, FACADE.doorLight);
      lineVRange(col, row, x + 2, 5, 26, FACADE.trim);
    }
    pixel(col, row, 21, 17, [220, 197, 129]);
  }
  lineH(col, row, 29, FACADE.threshold);
};

const paintFoundation = (col: number, row: number, shadow: boolean): void => {
  if (shadow) {
    fillCell(col, row, FOUNDATION.earth[0], FOUNDATION.earth[1], FOUNDATION.earth[2]);
    rect(col, row, 0, 22, TILE, 10, FOUNDATION.shadow);
    lineH(col, row, 22, FOUNDATION.earth);
    return;
  }
  fillCell(col, row, FOUNDATION.stone[0], FOUNDATION.stone[1], FOUNDATION.stone[2]);
  rect(col, row, 0, 0, TILE, 8, FOUNDATION.light);
  for (let y = 10; y < 27; y += 6) {
    lineH(col, row, y, FOUNDATION.dark);
    for (let x = (Math.floor(y / 6) % 2) * 6 + 2; x < TILE; x += 12) {
      lineVRange(col, row, x, y + 1, y + 4, FOUNDATION.dark);
    }
  }
  rect(col, row, 0, 27, TILE, 5, FOUNDATION.shadow);
  copyLeftEdgeToRight(col, row);
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
