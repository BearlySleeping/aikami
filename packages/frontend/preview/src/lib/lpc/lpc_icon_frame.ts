// packages/frontend/preview/src/lib/lpc/lpc_icon_frame.ts
//
// Pure helpers for rendering a single LPC spritesheet frame as a CSS
// background crop. Mirrors the layout math in lpc_renderer.ts's
// detectLpcSheetLayout without importing pixi.js, so DOM views
// (vendor item icons) can show one recognizable 64px/128px cell.
// Moved from apps/frontend/client/src/lib/data/lpc_icon_frame.ts (C-445).
//
// Standard sheets: 64×64 cells in a 9-col × 4-row grid (576×256).
// Universal sheets: 128×128 cells in a 13-col × 4-row grid (1664×512).

/**
 * Detects the cell pitch of an LPC spritesheet (64 or 128).
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
 */
export const getLpcGrid = (sheet: { width: number; height: number }): LpcGrid => {
  const pitch = getLpcIconCellPitch(sheet);
  return {
    cols: Math.max(1, Math.floor(sheet.width / pitch)),
    rows: Math.max(1, Math.floor(sheet.height / pitch)),
  };
};

/**
 * Computes the CSS `background-size` that scales one LPC cell to fill the icon box.
 */
export const getLpcIconBackgroundSize = (sheet: { width: number; height: number }): string => {
  const grid = getLpcGrid(sheet);
  return `${grid.cols * 100}% ${grid.rows * 100}%`;
};

/** Options for {@link getLpcIconBackgroundPosition}. */
export type LpcIconBackgroundPositionOptions = {
  col: number;
  row: number;
  cols: number;
  rows: number;
};

/**
 * Computes the CSS `background-position` that aligns the hero cell so it fills the icon box.
 * Accepts a named options object instead of positional args.
 */
export const getLpcIconBackgroundPosition = (options: LpcIconBackgroundPositionOptions): string => {
  const { col, row, cols, rows } = options;
  const x = cols <= 1 ? 0 : (col / (cols - 1)) * 100;
  const y = rows <= 1 ? 0 : (row / (rows - 1)) * 100;
  return `${_roundPct(x)}% ${_roundPct(y)}%`;
};

const _roundPct = (value: number): string => {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
};

/** Options for {@link pickHeroCell}. */
export type PickHeroCellOptions = {
  counts: number[][];
  minContent?: number;
};

/**
 * Picks the cell with the most non-transparent pixel content.
 * Accepts a named options object instead of positional args.
 */
export const pickHeroCell = (options: PickHeroCellOptions): { col: number; row: number } | undefined => {
  const { counts, minContent = 10 } = options;
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
