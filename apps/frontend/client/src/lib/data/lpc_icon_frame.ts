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
//
// The component that consumes these helpers samples the loaded sheet on an
// offscreen canvas, counts non-transparent pixels per cell, and picks the
// cell with the most content (hero-frame selection) — cell (0,0) is blank
// on many LPC sheets (e.g. dagger/longsword/saber walk sheets), so frame 0
// is never assumed to be visible.

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

/** Cell-grid dimensions of an LPC spritesheet (cols × rows). */
export type LpcGrid = {
  cols: number;
  rows: number;
};

/**
 * Computes the cell grid of an LPC spritesheet.
 *
 * @param sheet - Sheet pixel dimensions from the loaded image.
 * @returns The grid dimensions, with a minimum of 1×1.
 */
export const getLpcGrid = (sheet: { width: number; height: number }): LpcGrid => {
  const pitch = getLpcIconCellPitch(sheet);
  return {
    cols: Math.max(1, Math.floor(sheet.width / pitch)),
    rows: Math.max(1, Math.floor(sheet.height / pitch)),
  };
};

/**
 * Computes the CSS `background-size` that scales one LPC cell to fill the
 * icon box. Combined with the hero-cell background-position, the selected
 * cell fills the element.
 *
 * Example (standard sheet): 576×256 with 64px pitch → "900% 400%".
 * Example (universal sheet): 1664×512 with 128px pitch → "1300% 400%".
 *
 * @param sheet - Sheet pixel dimensions from the loaded image.
 * @returns The background-size value.
 */
export const getLpcIconBackgroundSize = (sheet: { width: number; height: number }): string => {
  const grid = getLpcGrid(sheet);
  return `${grid.cols * 100}% ${grid.rows * 100}%`;
};

/**
 * Computes the CSS `background-position` that aligns the hero cell (col,
 * row) so it fills the icon box.
 *
 * With background-size `{cols*100}% {rows*100}%`, the sheet renders at
 * cols× the box width. The standard percentage formula for grid alignment
 * is `col/(cols-1)*100%` horizontally and `row/(rows-1)*100%` vertically
 * (the percentage offsets the image by that fraction of the slack between
 * image and box).
 *
 * @param col - Hero cell column (0-based).
 * @param row - Hero cell row (0-based).
 * @param cols - Grid column count.
 * @param rows - Grid row count.
 * @returns The background-position value.
 */
export const getLpcIconBackgroundPosition = (
  col: number,
  row: number,
  cols: number,
  rows: number,
): string => {
  // Guards mirror getLpcIconBackgroundSize's Math.max(1, ...): a 1-wide or
  // 1-tall grid has no slack, so the position is always the origin.
  if (cols <= 1 || rows <= 1) {
    return '0 0';
  }
  const x = (col / (cols - 1)) * 100;
  const y = (row / (rows - 1)) * 100;
  return `${_roundPct(x)}% ${_roundPct(y)}%`;
};

/** Rounds a percentage to 2 decimals for stable CSS output. */
const _roundPct = (value: number): string => {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
};

/**
 * Picks the cell with the most non-transparent pixel content.
 *
 * @param counts - Per-cell opaque-pixel counts, indexed [row][col].
 * @param minContent - Minimum opaque pixels for a cell to be usable
 *   (blank cells below this threshold are rejected). Default 10.
 * @returns The hero cell {col,row}, or undefined when every cell is blank
 *   or below the content threshold.
 */
export const pickHeroCell = (
  counts: number[][],
  minContent = 10,
): { col: number; row: number } | undefined => {
  let best: { col: number; row: number } | undefined;
  let bestCount = 0;

  for (let row = 0; row < counts.length; row++) {
    const rowCounts = counts[row] ?? [];
    for (let col = 0; col < rowCounts.length; col++) {
      const count = rowCounts[col] ?? 0;
      if (count > bestCount) {
        bestCount = count;
        best = { col, row };
      }
    }
  }

  return best !== undefined && bestCount >= minContent ? best : undefined;
};
