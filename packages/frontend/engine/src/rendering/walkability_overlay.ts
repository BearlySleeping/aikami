// packages/frontend/engine/src/rendering/walkability_overlay.ts
//
// C-506 AC-4 — the diagnostic walkability overlay must display the SAME
// movement authority used by pathfinding, not a separately inferred map or a
// raw decor layer. The authoritative source is the TerrainGrid built by
// `buildTerrainGridForMap` (cost + blocksSight), which movement_system and
// goap_movement_executor both read. This module turns that grid into a
// per-cell colour palette for the debug overlay, so what the player sees with
// overlays ON is exactly what the engine walks on with overlays OFF.
//
// Pure and deterministic — no Pixi imports, no ticker, no engine coupling —
// so it can be unit-tested directly and reused by any renderer.

import { TERRAIN_COST_WALKABLE, type TerrainGrid } from '../systems/terrain_grid.ts';

/**
 * A single overlay cell's fill + stroke colour (0xRRGGBB), derived from the
 * authoritative terrain cost.
 */
export type WalkabilityCellStyle = {
  /** Fill colour — blocked cells render as a distinct "no entry" colour. */
  fill: number;
  /** Stroke colour drawn on the cell border to keep adjacent cells distinct. */
  stroke: number;
  /** 0..1 fill opacity — keeps the underlying art readable while overlaid. */
  alpha: number;
};

/** Style for a blocked (impassable) cell — cost 0. */
const BLOCKED: WalkabilityCellStyle = { fill: 0xd43f3f, stroke: 0x7a1f1f, alpha: 0.45 };

/** Style for a walkable cell — cost > 0. */
const WALKABLE: WalkabilityCellStyle = { fill: 0x3fd46a, stroke: 0x1f7a3a, alpha: 0.35 };

/**
 * Resolves the overlay style for a single cell from its authoritative cost.
 *
 * Cost semantics come from the TerrainGrid contract: 0 = impassable, else
 * movement cost × 16. This is the exact value pathfinding consults, so a
 * cell shown as walkable here IS walkable to the movement systems.
 *
 * @param cost - The cell's terrain cost (0 = blocked).
 * @returns The overlay style for that cell.
 */
export const walkabilityCellStyle = (cost: number): WalkabilityCellStyle =>
  cost > 0 ? WALKABLE : BLOCKED;

/**
 * Builds the per-cell walkability styles for an entire grid, row-major.
 *
 * The returned array length always equals `grid.width * grid.height`, so a
 * renderer can index it 1:1 with the map's tile cells. The source of truth
 * is `grid.cost` — never a separately inferred boolean grid.
 *
 * @param grid - The authoritative TerrainGrid.
 * @returns Row-major array of cell styles.
 */
export const buildWalkabilityStyles = (grid: TerrainGrid): WalkabilityCellStyle[] => {
  const styles: WalkabilityCellStyle[] = new Array(grid.width * grid.height);
  for (let i = 0; i < styles.length; i++) {
    styles[i] = walkabilityCellStyle(grid.cost[i]);
  }
  return styles;
};

/**
 * Convenience classification for tests and assertions: how many cells are
 * walkable vs blocked in the authoritative grid.
 *
 * @param grid - The authoritative TerrainGrid.
 * @returns Counts of walkable and blocked cells.
 */
export const countWalkability = (grid: TerrainGrid): { walkable: number; blocked: number } => {
  let walkable = 0;
  let blocked = 0;
  for (let i = 0; i < grid.cost.length; i++) {
    if (grid.cost[i] > 0) {
      walkable += 1;
    } else {
      blocked += 1;
    }
  }
  return { walkable, blocked };
};

// Reference constant so callers can compare against the canonical walkable
// cost without re-deriving the encoding.
export { TERRAIN_COST_WALKABLE };
