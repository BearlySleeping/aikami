// scripts/src/lib/ops/generate_emberwatch_bridge_frames.ts
//
// C-546 — procedural bridge-assembly frames for the Emberwatch atlas.
//
// Extracted from `generate_emberwatch_atlas.ts` to keep that module inside its
// source-size ratchet. A crossing is ONE authored structure: each cell of the
// span picks a frame by its position (deck interior / long side / travel end /
// corner) and the span's travel axis. Boards run PERPENDICULAR to travel; rails
// hug only the two long outer edges; the two short ends meet a bank abutment.
// No frame paints water inside the walkable deck.

import { fillCell, fillRect, hline, TILE, vline } from './generate_emberwatch_canvas.ts';

/** Which outer edge a rail or bank abutment hugs. */
export type BridgeEdge = 'n' | 'e' | 's' | 'w';

/** Deck-board run direction — perpendicular to the crossing's travel axis. */
export type BridgeBoards = 'h' | 'v';

/** The per-frame paint recipe (everything except the target cell). */
export type BridgeFramePaint = {
  boards: BridgeBoards;
  rail?: BridgeEdge;
  abutment?: BridgeEdge;
};

/**
 * Deck palette. Every deck cell is painted from the same fixed pattern (no
 * per-cell RNG), so the deck is byte-identical cell to cell and tiles
 * seamlessly along both axes.
 */
const DECK = {
  base: [148, 100, 58] as const,
  dark: [104, 64, 36] as const,
  light: [178, 126, 80] as const,
  rail: [140, 92, 56] as const,
  railLight: [172, 120, 76] as const,
  railDark: [96, 58, 32] as const,
  shadow: [56, 38, 24] as const,
  waterShadow: [30, 55, 80] as const,
  sill: [143, 143, 146] as const,
  sillLight: [168, 168, 172] as const,
  sillDark: [110, 110, 114] as const,
} as const;

const paintHline = (
  col: number,
  row: number,
  x0: number,
  x1: number,
  y: number,
  color: readonly [number, number, number],
): void => hline(col, row, x0, x1, y, color[0], color[1], color[2]);

const paintVline = (
  col: number,
  row: number,
  x: number,
  y0: number,
  y1: number,
  color: readonly [number, number, number],
): void => vline(col, row, x, y0, y1, color[0], color[1], color[2]);

const paintRect = (
  col: number,
  row: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  color: readonly [number, number, number],
): void => fillRect(col, row, x0, y0, w, h, color[0], color[1], color[2]);

/**
 * Paints horizontal boards (north–south travel). The pattern is a pure
 * function of the tile-local pixel, so adjacent deck cells meet seamlessly.
 */
const paintHorizontalBoards = (col: number, row: number): void => {
  fillCell(col, row, DECK.base[0], DECK.base[1], DECK.base[2]);
  const board = 4;
  for (let y = 0; y < TILE; y++) {
    const shade = Math.floor(y / board) % 2 === 0 ? 0 : -12;
    paintHline(col, row, 0, TILE - 1, y, [
      DECK.base[0] + shade,
      DECK.base[1] + shade,
      DECK.base[2] + shade,
    ]);
    if (y % board === 0) {
      paintHline(col, row, 0, TILE - 1, y, DECK.light);
    } else if (y % board === board - 1) {
      paintHline(col, row, 0, TILE - 1, y, DECK.dark);
    }
  }
  // Staggered end-joints inside each board (deterministic, cell-independent).
  for (let band = 0; band < TILE / board; band++) {
    const joint = ((band * 11 + 5) % (TILE - board)) + 1;
    paintVline(col, row, joint, band * board + 1, band * board + board - 2, DECK.dark);
  }
};

/** Paints vertical boards (east–west travel). */
const paintVerticalBoards = (col: number, row: number): void => {
  fillCell(col, row, DECK.base[0], DECK.base[1], DECK.base[2]);
  const board = 4;
  for (let x = 0; x < TILE; x++) {
    const shade = Math.floor(x / board) % 2 === 0 ? 0 : -12;
    paintVline(col, row, x, 0, TILE - 1, [
      DECK.base[0] + shade,
      DECK.base[1] + shade,
      DECK.base[2] + shade,
    ]);
    if (x % board === 0) {
      paintVline(col, row, x, 0, TILE - 1, DECK.light);
    } else if (x % board === board - 1) {
      paintVline(col, row, x, 0, TILE - 1, DECK.dark);
    }
  }
  for (let band = 0; band < TILE / board; band++) {
    const joint = ((band * 13 + 6) % (TILE - board)) + 1;
    paintHline(col, row, band * board + 1, band * board + board - 2, joint, DECK.dark);
  }
};

/**
 * Paints an opaque deck of planks, boards perpendicular to travel (`h` for a
 * north–south crossing, `v` for east–west).
 */
const paintBoards = (col: number, row: number, boards: BridgeBoards): void => {
  if (boards === 'h') {
    paintHorizontalBoards(col, row);
    return;
  }
  paintVerticalBoards(col, row);
};

/**
 * Paints ONE rail hugging a long outer edge: a 2px water/shadow strip outside
 * the rail, a 5px rail body, and a 1px contact shadow on the deck side.
 */
