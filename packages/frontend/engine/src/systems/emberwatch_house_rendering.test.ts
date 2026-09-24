// packages/frontend/engine/src/systems/emberwatch_house_rendering.test.ts
//
// C-550 — the house's explicit ground contributions must survive terrain
// autotiling, while upper-roof overhead must remain above actors.

import { describe, expect, test } from 'bun:test';
import type { TilemapData, TilemapLayer } from '../assets/map_loader.ts';
import { WORLD_Z_BANDS } from '../rendering/layer_bands.ts';
import { filterBakedGroundForTerrain } from './tilemap_render_system.ts';

const layer = (name: string, band: TilemapLayer['band'], data: number[]): TilemapLayer => ({
  name,
  band,
  width: 3,
  height: 1,
  data,
  visible: true,
});

const tilemap = (overrides: Partial<TilemapData> = {}): TilemapData => ({
  width: 3,
  height: 1,
  tilewidth: 32,
  tileheight: 32,
  tilesets: [],
  layers: [
    layer('ground', 'ground', [1, 153, 1]),
    layer('decor', 'decor', [0, 0, 160]),
    layer('overhead', 'overhead', [0, 0, 147]),
  ],
  terrain: ['grass', '', 'grass'],
  ...overrides,
});

describe('C-550 — baked ground filtering and occlusion bands', () => {
  test('keeps the explicit facade but removes terrain and decor duplicates', () => {
    const map = tilemap();
    const ground = map.layers[0];
    if (!ground) {
      throw new Error('test fixture has no ground layer');
    }

    const filtered = filterBakedGroundForTerrain(map, ground);

    expect(filtered.data).toEqual([0, 153, 0]);
    expect(ground.data).toEqual([1, 153, 1]);
    expect(filtered).not.toBe(ground);
  });

  test('keeps facade cells when an overhead roof is the only duplicate', () => {
    const map = tilemap({
      layers: [
        layer('ground', 'ground', [1, 153, 1]),
        layer('decor', 'decor', [0, 0, 0]),
        layer('overhead', 'overhead', [0, 0, 147]),
      ],
    });
    const ground = map.layers[0];
    if (!ground) {
      throw new Error('test fixture has no ground layer');
    }

    expect(filterBakedGroundForTerrain(map, ground).data).toEqual([0, 153, 0]);
  });

  test('leaves the baked layer unchanged when no terrain channel exists', () => {
    const map = tilemap({ terrain: undefined });
    const ground = map.layers[0];
    if (!ground) {
      throw new Error('test fixture has no ground layer');
    }

    expect(filterBakedGroundForTerrain(map, ground)).toBe(ground);
  });

  test('overhead remains above entities while ground and decor remain below them', () => {
    expect(WORLD_Z_BANDS.tilemapOverhead).toBeGreaterThan(0);
    expect(WORLD_Z_BANDS.tilemapOverhead).toBeGreaterThan(WORLD_Z_BANDS.tilemapGround);
    expect(WORLD_Z_BANDS.tilemapOverhead).toBeGreaterThan(WORLD_Z_BANDS.tilemapDecor);
  });
});
