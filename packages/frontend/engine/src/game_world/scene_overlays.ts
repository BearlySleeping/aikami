// packages/frontend/engine/src/game_world/scene_overlays.ts
//
// Stateless scene-graph overlays and resolvers used during a scene
// transition. These are plain functions over explicit inputs (the world
// container, map dimensions, terrain grid, transition zones) so they can be
// unit-tested against a bare PixiJS Container — no GameWorld, no worker.

import type { GridPoint } from '@aikami/types';
import { type Container, Graphics } from 'pixi.js';
import type { TransitionZone } from '../assets/map_loader.ts';
import {
  buildCombatHighlightCells,
  combatHighlightCellStyle,
} from '../rendering/combat_selection_overlay.ts';
import { WORLD_Z_BANDS } from '../rendering/layer_bands.ts';
import type { PropTextureResolver } from '../rendering/prop_texture_resolver.ts';
import { buildWalkabilityStyles } from '../rendering/walkability_overlay.ts';
import type { TerrainGrid } from '../systems/terrain_grid.ts';
import type { FrameUvResolver } from '../systems/tilemap_render_system.ts';
import { isE2ETestMode } from './diagnostics.ts';

/**
 * Builds a frame-name → UV-rect resolver from the pack's atlas.
 *
 * Missing frames resolve to the pack's `fallbackTile`; returns `undefined`
 * when no resolver/probe frame is available so the renderer can degrade to
 * the baked-GID path.
 */
export const buildFrameUvResolver = (options: {
  propFrameResolver?: PropTextureResolver;
  probeFrame: string | undefined;
}): FrameUvResolver | undefined => {
  const { propFrameResolver, probeFrame } = options;
  if (!propFrameResolver || !probeFrame) {
    return undefined;
  }
  const probe = propFrameResolver(probeFrame);
  if (!probe) {
    return undefined;
  }
  const source = probe.texture.source;
  return {
    source,
    resolve: (frame: string) => {
      const resolution = propFrameResolver(frame);
      if (!resolution) {
        return undefined;
      }
      const tex = resolution.texture;
      // PixiJS Texture.frame is the atlas-space rect in pixels; divide by the
      // source size for [0,1] UVs.
      const f = tex.frame;
      const src = tex.source;
      const sourceW = src.width || 1;
      const sourceH = src.height || 1;
      return {
        u0: f.x / sourceW,
        v0: f.y / sourceH,
        u1: (f.x + f.width) / sourceW,
        v1: (f.y + f.height) / sourceH,
      };
    },
  };
};

/**
 * Draws a tile-aligned debug grid, replacing any previous one.
 *
 * When a terrain grid is supplied, each cell is painted with the walkability
 * style projected from `grid.cost` — the exact movement authority pathfinding
 * reads (C-506 AC-4). Without one, only gridlines are drawn.
 */
export const drawDebugGrid = (options: {
  worldContainer: Container;
  width: number;
  height: number;
  tileSize: number;
  terrainGrid?: TerrainGrid;
  /**
   * C-543 PART F — the walkability grid is an E2E/authoring aid, never a
   * production surface. Defaults to the shared E2E gate so no production
   * caller can accidentally ship it; unit tests opt in with `enabled: true`.
   */
  enabled?: boolean;
}): void => {
  const { worldContainer } = options;

  // Clear any previous grid first so a disabled call also tears down stale
  // geometry from an earlier enabled pass.
  const oldGrid = worldContainer.children.find((child) => child.label === 'debug-grid');
  if (oldGrid) {
    worldContainer.removeChild(oldGrid);
    oldGrid.destroy();
  }

  if (!(options.enabled ?? isE2ETestMode())) {
    return;
  }

  const grid = new Graphics();
  grid.label = 'debug-grid';
  // C-376 AC-4: explicit band below the entity y-range.
  grid.zIndex = WORLD_Z_BANDS.debugGrid;

  const tileSize = options.tileSize;
  const gridW = options.width;
  const gridH = options.height;
  const pixelW = gridW * tileSize;
  const pixelH = gridH * tileSize;

  if (options.terrainGrid) {
    const styles = buildWalkabilityStyles(options.terrainGrid);
    for (let row = 0; row < gridH; row++) {
      for (let col = 0; col < gridW; col++) {
        const style = styles[row * gridW + col];
        if (!style) {
          continue;
        }
        grid.rect(col * tileSize, row * tileSize, tileSize, tileSize).fill({
          color: style.fill,
          alpha: style.alpha,
        });
        grid.rect(col * tileSize, row * tileSize, tileSize, tileSize).stroke({
          width: 1,
          color: style.stroke,
        });
      }
    }
  } else {
    const strokeColor = 0x33334a;
    for (let col = 0; col <= gridW; col++) {
      const x = col * tileSize;
      grid.moveTo(x, 0).lineTo(x, pixelH).stroke({ width: 1, color: strokeColor });
    }
    for (let row = 0; row <= gridH; row++) {
      const y = row * tileSize;
      grid.moveTo(0, y).lineTo(pixelW, y).stroke({ width: 1, color: strokeColor });
    }
  }

  worldContainer.addChild(grid);
};

