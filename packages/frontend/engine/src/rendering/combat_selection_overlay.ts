// packages/frontend/engine/src/rendering/combat_selection_overlay.ts
//
// C-525 R-2 — the tactical battlefield must show the direct-control
// selection: reachable move cells and legal target cells. This module is the
// PURE projection from the ViewModel's `combatSelection.legalEndpoints` /
// `legalTargetCells` to a per-cell colour palette, mirroring the
// `walkability_overlay.ts` pattern (style projection only — no Pixi imports,
// no ticker, no engine coupling) so it is directly unit-testable and reusable
// by any renderer.
//
// A target cell always wins over a reachable cell when the two overlap: the
// engine declared that combatant targetable, which is the more important fact.

import type { GridPoint } from '@aikami/types';

/** A single highlight cell's fill + stroke colour (0xRRGGBB). */
export type CombatHighlightCellStyle = {
  /** Fill colour drawn inside the cell. */
  fill: number;
  /** Stroke colour drawn on the cell border. */
  stroke: number;
  /** 0..1 fill opacity — keeps the underlying art readable while overlaid. */
  alpha: number;
};

/** What a highlighted cell represents. */
export type CombatHighlightKind = 'reachable' | 'target';

/** A resolved highlight cell. */
export type CombatHighlightCell = GridPoint & { kind: CombatHighlightKind };

/** Style for a reachable move endpoint. */
const REACHABLE = { fill: 0x3f8cff, stroke: 0x1b4f9e, alpha: 0.35 } as const;

/** Style for an engine-declared legal target. */
const TARGET = { fill: 0xffb020, stroke: 0x8a5a00, alpha: 0.45 } as const;

/**
 * Resolves the overlay style for one highlight kind.
 *
 * @param kind - Whether the cell is a reachable endpoint or a legal target.
 * @returns The fill/stroke/alpha style for that kind.
 */
export const combatHighlightCellStyle = (kind: CombatHighlightKind): CombatHighlightCellStyle =>
  kind === 'target' ? TARGET : REACHABLE;

/**
 * Builds the deduplicated highlight cells for a selection.
 *
 * Endpoints and target cells are merged by cell key; a target cell overrides a
 * reachable cell at the same coordinate. Output is sorted by `y` then `x` so
 * the draw order (and any test assertion) is deterministic.
 *
 * @param options - The selection's reachable endpoints and legal target cells.
 * @returns The cells to draw, target-kind winning on overlap.
 */
export const buildCombatHighlightCells = (options: {
  legalEndpoints: readonly GridPoint[];
  legalTargetCells: readonly GridPoint[];
}): CombatHighlightCell[] => {
  const byKey = new Map<string, CombatHighlightCell>();
  for (const cell of options.legalEndpoints) {
    byKey.set(`${cell.x},${cell.y}`, { x: cell.x, y: cell.y, kind: 'reachable' });
  }
  for (const cell of options.legalTargetCells) {
    byKey.set(`${cell.x},${cell.y}`, { x: cell.x, y: cell.y, kind: 'target' });
  }
  return [...byKey.values()].sort((a, b) => a.y - b.y || a.x - b.x);
};

/** Whether a selection has anything to highlight. */
export const hasCombatHighlights = (options: {
  legalEndpoints: readonly GridPoint[];
  legalTargetCells: readonly GridPoint[];
}): boolean => options.legalEndpoints.length > 0 || options.legalTargetCells.length > 0;
