// scripts/src/lib/ops/generate_emberwatch_house_frames.ts
//
// C-550/C-553 — procedural frames for the shared Emberwatch house assembly.
// Every material reuses the same silhouette and facade geometry; only the roof
// palette changes. Packing is deterministic and tile-sized for the existing map
// layer model.

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

/** Roof palette selected by {@link placeHouse}; geometry is material-independent. */
export type HouseRoofMaterial = 'cedar' | 'slate' | 'thatch';

type RoofPlane =
  | 'front'
  | 'back'
  | 'ridge'
  | 'gable-left'
  | 'gable-right'
  | 'eave-overhead'
  | 'eave-edge';
type FacadeVariant = 'wall' | 'window' | 'corner-left' | 'corner-right';
type DoorSection = 'upper' | 'lower';

/** One recipe in the deliberately small shared house-assembly family. */
export type HouseFrameRecipe =
  | { kind: 'roof'; plane: RoofPlane; material: HouseRoofMaterial }
  | { kind: 'facade'; variant: FacadeVariant }
  | { kind: 'door'; open: boolean; section: DoorSection }
  | { kind: 'foundation'; shadow: boolean };

type Rgb = readonly [number, number, number];

type RoofPalette = Readonly<{
  base: Rgb;
  light: Rgb;
  dark: Rgb;
  seam: Rgb;
  ridge: Rgb;
  ridgeShadow: Rgb;
  gable: Rgb;
  hipShadow: Rgb;
  hip: Rgb;
  highlight: Rgb;
}>;

/** Six pixels is the authored upper bound for the visible base course. */
export const HOUSE_PLINTH_HEIGHT = 6;

/** Ten pixels keeps the contact band soft while staying below one tile. */
export const HOUSE_SHADOW_FADE_HEIGHT = 10;

const ROOF_PALETTES = {
  cedar: {
    base: [91, 66, 48],
    light: [174, 132, 82],
    dark: [67, 48, 37],
    seam: [78, 55, 41],
    ridge: [201, 157, 96],
    ridgeShadow: [123, 85, 54],
    gable: [132, 87, 56],
    hipShadow: [82, 55, 40],
    hip: [126, 91, 61],
    highlight: [193, 151, 94],
  },
  slate: {
    base: [72, 82, 89],
    light: [117, 132, 140],
    dark: [40, 49, 56],
    seam: [62, 73, 81],
    ridge: [163, 176, 182],
    ridgeShadow: [84, 98, 107],
    gable: [92, 106, 115],
    hipShadow: [48, 58, 66],
    hip: [108, 123, 132],
    highlight: [190, 201, 205],
  },
  thatch: {
    base: [151, 116, 61],
    light: [199, 165, 91],
    dark: [92, 69, 39],
    seam: [126, 94, 49],
    ridge: [220, 188, 112],
    ridgeShadow: [145, 108, 57],
    gable: [174, 136, 72],
    hipShadow: [104, 77, 42],
    hip: [185, 146, 77],
    highlight: [231, 202, 132],
  },
} satisfies Record<HouseRoofMaterial, RoofPalette>;

const FACADE = {
  base: [126, 82, 48],
  light: [158, 108, 61],
  dark: [82, 51, 35],
  trim: [55, 36, 28],
  eaveShadow: [79, 48, 33],
  window: [75, 116, 127],
  windowLight: [153, 183, 174],
  doorDark: [48, 32, 27],
  door: [108, 67, 38],
  doorLight: [145, 94, 52],
  threshold: [174, 145, 99],
} satisfies Record<string, Rgb>;

const FOUNDATION = {
  stone: [119, 105, 86],
  light: [151, 136, 108],
  dark: [73, 59, 49],
  earth: [79, 64, 50],
  shadow: [48, 43, 37],
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
    buf[target] = buf[source] ?? 0;
    buf[target + 1] = buf[source + 1] ?? 0;
    buf[target + 2] = buf[source + 2] ?? 0;
    buf[target + 3] = buf[source + 3] ?? 0;
  }
};

/** Repeating shingle/thatch courses shared by front and back roof planes. */
const paintRoofPlane = (col: number, row: number, palette: RoofPalette, light: boolean): void => {
  const base = light ? palette.light : palette.base;
  fillCell(col, row, base[0], base[1], base[2]);
  for (let y = 0; y < TILE; y++) {
    const course = Math.floor(y / 4);
    const shade = course % 2 === 0 ? 0 : -10;
    lineH(col, row, y, shiftColor(base, shade));
    if (y % 4 === 0) {
      lineH(col, row, y, light ? palette.highlight : palette.ridgeShadow);
    }
    if (y % 4 === 3) {
      lineH(col, row, y, palette.dark);
    }
  }
  for (let band = 0; band < 8; band++) {
    const joint = ((band * 9 + 3) % 28) + 2;
    lineVRange(col, row, joint, band * 4 + 1, band * 4 + 2, palette.seam);
  }
};

