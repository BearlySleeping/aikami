// apps/frontend/client/src/lib/data/lpc_icon_frame.ts
//
// Pure helpers for rendering a single LPC spritesheet frame as a CSS
// background crop (C-419 AC-4). Mirrors the layout math in
// lpc_renderer.ts's detectLpcSheetLayout without importing pixi.js, so
// DOM views (vendor item icons) can show one recognizable 64px/128px cell
// instead of the whole multi-frame walk sheet squished into a 40×40 box.
//
// Standard sheets: 64×64 cells in a 9-col × 4-row grid (576×256).
// Universal sheets: 128×128 cells in a 13-col × 4-row grid (1664×512).

/**
 * Detects the cell pitch of an LPC spritesheet (64 or 128).
 *
 * Same classification as detectLpcSheetLayout: a sheet whose width/height
 * are both multiples of 128 with 9-16 columns and exactly 4 rows is a
 * universal 128px sheet; everything else falls back to the standard 64px
 * grid (including single-row state sheets like hurt).
 *
 * @param sheet - Sheet pixel dimensions from the loaded image.
 * @returns The cell pitch in pixels.
 */
export const getLpcIconCellPitch = (sheet: { width: number; height: number }): 64 | 128 => {
  if (sheet.width % 128 === 0 && sheet.height % 128 === 0) {
    const columns = sheet.width / 128;
    const rows = sheet.height / 128;
    if (columns >= 9 && columns <= 16 && rows === 4) {
      return 128;
    }
  }
  return 64;
};

/**
 * Computes the CSS `background-size` that scales one LPC cell to fill the
 * icon box. With `background-position: 0 0` the top-left cell (frame 0 of
 * the first direction row) fills the element.
 *
 * Example (standard sheet): 576×256 with 64px pitch → "900% 400%".
 * Example (universal sheet): 1664×512 with 128px pitch → "1300% 400%".
 *
 * @param sheet - Sheet pixel dimensions from the loaded image.
 * @returns The background-size value.
 */
export const getLpcIconBackgroundSize = (sheet: { width: number; height: number }): string => {
  const pitch = getLpcIconCellPitch(sheet);
  const columns = Math.max(1, Math.floor(sheet.width / pitch));
  const rows = Math.max(1, Math.floor(sheet.height / pitch));
  return `${columns * 100}% ${rows * 100}%`;
};
