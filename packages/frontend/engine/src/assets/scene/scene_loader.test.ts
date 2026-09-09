// packages/frontend/engine/src/assets/scene/scene_loader.test.ts
//
// C-505 — AC-1 (unified loader normalizes native + legacy into one scene),
// AC-7 (future authoring formats are rejected at the loader boundary, never
// executed as maps).

import { describe, expect, test } from 'bun:test';
import { SCENE_FUTURE_DOCUMENT_KINDS } from '@aikami/constants';
import { SceneUnsupportedFormatError } from './native_scene.ts';
import { sceneFromNative, sceneFromTilemap } from './scene_loader.ts';
import { makeTerrainScene, makeTerrains } from './scene_test_utils.ts';

const OPTS = {
  sceneId: 'emberwatch/inn',
  assetLock: 'pack:emberwatch@1.0.0',
  terrains: makeTerrains(),
};

describe('scene_loader', () => {
  test('sceneFromNative parses + validates + compiles a native scene', () => {
    const doc = makeTerrainScene();
    const { doc: parsed, compiled, source } = sceneFromNative(JSON.stringify(doc), OPTS);
    expect(source).toBe('native');
    expect(parsed.id).toBe(doc.id);
    expect(compiled.layers.length).toBeGreaterThan(0);
  });

  test('sceneFromNative rejects future authoring formats (AC-7)', () => {
    for (const kind of SCENE_FUTURE_DOCUMENT_KINDS) {
      const future = JSON.stringify({ ...makeTerrainScene(), kind });
      expect(() => sceneFromNative(future, OPTS)).toThrow(SceneUnsupportedFormatError);
    }
  });

  test('sceneFromTilemap normalizes a legacy map into a validated scene', () => {
    const tilemap = {
      width: 2,
      height: 2,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      terrain: ['grass', 'grass', 'grass', 'water'],
      layers: [
        { name: 'ground', width: 2, height: 2, visible: true, band: 'ground', data: [1, 1, 1, 2] },
        {
          name: 'collision',
          width: 2,
          height: 2,
          visible: true,
          band: 'ground',
          data: [0, 0, 0, 1],
        },
      ],
    };
    const { doc, compiled, source } = sceneFromTilemap(tilemap as never, {
      ...OPTS,
      adapter: { baseTerrain: 'grass' },
    });
    expect(source).toBe('tiled');
    expect(doc.surface.mode).toBe('terrain');
    expect(compiled.collision[3]).toBe(true); // water not walkable
  });

  test('sceneFromNative validates unknown terrain against the pack (AC-4)', () => {
    const bad = makeTerrainScene({
      surface: {
        mode: 'terrain',
        defaultTerrain: 'grass',
        cells: ['grass', 'lava', 'grass', 'water'],
        matchingMode: 'corner16',
      },
    });
    expect(() =>
      sceneFromNative(JSON.stringify(bad), {
        ...OPTS,
        pack: { terrainIds: ['grass', 'water'], frameNames: new Set() },
      }),
    ).toThrow(/unknown terrain id\(s\): lava/);
  });
});