const paintRoofFront = (col: number, row: number, palette: RoofPalette): void => {
  paintRoofPlane(col, row, palette, true);
  lineH(col, row, 1, palette.highlight);
  lineH(col, row, 29, palette.dark);
  lineH(col, row, 30, palette.hipShadow);
  copyLeftEdgeToRight(col, row);
};

const paintRoofBack = (col: number, row: number, palette: RoofPalette): void => {
  paintRoofPlane(col, row, palette, false);
  lineH(col, row, 0, palette.hipShadow);
  lineH(col, row, 29, palette.dark);
  copyLeftEdgeToRight(col, row);
};

const paintRoofRidge = (col: number, row: number, palette: RoofPalette): void => {
  paintRoofPlane(col, row, palette, true);
  rect(col, row, 0, 10, TILE, 4, palette.ridge);
  lineH(col, row, 10, palette.highlight);
  rect(col, row, 0, 14, TILE, 4, palette.ridgeShadow);
  lineH(col, row, 18, palette.hipShadow);
  copyLeftEdgeToRight(col, row);
};

/** Top-edge y for a one-tile hip: outer end starts low, inner edge reaches centre height. */
const gableTop = (x: number, left: boolean): number => {
  const rise = left ? TILE - 1 - x : x;
  return Math.round((rise * 16) / (TILE - 1));
};

/** Fill one monotonic hip wedge; transparent corners create the roof silhouette. */
const paintGable = (col: number, row: number, palette: RoofPalette, left: boolean): void => {
  paintRoofPlane(col, row, palette, false);
  for (let x = 0; x < TILE; x++) {
    const top = gableTop(x, left);
    for (let y = 0; y < top; y++) {
      setPixelRgba(col, row, x, y, palette.base, 0);
    }
    setPixelRgba(col, row, x, top, palette.ridge, 255);
    if (top + 1 < TILE) {
      setPixelRgba(col, row, x, top + 1, palette.hipShadow, 255);
    }
    if (top + 2 < TILE) {
      setPixelRgba(col, row, x, top + 2, palette.gable, 255);
    }
  }
};

const paintEave = (col: number, row: number, palette: RoofPalette, overhead: boolean): void => {
  paintRoofPlane(col, row, palette, !overhead);
  if (overhead) {
    lineH(col, row, 0, palette.ridge);
    rect(col, row, 0, 26, TILE, 6, palette.hipShadow);
  } else {
    lineH(col, row, 0, palette.highlight);
    rect(col, row, 0, 25, TILE, 5, palette.ridgeShadow);
    lineH(col, row, 30, palette.hipShadow);
  }
  copyLeftEdgeToRight(col, row);
};

/** A short, warm shadow at the top of the upper facade row reads as eave shade. */
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
  rect(col, row, 10, 9, 12, 14, FACADE.trim);
  rect(col, row, 12, 11, 8, 10, FACADE.window);
  rect(col, row, 13, 12, 3, 4, FACADE.windowLight);
  lineVRange(col, row, 15, 11, 20, FACADE.trim);
  lineH(col, row, 15, FACADE.trim);
};

/** Corner role keeps its stable GID while sharing the facade's clean wall pixels. */
const paintFacadeCorner = (col: number, row: number): void => {
  paintUpperFacade(col, row);
};

/** Door top edge in the upper tile; its lower edge is the shared facade seam. */
const paintDoorUpper = (col: number, row: number, open: boolean): void => {
  paintUpperFacade(col, row);
  rect(col, row, 3, 8, 26, 24, FACADE.trim);
  if (open) {
    rect(col, row, 5, 10, 22, 22, FACADE.doorDark);
    rect(col, row, 6, 11, 9, 21, [42, 36, 31]);
    rect(col, row, 17, 11, 9, 21, [58, 45, 37]);
  } else {
    rect(col, row, 5, 10, 22, 22, FACADE.door);
    for (let y = 12; y < 32; y += 6) {
      lineH(col, row, y, FACADE.doorLight);
    }
    for (let x = 7; x < 27; x += 5) {
      lineVRange(col, row, x, 11, 31, FACADE.trim);
    }
  }
};

