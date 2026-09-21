// packages/frontend/preview/src/lib/map/__tests__/map_preview_scene.test.ts
//
// C-507 — The preview's pure scene loader forwards `terrains` so
// terrain-channel (corner16) scenes compile instead of throwing.
//
// The ViewModel itself pulls in host services/env validation, so the
// forwarding is verified through this extracted pure helper.

import { describe, expect, it } from 'bun:test';
import type { ContentPackTerrain } from '@aikami/schemas';
import { loadSceneSync } from '../map_preview_scene';

const TERRAINS: readonly ContentPackTerrain[] = [
  {
    name: 'grass',
    precedence: 0,
    wang: 'fill',
    frameBase: 'grass_0.png',
    variants: ['grass_1.png'],
    isWalkable: true,
    movementCost: 1,
    blocksSight: false,
  },
  {
    name: 'water',
    precedence: 1,
    wang: 'corner16',
    frameBase: 'water_0.png',
    isWalkable: false,
    movementCost: 4,
    blocksSight: false,
  },
];

const terrainSceneJson = (): string =>
  JSON.stringify({
    kind: 'aikami.scene',
    schemaVersion: 1,
    id: 'preview-terrain',
    assetLock: 'pack:emberwatch@1.0.0',
    extent: { width: 2, height: 2, tileSize: 32 },
    surface: {
      mode: 'terrain',
      defaultTerrain: 'grass',
      cells: ['grass', 'grass', 'grass', 'water'],
      matchingMode: 'corner16',
    },
    layers: [],
    placements: [],
    navigation: {},
  });

const baseOptions = {
  sceneId: 'preview-terrain',
  assetLock: 'pack:emberwatch@1.0.0',
  adapter: { baseTerrain: 'grass' },
};

describe('loadSceneSync terrain forwarding', () => {
  it('compiles a terrain surface when terrains are provided', () => {
    const { result } = loadSceneSync(terrainSceneJson(), {
      ...baseOptions,
      terrains: TERRAINS,
    });

    const frames = result.compiled.layers.flatMap((layer) => layer.frames);
    expect(frames.some((frame) => frame.length > 0)).toBe(true);
    expect(result.compiled.collision[3]).toBe(true); // water is not walkable
  });

  it('throws without terrains — the gap this change closes', () => {
    expect(() => loadSceneSync(terrainSceneJson(), baseOptions)).toThrow(
      /requires pack terrain definitions/,
    );
  });

  it('forwards terrains for legacy Tiled tilemaps too', () => {
    const tiled = JSON.stringify({
      type: 'map',
      version: 1,
      orientation: 'orthogonal',
      renderorder: 'right-down',
      width: 2,
      height: 2,
      tilewidth: 32,
      tileheight: 32,
      infinite: false,
      layers: [
        {
          type: 'tilelayer',
          name: 'ground',
          width: 2,
          height: 2,
          visible: true,
          opacity: 1,
          x: 0,
          y: 0,
          data: [1, 1, 1, 1],
        },
      ],
      tilesets: [
        {
          firstgid: 1,
          name: 'atlas',
          image: 'atlas.png',
          imagewidth: 64,
          imageheight: 64,
          tilewidth: 32,
          tileheight: 32,
          columns: 2,
          tilecount: 4,
          margin: 0,
          spacing: 0,
        },
      ],
      aikami: { terrain: ['grass', 'grass', 'grass', 'water'] },
    });

    const { result, tilesets } = loadSceneSync(tiled, {
      ...baseOptions,
      terrains: TERRAINS,
    });
    expect(result.source).toBe('tiled');
    expect(result.doc.surface.mode).toBe('terrain');
    expect(result.compiled.collision[3]).toBe(true);
    expect(tilesets).toHaveLength(1);
  });
});