/**
 * Draws a quiet, in-world marker for each transition zone (portal/exit).
 *
 * C-543 PART F: the previous marker was a full-zone neon-green rectangle with a
 * large arrow that dominated the scene. Portals are still the only visual
 * indication of where a transition can be triggered, so they remain rendered —
 * but as a restrained brass-tinted zone outline with a compact grounded chevron,
 * consistent with the Obsidian Chronicle material language, rather than a debug
 * neon overlay.
 */
export const renderTransitionZoneOverlays = (options: {
  worldContainer: Container;
  zones: readonly TransitionZone[];
}): void => {
  const { worldContainer, zones } = options;

  const oldOverlays = worldContainer.children.filter(
    (child) => typeof child.label === 'string' && child.label.startsWith('zone-overlay-'),
  );
  for (const overlay of oldOverlays) {
    worldContainer.removeChild(overlay);
    overlay.destroy({ children: true });
  }

  // Restrained brass marker — no saturated neon, no scene-dominating arrow.
  const markerColor = 0xd9b36c;

  for (const zone of zones) {
    const graphics = new Graphics();

    // Quiet zone footprint.
    graphics.rect(zone.x, zone.y, zone.width, zone.height);
    graphics.fill({ color: markerColor, alpha: 0.07 });
    graphics.rect(zone.x, zone.y, zone.width, zone.height);
    graphics.stroke({ width: 1, color: markerColor, alpha: 0.35 });

    // Small grounded chevron at the zone centre (direction hint, not a rail).
    const cx = zone.x + zone.width / 2;
    const cy = zone.y + zone.height / 2;
    graphics.moveTo(cx - 4, cy - 3);
    graphics.lineTo(cx, cy + 2);
    graphics.lineTo(cx + 4, cy - 3);
    graphics.stroke({ width: 1.5, color: markerColor, alpha: 0.6 });

    graphics.label = `zone-overlay-${zone.id}`;
    graphics.eventMode = 'none';
    graphics.zIndex = WORLD_Z_BANDS.zoneOverlays;

    worldContainer.addChild(graphics);
  }
};

/**
 * Renders the scene's static overlays after a map load (C-543).
 *
 * Transition-zone markers are a production surface (portals must stay
 * discoverable); the walkability debug grid is not, so it is gated behind
 * `debugGrid`. Keeping the composition here removes the flag branching from the
 * engine facade.
 */
export const renderMapSceneOverlays = (options: {
  worldContainer: Container;
  zones: readonly TransitionZone[];
  map: { readonly width: number; readonly height: number; readonly tileSize: number };
  terrainGrid?: TerrainGrid;
  debugGrid: boolean;
}): void => {
  renderTransitionZoneOverlays({ worldContainer: options.worldContainer, zones: options.zones });
  drawDebugGrid({
    worldContainer: options.worldContainer,
    width: options.map.width,
    height: options.map.height,
    tileSize: options.map.tileSize,
    terrainGrid: options.terrainGrid,
    enabled: options.debugGrid,
  });
};

/**
 * Draws the combat direct-control highlight overlay, replacing any previous
 * one (C-525 R-2).
 *
 * Reachable move endpoints and engine-declared legal target cells are painted
 * on the tactical battlefield; the overlay is non-interactive (`eventMode:
 * 'none'`) and sits below every entity so sprites stay readable. When the
 * selection has no cells to show, any existing overlay is removed.
 */
export const drawCombatSelectionHighlights = (options: {
  worldContainer: Container;
  tileSize: number;
  legalEndpoints: readonly GridPoint[];
  legalTargetCells: readonly GridPoint[];
}): void => {
  const { worldContainer } = options;

  const old = worldContainer.children.find(
    (child) => child.label === 'combat-selection-highlights',
  );
  if (old) {
    worldContainer.removeChild(old);
    old.destroy();
  }

  const cells = buildCombatHighlightCells({
    legalEndpoints: options.legalEndpoints,
    legalTargetCells: options.legalTargetCells,
  });
  if (cells.length === 0) {
    return;
  }

  const tileSize = options.tileSize;
  const overlay = new Graphics();
  overlay.label = 'combat-selection-highlights';
  overlay.zIndex = WORLD_Z_BANDS.combatSelection;
  overlay.eventMode = 'none';

  for (const cell of cells) {
    const style = combatHighlightCellStyle(cell.kind);
    const x = cell.x * tileSize;
    const y = cell.y * tileSize;
    overlay.rect(x, y, tileSize, tileSize).fill({ color: style.fill, alpha: style.alpha });
    overlay.rect(x, y, tileSize, tileSize).stroke({ width: 2, color: style.stroke });
  }

  worldContainer.addChild(overlay);
};

/** Removes the combat direct-control highlight overlay, if present. */
export const clearCombatSelectionHighlights = (worldContainer: Container): void => {
  const old = worldContainer.children.find(
    (child) => child.label === 'combat-selection-highlights',
  );
  if (old) {
    worldContainer.removeChild(old);
    old.destroy();
  }
};