/** Door lower tile completes a 50px leaf and terminates on a stone threshold. */
const paintDoorLower = (col: number, row: number, open: boolean): void => {
  paintLowerFacade(col, row);
  rect(col, row, 3, 0, 26, 28, FACADE.trim);
  if (open) {
    rect(col, row, 5, 0, 22, 28, FACADE.doorDark);
    rect(col, row, 6, 0, 9, 28, [42, 36, 31]);
    rect(col, row, 17, 0, 9, 28, [58, 45, 37]);
  } else {
    rect(col, row, 5, 0, 22, 28, FACADE.door);
    for (let y = 1; y < 28; y += 6) {
      lineH(col, row, y, FACADE.doorLight);
    }
    for (let x = 7; x < 27; x += 5) {
      lineVRange(col, row, x, 0, 27, FACADE.trim);
    }
  }
  rect(col, row, 5, 28, 22, 4, FACADE.threshold);
  lineH(col, row, 31, FACADE.trim);
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

const ROOF_PAINTERS: Readonly<
  Record<RoofPlane, (col: number, row: number, palette: RoofPalette) => void>
> = {
  front: paintRoofFront,
  back: paintRoofBack,
  ridge: paintRoofRidge,
  'gable-left': (col, row, palette) => paintGable(col, row, palette, true),
  'gable-right': (col, row, palette) => paintGable(col, row, palette, false),
  'eave-overhead': (col, row, palette) => paintEave(col, row, palette, true),
  'eave-edge': (col, row, palette) => paintEave(col, row, palette, false),
};

const FACADE_PAINTERS: Readonly<Record<FacadeVariant, (col: number, row: number) => void>> = {
  wall: paintFacadeWall,
  window: paintFacadeWindow,
  'corner-left': (col, row) => paintFacadeCorner(col, row),
  'corner-right': (col, row) => paintFacadeCorner(col, row),
};

const roofPlaneSuffixes = {
  front: 'front',
  back: 'back',
  ridge: 'ridge',
  'gable-left': 'gable_left',
  'gable-right': 'gable_right',
  'eave-overhead': 'eave_overhead',
  'eave-edge': 'eave_edge',
} as const satisfies Record<RoofPlane, string>;

const roofFramePaint = Object.fromEntries(
  (Object.keys(ROOF_PALETTES) as HouseRoofMaterial[]).flatMap((material) =>
    (Object.entries(roofPlaneSuffixes) as Array<[RoofPlane, string]>).map(
      ([plane, suffix]): [string, HouseFrameRecipe] => [
        material === 'cedar' ? `house_roof_${suffix}.png` : `house_roof_${material}_${suffix}.png`,
        { kind: 'roof', plane, material },
      ],
    ),
  ),
);

const DOOR_PAINTERS: Readonly<
  Record<DoorSection, (col: number, row: number, open: boolean) => void>
> = {
  upper: paintDoorUpper,
  lower: paintDoorLower,
};

/** Frame name → recipe. Keys mirror the append-only manifest entries. */
export const HOUSE_FRAME_PAINT: Readonly<Record<string, HouseFrameRecipe>> = {
  ...roofFramePaint,
  'house_facade_wall.png': { kind: 'facade', variant: 'wall' },
  'house_facade_window.png': { kind: 'facade', variant: 'window' },
  'house_facade_corner_left.png': { kind: 'facade', variant: 'corner-left' },
  'house_facade_corner_right.png': { kind: 'facade', variant: 'corner-right' },
  'house_door_upper_closed.png': { kind: 'door', open: false, section: 'upper' },
  'house_door_upper_open.png': { kind: 'door', open: true, section: 'upper' },
  'house_door_closed.png': { kind: 'door', open: false, section: 'lower' },
  'house_door_open.png': { kind: 'door', open: true, section: 'lower' },
  'house_foundation.png': { kind: 'foundation', shadow: false },
  'house_foundation_shadow.png': { kind: 'foundation', shadow: true },
};

/** Writes one recipe into an atlas cell; exported for the packer's dispatch. */
export const paintHouseFrame = (options: {
  col: number;
  row: number;
  recipe: HouseFrameRecipe;
}): void => {
  const { col, row, recipe } = options;
  if (recipe.kind === 'roof') {
    ROOF_PAINTERS[recipe.plane](col, row, ROOF_PALETTES[recipe.material]);
    return;
  }
  if (recipe.kind === 'facade') {
    FACADE_PAINTERS[recipe.variant](col, row);
    return;
  }
  if (recipe.kind === 'door') {
    DOOR_PAINTERS[recipe.section](col, row, recipe.open);
    return;
  }
  paintFoundation(col, row, recipe.shadow);
};

/** Paint a named house frame when it belongs to the shared C-550/C-553 kit. */
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
