// packages/frontend/engine/src/assets/scene/scene_loader.test.ts
//
// C-505 — AC-1 (unified loader normalizes native + legacy into one scene),
// AC-7 (future authoring formats are rejected at the loader boundary, never
// executed as maps).

import { describe, expect, test } from 'bun:test';
import { SCENE_FUTURE_DOCUMENT_KINDS } from '@aikami/constants';
import { SceneUnsupportedFormatError } from './native_scene.ts';
import {
  buildGidFrameResolver,
  loadScene,
  sceneFromNative,
  sceneFromTilemap,
} from './scene_loader.ts';
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

  test('loadScene routes JTON through its parser and canonical adapter', async () => {
    const jton = `:map: 2 2 32 32
:tileset: atlas 1 atlas.png 64 64 32 32 2 4
:tiles: ground 1
0,0,1
1,0,2
0,1,3
1,1,4
]
`;
    const result = await loadScene({
      ...OPTS,
      terrains: undefined,
      url: 'test://canonical-scene-loader.jton',
      fetch: (async () => new Response(jton, { status: 200 })) as unknown as typeof fetch,
    });
    expect(result.source).toBe('jton');
    expect(result.doc.surface.mode).toBe('baked');
    expect(result.compiled.layers.length).toBeGreaterThan(0);
  });

  test('loadScene normalizes raw Tiled JSON so objectgroup layers do not break the adapter', async () => {
    // Regression: the raw-JSON branch used to cast the parsed document
    // straight to TilemapData, leaving the `spawns` objectgroup inside
    // `layers` — the adapter then rejected the map with
    // `layer "spawns" has no band and its name does not identify …`.
    const tiled = JSON.stringify({
      compressionlevel: -1,
      height: 2,
      infinite: false,
      layers: [
        {
          data: [1, 1, 1, 1],
          height: 2,
          id: 1,
          name: 'ground',
          opacity: 1,
          type: 'tilelayer',
          visible: true,
          width: 2,
          x: 0,
          y: 0,
        },
        {
          draworder: 'topdown',
          id: 2,
          name: 'spawns',
          objects: [
            {
              id: 1,
              name: 'slime',
              type: 'enemy',
              x: 32,
              y: 32,
              width: 32,
              height: 32,
            },
          ],
          opacity: 1,
          type: 'objectgroup',
          visible: true,
          x: 0,
          y: 0,
        },
      ],
      nextlayerid: 3,
      nextobjectid: 2,
      orientation: 'orthogonal',
      renderorder: 'right-down',
      tiledversion: '1.9.0',
      tileheight: 32,
      tilesets: [
        {
          columns: 4,
          firstgid: 1,
          image: 'atlas.png',
          imageheight: 32,
          imagewidth: 128,
          margin: 0,
          name: 'atlas',
          spacing: 0,
          tilecount: 4,
          tilewidth: 32,
          tileheight: 32,
        },
      ],
      tilewidth: 32,
      type: 'map',
      version: 1,
      width: 2,
    });

    const result = await loadScene({
      ...OPTS,
      terrains: undefined,
      url: 'test://objectgroup-map.json',
      fetch: (async () => new Response(tiled, { status: 200 })) as unknown as typeof fetch,
    });

    expect(result.source).toBe('tiled');
    expect(result.compiled.width).toBe(2);
    // The spawn survived normalization as a placement, not as a broken layer.
    expect(result.doc.placements.length).toBe(1);
    expect(result.doc.placements[0]?.component).toBe('enemy');
  });

  test('loadScene rejects future document kinds before legacy conversion', async () => {
    const future = JSON.stringify({ ...makeTerrainScene(), kind: 'aikami.region' });
    await expect(
      loadScene({
        ...OPTS,
        url: 'test://future-region.json',
        fetch: (async () => new Response(future, { status: 200 })) as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(SceneUnsupportedFormatError);
  });

  test('buildGidFrameResolver emits zero-based local frame suffixes', () => {
    const resolveFrame = buildGidFrameResolver([
      {
        firstgid: 10,
        name: 'atlas',
        image: 'atlas.png',
        imagewidth: 64,
        imageheight: 64,
        tilewidth: 32,
        tileheight: 32,
        columns: 2,
        tilecount: 4,
      },
    ]);
    expect(resolveFrame(10, 'ground')).toBe('atlas_0.png');
    expect(resolveFrame(13, 'ground')).toBe('atlas_3.png');
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

  test('normalizes real GID-only banded layers (no C-378 frames) so the game boots', async () => {
    // Mirrors the shipped Emberwatch village map: a terrain channel plus
    // ground/decor/overhead layers stored as raw Tiled GIDs with explicit
    // `band` custom properties — exactly the case that previously threw
    // `SceneConversionError: layer "decor" needs a frames array or a
    // frameResolver` and aborted /game boot (AC-1 regression).
    const gidOnlyJson = JSON.stringify({
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
        {
          type: 'tilelayer',
          name: 'ground',
          width: 2,
          height: 2,
          properties: [{ name: 'band', type: 'string', value: 'ground' }],
          data: [1, 1, 1, 2],
        },
        {
          type: 'tilelayer',
          name: 'decor',
          width: 2,
          height: 2,
          properties: [{ name: 'band', type: 'string', value: 'decor' }],
          data: [3, 4, 0, 5],
        },
        {
          type: 'tilelayer',
          name: 'overhead',
          width: 2,
          height: 2,
          properties: [{ name: 'band', type: 'string', value: 'overhead' }],
          data: [6, 0, 0, 7],
        },
        {
          type: 'tilelayer',
          name: 'collision',
          width: 2,
          height: 2,
          data: [0, 0, 0, 1],
        },
      ],
    });
    const { loadMapCanonical } = await import('./scene_loader.ts');
    const { doc, compiled, tilemap } = await loadMapCanonical({
      url: 'maps:emberwatch/village.json',
      sceneId: 'emberwatch/village',
      assetLock: 'pack:emberwatch@1.0.0',
      baseTerrain: 'grass',
      terrains: makeTerrains(),
      fetch: (async () =>
        new Response(gidOnlyJson, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    });
    // No SceneConversionError: decor/overhead normalized via the GID frameResolver.
    expect(doc).toBeDefined();
    expect(compiled).toBeDefined();
    if (!doc || !compiled) {
      throw new Error('expected canonical doc and compiled scene');
    }
    // Decor + overhead survive as canonical visual layers with lossless,
    // grid-derived frame palettes (`${tileset}_<localId>.png`).
    const decor = doc.layers.find((l) => l.role === 'decor');
    const overhead = doc.layers.find((l) => l.role === 'overhead');
    expect(decor?.palette).toEqual(['', 'atlas_2.png', 'atlas_3.png', 'atlas_4.png']);
    expect(overhead?.palette).toEqual(['', 'atlas_5.png', 'atlas_6.png']);
    // The canonical tilemap still preserves the source GID render layers.
    expect(tilemap.layers.some((l) => l.name === 'decor')).toBe(true);
  });

  test('preserves source spawn/npc/prop custom properties through the canonical round-trip', async () => {
    // Mirrors the shipped Emberwatch object layers: spawn/npc/prop objects
    // carry spawnId/npcId/frame/... custom properties that the entity spawner
    // and spawn-point extraction depend on. The canonical round-trip must not
    // drop them (AC-1/AC-3 parity regression that removed NPCs, broke named
    // spawns and prop frame art).
    const objectJson = JSON.stringify({
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
        {
          type: 'tilelayer',
          name: 'ground',
          width: 2,
          height: 2,
          properties: [{ name: 'band', type: 'string', value: 'ground' }],
          data: [1, 1, 1, 2],
        },
        {
          type: 'objectgroup',
          name: 'entities',
          objects: [
            {
              id: 1,
              type: 'npc',
              x: 32,
              y: 32,
              properties: [
                { name: 'npcId', type: 'string', value: 'village_elder' },
                { name: 'dialogueKey', type: 'string', value: 'elder_thalia_greeting' },
              ],
            },
            {
              id: 2,
              type: 'spawn',
              x: 64,
              y: 32,
              properties: [{ name: 'spawnId', type: 'string', value: 'from_merchant' }],
            },
            {
              id: 3,
              type: 'prop',
              x: 96,
              y: 32,
              properties: [
                { name: 'propId', type: 'string', value: 'village_well' },
                { name: 'frame', type: 'string', value: 'well.png' },
              ],
            },
            {
              id: 4,
              type: 'transition',
              x: 0,
              y: 0,
              width: 32,
              height: 32,
              properties: [
                { name: 'targetMap', type: 'string', value: 'merchant_shop' },
                { name: 'targetX', type: 'number', value: 448 },
                { name: 'targetY', type: 'number', value: 192 },
                { name: 'targetSpawnId', type: 'string', value: 'shop_entrance' },
              ],
            },
          ],
        },
      ],
    });
    const { loadMapCanonical } = await import('./scene_loader.ts');
    const { tilemap } = await loadMapCanonical({
      url: 'maps:emberwatch/village_objects.json',
      sceneId: 'emberwatch/village',
      assetLock: 'pack:emberwatch@1.0.0',
      baseTerrain: 'grass',
      terrains: makeTerrains(),
      fetch: (async () =>
        new Response(objectJson, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    });
    const objects = tilemap.objectLayers?.[0]?.objects ?? [];
    const propsOf = (o: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const p of (o.properties as Array<{ name: string; value: unknown }>) ?? []) {
        out[p.name] = p.value;
      }
      return out;
    };
    // The proven consumers must see the full custom properties, not a
    // stripped-down { frame } — that is what keeps NPCs, named spawns and
    // prop frame art intact at runtime.
    const npc = objects.find((o) => o.type === 'npc');
    expect(propsOf(npc ?? {})).toMatchObject({
      npcId: 'village_elder',
      dialogueKey: 'elder_thalia_greeting',
    });
    const spawn = objects.find((o) => o.type === 'spawn');
    expect(propsOf(spawn ?? {})).toMatchObject({ spawnId: 'from_merchant' });
    const prop = objects.find((o) => o.type === 'prop');
    expect(propsOf(prop ?? {})).toMatchObject({ propId: 'village_well', frame: 'well.png' });
    const transition = objects.find((o) => o.type === 'transition');
    expect(propsOf(transition ?? {})).toMatchObject({
      targetMap: 'merchant_shop',
      targetSpawnId: 'shop_entrance',
    });
  });

  test('canonical placements carry the real prop frame name, not the object type', async () => {
    // Regression: the adapter set `frame: type`, so every prop placement's
    // frame collapsed to the literal "prop" and a canonical consumer could
    // not resolve the art ("ward_large.png" became "prop"). The frame lives
    // in the object's `frame` property.
    const objectJson = JSON.stringify({
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
        {
          type: 'tilelayer',
          name: 'ground',
          width: 2,
          height: 2,
          properties: [{ name: 'band', type: 'string', value: 'ground' }],
          data: [1, 1, 1, 2],
        },
        {
          type: 'objectgroup',
          name: 'spawns',
          objects: [
            {
              id: 12,
              type: 'prop',
              x: 336,
              y: 288,
              properties: [
                { name: 'propId', type: 'string', value: 'ward_tree_landmark' },
                { name: 'frame', type: 'string', value: 'ward_large.png' },
              ],
            },
            {
              // A prop with no frame property keeps the type as a last resort
              // rather than becoming an empty frame.
              id: 13,
              type: 'prop',
              x: 100,
              y: 100,
              properties: [{ name: 'propId', type: 'string', value: 'bare_prop' }],
            },
          ],
        },
      ],
    });

    const { normalizeTilemap } = await import('../map_loader.ts');
    const tilemap = normalizeTilemap(JSON.parse(objectJson), 'test://prop-frame.json');
    const { doc } = sceneFromTilemap(tilemap, {
      sceneId: 'emberwatch/village',
      assetLock: 'pack:emberwatch@1.0.0',
      terrains: makeTerrains(),
      adapter: { baseTerrain: 'grass' },
    });

    const tree = doc.placements.find((p) => p.id === '12');
    expect(tree?.frame).toBe('ward_large.png');
    expect(tree?.component).toBe('prop');
    const bare = doc.placements.find((p) => p.id === '13');
    expect(bare?.frame).toBe('prop');
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
