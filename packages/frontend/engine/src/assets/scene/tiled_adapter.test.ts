// packages/frontend/engine/src/assets/scene/tiled_adapter.test.ts
//
// C-505 — AC-1 (Tiled/JTON normalize to the scene model preserving
// dimensions, transforms, collisions, transitions, stable identities), AC-2
// (targeted ground-duplicate decor cleanup), AC-3 (identity recovery, fail
// conversion when identity cannot be established).

import { describe, expect, test } from 'bun:test';
import type { TilemapData } from '../map_loader.ts';
import { SceneConversionError, tilemapToScene } from './tiled_adapter.ts';

/** A minimal terrain-channel Emberwatch-style TilemapData. */
const makeTilemap = (): TilemapData => ({
  width: 2,
  height: 2,
  tilewidth: 32,
  tileheight: 32,
  tilesets: [],
  terrain: ['grass', 'grass', 'grass', 'water'],
  layers: [
    {
      name: 'ground',
      width: 2,
      height: 2,
      visible: true,
      band: 'ground',
      data: [1, 1, 1, 2],
      frames: ['grass_0.png', 'grass_0.png', 'grass_0.png', 'water_0.png'],
    },
    {
      name: 'decor',
      width: 2,
      height: 2,
      visible: true,
      band: 'decor',
      // identical to ground → Emberwatch duplication
      data: [1, 1, 1, 2],
      frames: ['grass_0.png', 'grass_0.png', 'grass_0.png', 'water_0.png'],
    },
    {
      name: 'collision',
      width: 2,
      height: 2,
      visible: true,
      band: 'ground',
      data: [0, 0, 0, 1],
    },
  ],
  objectLayers: [
    {
      name: 'entities',
      objects: [
        {
          id: 1001,
          type: 'spawn',
          x: 32,
          y: 64,
          properties: [{ name: 'spawnId', type: 'string', value: 'town_spawn' }],
        },
        {
          id: 1002,
          type: 'npc',
          name: 'mayor',
          x: 96,
          y: 128,
          properties: [{ name: 'npcId', type: 'string', value: 'mayor' }],
        },
        {
          id: 1003,
          type: 'transition',
          x: 0,
          y: 0,
          width: 32,
          height: 64,
          properties: [
            { name: 'targetMap', type: 'string', value: 'forest' },
            { name: 'targetX', type: 'number', value: 64 },
            { name: 'targetY', type: 'number', value: 32 },
          ],
        },
      ],
    },
  ],
});

describe('tiled_adapter', () => {
  test('normalizes a terrain-channel Tiled map preserving identity (AC-1/AC-3)', () => {
    const doc = tilemapToScene(makeTilemap(), {
      sceneId: 'emberwatch/inn',
      assetLock: 'pack:emberwatch@1.0.0',
      source: 'tiled:emberwatch/inn.tmj',
      revision: 'abc123',
      baseTerrain: 'grass',
    });
    expect(doc.kind).toBe('aikami.scene');
    expect(doc.extent).toEqual({ width: 2, height: 2, tileSize: 32 });
    expect(doc.surface.mode).toBe('terrain');
    expect(doc.placements.map((p) => p.id)).toEqual(['1001', '1002']);
    expect(doc.placements[1]).toMatchObject({ id: '1002', component: 'npc', x: 96, y: 128 });
    // transitions preserved
    expect(doc.transitions?.[0]).toMatchObject({
      id: '1003',
      targetMap: 'forest',
      targetX: 64,
      targetY: 32,
    });
    // collision layer → navigation blocking override
    expect(doc.navigation.blockingOverrides).toEqual([{ index: 3, blocked: true }]);
    // provenance
    expect(doc.provenance).toMatchObject({
      source: 'tiled:emberwatch/inn.tmj',
      revision: 'abc123',
    });
  });

  test('drops ground-duplicate decor only when targeted cleanup is enabled (AC-2)', () => {
    const withCleanup = tilemapToScene(makeTilemap(), {
      sceneId: 'emberwatch/inn',
      assetLock: 'pack:emberwatch@1.0.0',
      baseTerrain: 'grass',
      dropGroundDuplicateDecor: true,
    });
    expect(withCleanup.layers.length).toBe(0); // decor dropped

    const withoutCleanup = tilemapToScene(makeTilemap(), {
      sceneId: 'emberwatch/inn',
      assetLock: 'pack:emberwatch@1.0.0',
      baseTerrain: 'grass',
    });
    expect(withoutCleanup.layers.length).toBe(1); // decor kept
  });

  test('recoverable failure when an object has no stable id (AC-3)', () => {
    const tilemap = makeTilemap();
    const objects = tilemap.objectLayers?.[0].objects;
    if (objects) {
      objects[1] = { type: 'npc', name: 'mayor', x: 96, y: 128 } as never;
    }
    expect(() =>
      tilemapToScene(tilemap, {
        sceneId: 'emberwatch/inn',
        assetLock: 'pack:emberwatch@1.0.0',
        baseTerrain: 'grass',
      }),
    ).toThrow(SceneConversionError);
  });

  test('maps legacy identities through the persisted identity map (AC-3)', () => {
    const doc = tilemapToScene(makeTilemap(), {
      sceneId: 'emberwatch/inn',
      assetLock: 'pack:emberwatch@1.0.0',
      baseTerrain: 'grass',
      identityMap: { 1002: 'mayor-door-npc' },
    });
    expect(doc.placements.find((p) => p.id === 'mayor-door-npc')).toBeDefined();
  });

  test('recoverable failure when a baked layer cannot resolve frames', () => {
    const tilemap = makeTilemap();
    // Remove the terrain channel → baked path; strip frames so no GID→frame
    // resolution is possible (no frameResolver supplied).
    tilemap.terrain = undefined;
    for (const layer of tilemap.layers) {
      delete (layer as { frames?: unknown }).frames;
    }
    expect(() =>
      tilemapToScene(tilemap, {
        sceneId: 'emberwatch/inn',
        assetLock: 'pack:emberwatch@1.0.0',
      }),
    ).toThrow(SceneConversionError);
  });
});
