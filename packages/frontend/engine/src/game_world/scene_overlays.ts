// packages/frontend/engine/src/game_world/scene_overlays.ts
//
// Stateless scene-graph overlays and resolvers used during a scene
// transition. These are plain functions over explicit inputs (the world
// container, map dimensions, terrain grid, transition zones) so they can be
// unit-tested against a bare PixiJS Container — no GameWorld, no worker.

import { type Container, Graphics } from 'pixi.js';
import type { TransitionZone } from '../assets/map_loader.ts';
import { WORLD_Z_BANDS } from '../rendering/layer_bands.ts';
import type { PropTextureResolver } from '../rendering/prop_texture_resolver.ts';
import { buildWalkabilityStyles } from '../rendering/walkability_overlay.ts';
import type { TerrainGrid } from '../systems/terrain_grid.ts';
import type { FrameUvResolver } from '../systems/tilemap_render_system.ts';

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
}): void => {
  const { worldContainer } = options;

  const oldGrid = worldContainer.children.find((child) => child.label === 'debug-grid');
  if (oldGrid) {
    worldContainer.removeChild(oldGrid);
    oldGrid.destroy();
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
 * Draws debug overlays for transition zones, replacing any previous ones.
 *
 * Each zone renders as a semi-transparent rectangle with a direction arrow —
 * the only visual indication of where a portal can be triggered.
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

  for (const zone of zones) {
    const graphics = new Graphics();

    graphics.rect(zone.x, zone.y, zone.width, zone.height);
    graphics.fill({ color: 0x00ff88, alpha: 0.2 });
    graphics.rect(zone.x, zone.y, zone.width, zone.height);
    graphics.stroke({ width: 2, color: 0x00ff88, alpha: 0.8 });

    const cx = zone.x + zone.width / 2;
    const cy = zone.y + zone.height / 2;
    graphics.moveTo(cx, cy - 8);
    graphics.lineTo(cx, cy + 4);
    graphics.lineTo(cx - 6, cy - 2);
    graphics.moveTo(cx, cy + 4);
    graphics.lineTo(cx + 6, cy - 2);
    graphics.stroke({ width: 1.5, color: 0x00ff88, alpha: 0.9 });

    graphics.label = `zone-overlay-${zone.id}`;
    graphics.eventMode = 'none';
    graphics.zIndex = WORLD_Z_BANDS.zoneOverlays;

    worldContainer.addChild(graphics);
  }
};
