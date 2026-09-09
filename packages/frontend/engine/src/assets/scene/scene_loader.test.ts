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

// ── AC-1 production integration: loadMapCanonical + compileSceneToTilemap ──

const tiledJson = JSON.stringify({
  width: 2,
  height: 2,
  tilewidth: 32,
  tileheight: 32,
  tilesets: [
    {
      firstgid: 1,
      name: 'atlas',
      image: 'atlas.png',
      imagewidth: 128,
      imageheight: 128,
      tilewidth: 32,
      tileheight: 32,
      columns: 4,
      tilecount: 16,
    },
  ],
  aikami: { terrain: ['grass', 'grass', 'grass', 'water'] },
  layers: [
    { type: 'tilelayer', name: 'ground', width: 2, height: 2, data: [1, 1, 1, 2] },
    { type: 'tilelayer', name: 'decor', width: 2, height: 2, data: [1, 1, 1, 2] },
    { type: 'tilelayer', name: 'collision', width: 2, height: 2, data: [0, 0, 0, 1] },
    {
      type: 'objectgroup',
      name: 'entities',
      objects: [
        {
          id: 7,
          type: 'spawn',
          x: 32,
          y: 64,
          properties: [{ name: 'spawnId', type: 'string', value: 'town_spawn' }],
        },
        {
          id: 9,
          type: 'transition',
          x: 0,
          y: 0,
          width: 32,
          height: 32,
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

describe('loadMapCanonical (AC-1 production integration)', () => {
  test('routes a Tiled map through the canonical scene and returns a canonical tilemap', async () => {
    const { loadMapCanonical } = await import('./scene_loader.ts');
    const { compileSceneToTilemap } = await import('./scene_compiler.ts');
    const { doc, compiled, tilemap, source } = await loadMapCanonical({
      url: 'maps:emberwatch/inn.json',
      sceneId: 'emberwatch/inn',
      assetLock: 'pack:emberwatch@1.0.0',
      baseTerrain: 'grass',
      terrains: makeTerrains(),
      fetch: (async () =>
        new Response(tiledJson, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    });
    // Single canonical interpretation: validated doc + compiled scene + canonical tilemap.
    expect(doc).toBeDefined();
    expect(compiled).toBeDefined();
    if (!doc || !compiled) {
      throw new Error('expected a canonical doc and compiled scene');
    }
    expect(source).toBe('tiled');
    // The canonical tilemap preserves the source render layers (GIDs + tilesets)
    // so the existing GID-based renderer keeps working while the scene stays
    // the single authority.
    expect(tilemap.terrain).toEqual(['grass', 'grass', 'grass', 'water']);
    expect(tilemap.tilesets[0].image).toBe('atlas.png');
    // Spawns + transitions are recovered from the canonical scene placements.
    const objects = tilemap.objectLayers?.[0].objects ?? [];
    expect(objects.some((o) => o.type === 'spawn')).toBe(true);
    expect(objects.some((o) => o.type === 'transition')).toBe(true);

    // compileSceneToTilemap output is round-trippable and stable.
    const round = compileSceneToTilemap(compiled, doc);
    expect(round.width).toBe(2);
    expect(round.terrain).toEqual(tilemap.terrain);
  });

  test('packless terrain-channel map falls back to the legacy parse (game still boots)', async () => {
    const { loadMapCanonical } = await import('./scene_loader.ts');
    const { tilemap, doc } = await loadMapCanonical({
      url: 'maps:dev.json',
      fetch: (async () =>
        new Response(tiledJson, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    });
    expect(tilemap).toBeDefined();
    expect(doc).toBeUndefined(); // no baseTerrain → legacy fallback
  });
});