const paintRail = (col: number, row: number, edge: BridgeEdge): void => {
  const strip = 2;
  const body = 5;
  if (edge === 'w') {
    paintRect(col, row, 0, 0, strip, TILE, DECK.waterShadow);
    paintRect(col, row, strip, 0, body, TILE, DECK.rail);
    paintVline(col, row, strip, 0, TILE - 1, DECK.railLight);
    paintVline(col, row, strip + body - 1, 0, TILE - 1, DECK.railDark);
    paintVline(col, row, strip + body, 0, TILE - 1, DECK.shadow);
    return;
  }
  if (edge === 'e') {
    paintRect(col, row, TILE - strip, 0, strip, TILE, DECK.waterShadow);
    paintRect(col, row, TILE - strip - body, 0, body, TILE, DECK.rail);
    paintVline(col, row, TILE - strip - body, 0, TILE - 1, DECK.railLight);
    paintVline(col, row, TILE - strip - 1, 0, TILE - 1, DECK.railDark);
    paintVline(col, row, TILE - strip - body - 1, 0, TILE - 1, DECK.shadow);
    return;
  }
  if (edge === 'n') {
    paintRect(col, row, 0, 0, TILE, strip, DECK.waterShadow);
    paintRect(col, row, 0, strip, TILE, body, DECK.rail);
    paintHline(col, row, 0, TILE - 1, strip, DECK.railLight);
    paintHline(col, row, 0, TILE - 1, strip + body - 1, DECK.railDark);
    paintHline(col, row, 0, TILE - 1, strip + body, DECK.shadow);
    return;
  }
  paintRect(col, row, 0, TILE - strip, TILE, strip, DECK.waterShadow);
  paintRect(col, row, 0, TILE - strip - body, TILE, body, DECK.rail);
  paintHline(col, row, 0, TILE - 1, TILE - strip - body, DECK.railLight);
  paintHline(col, row, 0, TILE - 1, TILE - strip - 1, DECK.railDark);
  paintHline(col, row, 0, TILE - 1, TILE - strip - body - 1, DECK.shadow);
};

/**
 * Paints a short stone sill on the outer travel edge plus its contact shadow,
 * so the deck meets the bank instead of floating over the water.
 */
const paintAbutment = (col: number, row: number, edge: BridgeEdge): void => {
  const sill = 4;
  const contact = 2;
  if (edge === 'n') {
    paintRect(col, row, 0, 0, TILE, sill, DECK.sill);
    paintHline(col, row, 0, TILE - 1, 0, DECK.sillLight);
    paintHline(col, row, 0, TILE - 1, sill - 1, DECK.sillDark);
    paintRect(col, row, 0, sill, TILE, contact, DECK.shadow);
    return;
  }
  if (edge === 's') {
    paintRect(col, row, 0, TILE - sill, TILE, sill, DECK.sill);
    paintHline(col, row, 0, TILE - 1, TILE - sill, DECK.sillLight);
    paintHline(col, row, 0, TILE - 1, TILE - 1, DECK.sillDark);
    paintRect(col, row, 0, TILE - sill - contact, TILE, contact, DECK.shadow);
    return;
  }
  if (edge === 'w') {
    paintRect(col, row, 0, 0, sill, TILE, DECK.sill);
    paintVline(col, row, 0, 0, TILE - 1, DECK.sillLight);
    paintVline(col, row, sill - 1, 0, TILE - 1, DECK.sillDark);
    paintRect(col, row, sill, 0, contact, TILE, DECK.shadow);
    return;
  }
  paintRect(col, row, TILE - sill, 0, sill, TILE, DECK.sill);
  paintVline(col, row, TILE - sill, 0, TILE - 1, DECK.sillLight);
  paintVline(col, row, TILE - 1, 0, TILE - 1, DECK.sillDark);
  paintRect(col, row, TILE - sill - contact, 0, contact, TILE, DECK.shadow);
};

/** Paints one bridge frame into the atlas scratch at (col, row). */
export const paintBridgeFrame = (options: {
  col: number;
  row: number;
  boards: BridgeBoards;
  rail?: BridgeEdge;
  abutment?: BridgeEdge;
}): void => {
  const { col, row, boards } = options;
  paintBoards(col, row, boards);
  if (options.abutment) {
    paintAbutment(col, row, options.abutment);
  }
  if (options.rail) {
    paintRail(col, row, options.rail);
  }
};

/**
 * Frame name → paint recipe. `bridge.png` (GID 42) is the north–south deck
 * interior, preserved for compatibility; the rest are appended frames.
 */
export const BRIDGE_FRAME_PAINT: Record<string, BridgeFramePaint> = {
  'bridge.png': { boards: 'h' },
  'bridge_deck_ew.png': { boards: 'v' },
  'bridge_rail_w.png': { boards: 'h', rail: 'w' },
  'bridge_rail_e.png': { boards: 'h', rail: 'e' },
  'bridge_rail_n.png': { boards: 'v', rail: 'n' },
  'bridge_rail_s.png': { boards: 'v', rail: 's' },
  'bridge_end_n.png': { boards: 'h', abutment: 'n' },
  'bridge_end_s.png': { boards: 'h', abutment: 's' },
  'bridge_end_w.png': { boards: 'v', abutment: 'w' },
  'bridge_end_e.png': { boards: 'v', abutment: 'e' },
  'bridge_corner_nw_ns.png': { boards: 'h', rail: 'w', abutment: 'n' },
  'bridge_corner_ne_ns.png': { boards: 'h', rail: 'e', abutment: 'n' },
  'bridge_corner_sw_ns.png': { boards: 'h', rail: 'w', abutment: 's' },
  'bridge_corner_se_ns.png': { boards: 'h', rail: 'e', abutment: 's' },
  'bridge_corner_nw_ew.png': { boards: 'v', rail: 'n', abutment: 'w' },
  'bridge_corner_ne_ew.png': { boards: 'v', rail: 'n', abutment: 'e' },
  'bridge_corner_sw_ew.png': { boards: 'v', rail: 's', abutment: 'w' },
  'bridge_corner_se_ew.png': { boards: 'v', rail: 's', abutment: 'e' },
};
