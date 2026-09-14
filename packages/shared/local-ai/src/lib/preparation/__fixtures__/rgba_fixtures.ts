// packages/shared/local-ai/src/lib/preparation/__fixtures__/rgba_fixtures.ts
//
// C-520: synthetic RGBA surfaces for the preparation tests.
//
// These are real pixel buffers, not byte arrays relabelled as images: a
// "full-alpha ground render" is an image whose opaque mask genuinely spans its
// bottom rows, and a "fringe" is a real partial-alpha silhouette. A fixture
// that lied about its shape would make the QA checks untestable.
//
// Test-only: nothing in `src/` may import this module at runtime.

import { alphaAt, createRgbaImage, type RgbaImage, setPixel } from '../rgba_image.ts';

/** A straight-alpha colour. */
export type Rgba = { r: number; g: number; b: number; a: number };

export const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };
export const OPAQUE_BLACK: Rgba = { r: 0, g: 0, b: 0, a: 255 };
export const OPAQUE_DARK: Rgba = { r: 20, g: 24, b: 30, a: 255 };
export const OPAQUE_GREEN: Rgba = { r: 30, g: 200, b: 40, a: 255 };
export const OPAQUE_LIGHT: Rgba = { r: 220, g: 220, b: 210, a: 255 };

/** A fully transparent surface of the given size. */
export const blankImage = (width: number, height: number): RgbaImage =>
  createRgbaImage({ width, height });

/** Fills a rectangle. Coordinates are clipped to the image. */
export const paintRect = (
  image: RgbaImage,
  rect: { x: number; y: number; width: number; height: number },
  colour: Rgba,
): void => {
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      setPixel(image, x, y, colour);
    }
  }
};

/** Fills the whole surface. */
export const paintAll = (image: RgbaImage, colour: Rgba): void => {
  paintRect(image, { x: 0, y: 0, width: image.width, height: image.height }, colour);
};

/**
 * A prop on a full-alpha dark ground: the background and the bottom band are
 * opaque and near-black, the prop is a bright block. This is the shape an
 * un-extracted diffusion render has.
 */
export const fullAlphaGroundProp = (options?: {
  width?: number;
  height?: number;
  groundRows?: number;
}): RgbaImage => {
  const width = options?.width ?? 64;
  const height = options?.height ?? 64;
  const groundRows = options?.groundRows ?? 6;
  const image = blankImage(width, height);
  paintAll(image, OPAQUE_BLACK);
  paintRect(image, { x: 20, y: 12, width: 24, height: height - groundRows - 12 }, OPAQUE_LIGHT);
  return image;
};

/**
 * A clean isolated prop: transparent around a single bright block whose
 * bottom rows are full width of the block, so its ground contact is centred.
 */
export const isolatedProp = (options?: {
  width?: number;
  height?: number;
  propWidth?: number;
  propHeight?: number;
}): RgbaImage => {
  const width = options?.width ?? 64;
  const height = options?.height ?? 64;
  const propWidth = options?.propWidth ?? 24;
  const propHeight = options?.propHeight ?? 40;
  const image = blankImage(width, height);
  const x = Math.floor((width - propWidth) / 2);
  const y = height - propHeight - 4;
  paintRect(image, { x, y, width: propWidth, height: propHeight }, OPAQUE_LIGHT);
  return image;
};

/** An opaque rectangle covering the whole canvas — the ground-plane defect. */
export const groundRectangle = (width = 64, height = 64): RgbaImage => {
  const image = blankImage(width, height);
  paintAll(image, OPAQUE_DARK);
  return image;
};

/** A prop whose lowest pixels sit far from the content centre. */
export const offCentreContactProp = (width = 64, height = 64): RgbaImage => {
  const image = blankImage(width, height);
  // Main body sits centre-right; a thin leg drops on the far left.
  paintRect(image, { x: 30, y: 8, width: 24, height: 44 }, OPAQUE_LIGHT);
  paintRect(image, { x: 4, y: 52, width: 4, height: 8 }, OPAQUE_LIGHT);
  return image;
};

/** An opaque block touching the canvas edge — a clipped sprite. */
export const clippedProp = (width = 64, height = 64): RgbaImage => {
  const image = blankImage(width, height);
  paintRect(image, { x: 0, y: 8, width: 40, height: 40 }, OPAQUE_LIGHT);
  return image;
};

/** A silhouette whose edge is entirely partial alpha — the checkerboard signature. */
export const fringedProp = (width = 64, height = 64): RgbaImage => {
  const image = blankImage(width, height);
  paintRect(image, { x: 16, y: 8, width: 32, height: 40 }, OPAQUE_LIGHT);
  const halo: Rgba = { r: 200, g: 200, b: 200, a: 120 };
  for (let y = 7; y <= 48; y++) {
    setPixel(image, 15, y, halo);
    setPixel(image, 48, y, halo);
  }
  for (let x = 15; x <= 48; x++) {
    setPixel(image, x, 7, halo);
    setPixel(image, x, 48, halo);
  }
  return image;
};

/** An image whose longest opaque run is one pixel — unreadable at native 1x. */
export const hairlineProp = (width = 64, height = 64): RgbaImage => {
  const image = blankImage(width, height);
  for (let y = 8; y < 48; y += 2) {
    setPixel(image, 32, y, OPAQUE_LIGHT);
  }
  return image;
};

/**
 * A structurally valid LPC sheet: 13 columns x 21 rows of 64px cells, with a
 * body drawn in every populated cell.
 *
 * `mutate` receives the cell coordinates so a test can inject one specific
 * defect (an empty frame, a duplicate, a drift) without rebuilding the layout.
 */
export const lpcSheet = (options?: {
  width?: number;
  height?: number;
  mutate?: (context: {
    image: RgbaImage;
    state: number;
    direction: number;
    frame: number;
    pitch: number;
    originX: number;
    originY: number;
  }) => void;
}): RgbaImage => {
  const pitch = 64;
  const width = options?.width ?? 13 * pitch;
  const height = options?.height ?? 21 * pitch;
  const image = blankImage(width, height);
  const columns = Math.floor(width / pitch);
  const rows = Math.floor(height / pitch);

  for (let row = 0; row < rows; row++) {
    for (let frame = 0; frame < columns; frame++) {
      const originX = frame * pitch;
      const originY = row * pitch;
      // A 20x30 body, feet on cell row 52; a 1px vertical bob so the ground line
      // moves by at most 1px, which is inside the review tolerance.
      const bob = frame % 2;
      paintRect(
        image,
        { x: originX + 22 + bob, y: originY + 20, width: 20, height: 32 - bob },
        OPAQUE_LIGHT,
      );
      // A frame-dependent mark *inside* the body: it changes the bytes without
      // changing the footprint, so no two frames of a row fingerprint alike.
      paintRect(
        image,
        { x: originX + 24, y: originY + 24 + frame, width: 3, height: 1 },
        { r: 100 + frame * 5, g: 90, b: 80, a: 255 },
      );
      options?.mutate?.({
        image,
        state: Math.floor(row / 4) * 4,
        direction: row % 4,
        frame,
        pitch,
        originX,
        originY,
      });
    }
  }
  return image;
};

/** Counts opaque pixels — handy for asserting a mutation actually did something. */
export const opaquePixelCount = (image: RgbaImage, alphaFloor = 1): number => {
  let count = 0;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (alphaAt(image, x, y) >= alphaFloor) {
        count += 1;
      }
    }
  }
  return count;
};
