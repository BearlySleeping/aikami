// packages/frontend/engine/src/rendering/spritesheet_frames.ts
//
// Frame slicing of a loaded LPC sheet.
//
// A frame is a VIEW over the sheet's existing GPU source: only the UV
// rectangle differs, so slicing allocates no VRAM and needs no cache of its
// own. Kept apart from the texture cache so the cache owns lifetimes and this
// module owns geometry — the two concerns fail in opposite ways (one leaks,
// one throws).

import { Rectangle, Texture } from 'pixi.js';
import type { LpcSpritesheetLayout } from './texture_manager.ts';

/**
 * Validates a spritesheet layout.
 *
 * @throws If frame dimensions are zero, or neither `columns` nor `rows` is
 *   declared (the grid would be unresolvable).
 */
const validateSpritesheetLayout = (
  layout: LpcSpritesheetLayout,
  sheetWidth: number,
  sheetHeight: number,
): void => {
  if (layout.frameWidth <= 0 || layout.frameHeight <= 0) {
    throw new Error(
      `Invalid frame dimensions: ${layout.frameWidth}×${layout.frameHeight}. ` +
        `Sheet is ${sheetWidth}×${sheetHeight}.`,
    );
  }

  if (layout.columns === undefined && layout.rows === undefined) {
    throw new Error(
      'Spritesheet layout must specify at least `columns` or `rows`. ' +
        `Sheet is ${sheetWidth}×${sheetHeight}, frame: ${layout.frameWidth}×${layout.frameHeight}.`,
    );
  }
};

/**
 * Resolves the grid of a sheet, deriving the omitted dimension from the sheet
 * pixels when the layout does not declare it.
 */
const resolveGrid = (
  layout: LpcSpritesheetLayout,
  sheetWidth: number,
  sheetHeight: number,
): { columns: number; rows: number } => ({
  columns: layout.columns ?? Math.floor(sheetWidth / layout.frameWidth),
  rows: layout.rows ?? Math.floor(sheetHeight / layout.frameHeight),
});

/**
 * Returns the frame sub-texture at a row-major index, or `null` when the index
 * is negative, past the grid, or would extend beyond the sheet boundary.
 *
 * @param options - Frame lookup options.
 * @param options.texture - The spritesheet texture.
 * @param options.layout - Grid layout descriptor.
 * @param options.frameIndex - Zero-based frame index (row-major).
 */
export const getSheetFrameAt = (options: {
  texture: Texture;
  layout: LpcSpritesheetLayout;
  frameIndex: number;
}): Texture | null => {
  const { texture, layout, frameIndex } = options;

  if (frameIndex < 0) {
    return null;
  }

  const { frameWidth, frameHeight } = layout;
  const { columns, rows } = resolveGrid(layout, texture.width, texture.height);

  if (frameIndex >= columns * rows) {
    return null;
  }

  const col = frameIndex % columns;
  const row = Math.floor(frameIndex / columns);
  const x = col * frameWidth;
  const y = row * frameHeight;

  // Clamp: a frame that would extend past the texture boundary is not a frame.
  if (x + frameWidth > texture.width || y + frameHeight > texture.height) {
    return null;
  }

  return new Texture({
    source: texture.source,
    frame: new Rectangle(x, y, frameWidth, frameHeight),
  });
};

/**
 * Slices a sheet into its frames in row-major order.
 *
 * Partial rows/columns (when sheet dimensions are not exact multiples of the
 * frame size) are clamped — frames that would extend beyond the sheet boundary
 * are simply not emitted.
 *
 * @throws If the frame dimensions are zero or the layout is invalid.
 */
export const sliceSheetFrames = (options: {
  texture: Texture;
  layout: LpcSpritesheetLayout;
}): Texture[] => {
  const { texture, layout } = options;
  validateSpritesheetLayout(layout, texture.width, texture.height);

  const { columns, rows } = resolveGrid(layout, texture.width, texture.height);
  if (columns <= 0 || rows <= 0) {
    return [];
  }

  const frames: Texture[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const frame = getSheetFrameAt({
        texture,
        layout,
        frameIndex: row * columns + col,
      });
      if (frame) {
        frames.push(frame);
      }
    }
  }
  return frames;
};
