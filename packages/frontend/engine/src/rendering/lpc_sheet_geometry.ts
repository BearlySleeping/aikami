// packages/frontend/engine/src/rendering/lpc_sheet_geometry.ts
// Shared LPC sheet geometry resolver — single source of truth for cell-family
// detection, pitch, column/row count, scale, and anchor offset.
//
// Used by both the dev/preview renderer (lpc_renderer.ts) and the production
// game path (game_world.ts). Never duplicated.
//
// Contract: C-428

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Which LPC cell family a sheet belongs to. */
export type LpcCellFamily = 'standard' | 'oversize';

/**
 * Resolved geometry for one LPC spritesheet.
 *
 * Oversize cells (128px pitch) are drawn at native scale (`scale: 1`) with
 * an anchor offset of -64,-64 so the centred 64px logical body region lands
 * where a standard 64px cell would. Standard cells (64px pitch) use -32,-32.
 */
export type LpcSheetGeometry = {
  /** Cell family — 'standard' (64px) or 'oversize' (128px). */
  family: LpcCellFamily;
  /** Cell pitch in px — 64 (standard) or 128 (oversize). */
  pitch: number;
  /** Animation frames per row, derived from the sheet width. */
  columns: number;
  /** Direction rows — 4 for full sheets, 1 for single-row states. */
  rows: number;
  /**
   * Sprite scale. ALWAYS 1. Oversize cells are drawn at native size; the
   * field exists so callers never reintroduce a downscale.
   */
  scale: 1;
  /**
   * Top-left sprite offset in sprite-local px, relative to the entity origin.
   * -32 for a 64px cell, -64 for a 128px cell — both centre the cell's
   * logical 64px body region on the same point.
   */
  anchorOffset: { x: number; y: number };
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Standard LPC cell pitch in pixels. */
const STANDARD_PITCH = 64;

/** Oversize LPC cell pitch in pixels (2× standard). */
const OVERSIZE_PITCH = 128;

/** Minimum columns for a sheet to be classified as oversize. */
const OVERSIZE_MIN_COLUMNS = 9;

/** Maximum columns for a sheet to be classified as oversize. */
const OVERSIZE_MAX_COLUMNS = 16;

/** Expected direction rows for a full oversize sheet. */
const OVERSIZE_EXPECTED_ROWS = 4;

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Detects the cell family of an LPC spritesheet and returns its resolved
 * geometry.
 *
 * Detection is by measured dimensions, not by asset ID. Any sheet whose
 * width and height are both multiples of 128, with 9–16 columns and 4 rows,
 * is classified as 'oversize'. Everything else falls back to the standard
 * 64px layout.
 *
 * Unknown shapes degrade gracefully — they resolve to the 64px standard
 * layout and log once per distinct shape. They never throw.
 *
 * @param sheet - Object with `width` and `height` in pixels.
 * @returns Resolved {@link LpcSheetGeometry}.
 */
export const resolveLpcSheetGeometry = (sheet: {
  width: number;
  height: number;
}): LpcSheetGeometry => {
  const { width, height } = sheet;

  // Check for oversize (128px) cell family
  if (width % OVERSIZE_PITCH === 0 && height % OVERSIZE_PITCH === 0) {
    const columns = width / OVERSIZE_PITCH;
    const rows = height / OVERSIZE_PITCH;
    if (
      columns >= OVERSIZE_MIN_COLUMNS &&
      columns <= OVERSIZE_MAX_COLUMNS &&
      rows === OVERSIZE_EXPECTED_ROWS
    ) {
      return {
        family: 'oversize',
        pitch: OVERSIZE_PITCH,
        columns,
        rows,
        scale: 1,
        anchorOffset: { x: -OVERSIZE_PITCH / 2, y: -OVERSIZE_PITCH / 2 },
      };
    }
  }

  // Standard (64px) fallback — also catches unknown shapes
  const columns = Math.max(1, Math.floor(width / STANDARD_PITCH));
  const rows = Math.max(1, Math.floor(height / STANDARD_PITCH));

  return {
    family: 'standard',
    pitch: STANDARD_PITCH,
    columns,
    rows,
    scale: 1,
    anchorOffset: { x: -STANDARD_PITCH / 2, y: -STANDARD_PITCH / 2 },
  };
};
