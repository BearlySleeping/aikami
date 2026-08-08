// packages/frontend/engine/src/__tests__/emberwatch_content_audit.test.ts
//
// C-375 AC-4 + AC-5 — static content integrity audit for the regenerated
// Emberwatch pack.
//
// Reads the real static files (atlas.json, manifest.json, the three maps)
// and verifies:
//   - every map spawn `frame` exists in atlas.json
//   - every manifest `tiles[x].frame` / `props[y].frame` exists + fallbackTile exists
//   - map tileset blocks match the atlas grid (512×256, 16 columns, 128 tiles)
//   - no tile GID exceeds the declared frame grid
//   - collision layer matches visible walls (wall GIDs blocked, floor GIDs open)
//   - gameplay IDs are stable: spawn ids, transition targets, npc ids, prop ids

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Fixture paths — the actual committed static content.
// ---------------------------------------------------------------------------

const PACK_DIR = join(import.meta.dir, '../../../../../apps/frontend/client/static/content-packs/emberwatch');
const ATLAS_JSON_PATH = join(
  import.meta.dir,
  '../../../../../apps/frontend/client/static/game-data/sprites/tilesets/atlas.json',
);

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf-8')) as T;

type AtlasJson = {
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
  meta: { size: { w: number; h: number } };
};

type MapJson = {
  width: number;
  height: number;
  tilesets: Array<{
    firstgid: number;
    imagewidth: number;
    imageheight: number;
    columns: number;
    tilecount: number;
  }>;
  layers: Array<{
    name: string;
    type: string;
    data?: number[];
    objects?: Array<{
      id: number;
      type: string;
      x: number;
      y: number;
      properties: Array<{ name: string; value: unknown }>;
    }>;
  }>;
};

type ManifestJson = {
  version: string;
  fallbackTile?: string;
  tiles?: Record<string, { frame?: string }>;
  props?: Record<string, { frame?: string }>;
};

/** Wall-ish GIDs — every cell using one of these must be blocked. */
const WALL_GIDS = new Set([8, 9, 10, 11, 12, 13, 15, 16, 31, 44, 45, 46]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Emberwatch content audit (C-375 AC-4)', () => {
  const atlas = readJson<AtlasJson>(ATLAS_JSON_PATH);
  const frames = new Set(Object.keys(atlas.frames));
  const manifest = readJson<ManifestJson>(join(PACK_DIR, 'manifest.json'));

  test('atlas.json declares >= 32 frames at 512×256', () => {
    expect(frames.size).toBeGreaterThanOrEqual(32);
    expect(atlas.meta.size).toEqual({ w: 512, h: 256 });
  });

  test('fallbackTile grass.png exists in the atlas', () => {
    expect(manifest.fallbackTile).toBe('grass.png');
    expect(frames.has('grass.png')).toBe(true);
  });

  test('every manifest tiles[x].frame exists in atlas.json', () => {
    expect(manifest.tiles).toBeDefined();
    for (const [tileId, def] of Object.entries(manifest.tiles ?? {})) {
      expect(frames.has(def.frame ?? ''), `tiles[${tileId}].frame ${def.frame}`).toBe(true);
    }
  });

  test('every manifest props[y].frame exists in atlas.json', () => {
    expect(manifest.props).toBeDefined();
    for (const [propId, def] of Object.entries(manifest.props ?? {})) {
      expect(frames.has(def.frame ?? ''), `props[${propId}].frame ${def.frame}`).toBe(true);
    }
  });

  test('pack version bumped to 3.1.0', () => {
    expect(manifest.version).toBe('3.1.0');
  });
});

describe('Emberwatch map audit (C-375 AC-5)', () => {
  const atlas = readJson<AtlasJson>(ATLAS_JSON_PATH);
  const frames = new Set(Object.keys(atlas.frames));

  const maps: Record<string, MapJson> = {
    village: readJson<MapJson>(join(PACK_DIR, 'maps/village.json')),
    inn: readJson<MapJson>(join(PACK_DIR, 'maps/inn.json')),
    merchant_shop: readJson<MapJson>(join(PACK_DIR, 'maps/merchant_shop.json')),
  };

  test('all three maps keep their footprints (20×20 / 16×12 / 16×12)', () => {
    expect(maps.village.width).toBe(20);
    expect(maps.village.height).toBe(20);
    expect(maps.inn.width).toBe(16);
    expect(maps.inn.height).toBe(12);
    expect(maps.merchant_shop.width).toBe(16);
    expect(maps.merchant_shop.height).toBe(12);
  });

  test('map tileset blocks match the atlas grid (512×256, 16 cols, 128 tiles)', () => {
    for (const [name, map] of Object.entries(maps)) {
      const block = map.tilesets[0];
      expect(block.firstgid).toBe(1);
      expect(block.imagewidth).toBe(512);
      expect(block.imageheight).toBe(256);
      expect(block.columns).toBe(16);
      expect(block.tilecount).toBe(128);
      expect(name).toBeDefined();
    }
  });

  test('no tile GID exceeds the declared frame grid (max 48)', () => {
    for (const [name, map] of Object.entries(maps)) {
      for (const layer of map.layers) {
        if (layer.type !== 'tilelayer') {
          continue;
        }
        for (const gid of layer.data ?? []) {
          expect(gid, `${name}/${layer.name} GID ${gid}`).toBeLessThanOrEqual(48);
        }
      }
    }
  });

  test('every prop spawn frame exists in atlas.json', () => {
    for (const [name, map] of Object.entries(maps)) {
      for (const layer of map.layers) {
        if (layer.name !== 'spawns') {
          continue;
        }
        for (const obj of layer.objects ?? []) {
          const frame = obj.properties.find((p) => p.name === 'frame')?.value as string | undefined;
          if (frame) {
            expect(frames.has(frame), `${name} spawn frame ${frame}`).toBe(true);
          }
        }
      }
    }
  });

  test('collision layer matches visible walls (wall GIDs blocked, floor GIDs open)', () => {
    for (const [name, map] of Object.entries(maps)) {
      const ground = map.layers.find((l) => l.name === 'ground')?.data ?? [];
      const collision = map.layers.find((l) => l.name === 'collision')?.data ?? [];
      expect(ground.length).toBe(map.width * map.height);
      expect(collision.length).toBe(map.width * map.height);

      for (let i = 0; i < ground.length; i++) {
        const gid = ground[i];
        if (WALL_GIDS.has(gid)) {
          expect(collision[i], `${name} cell ${i} wall GID ${gid} must be blocked`).not.toBe(0);
        } else if (gid !== 0) {
          expect(collision[i], `${name} cell ${i} floor GID ${gid} must be open`).toBe(0);
        }
      }
    }
  });

  test('spawn ids, transition targets, npc ids, and prop ids are stable', () => {
    // Expected gameplay IDs from the pre-change pack (C-316).
    const expectedSpawnIds = ['village_gate', 'from_merchant', 'from_inn', 'inn_entrance', 'shop_entrance'];
    const expectedNpcIds = ['village_elder', 'rollo_grasper', 'merchant'];
    const expectedTransitionTargets = ['merchant_shop', 'inn', 'village'];
    const expectedPropIds = [
      'village_well',
      'notice_board',
      'village_gate',
      'inn_barrel',
      'inn_barrel_2',
      'inn_crate',
      'shop_counter_l',
      'shop_counter_r',
      'shop_crate',
    ];

    const spawnIds = new Set<string>();
    const npcIds = new Set<string>();
    const propIds = new Set<string>();
    const transitionTargets = new Set<string>();

    for (const map of Object.values(maps)) {
      for (const layer of map.layers) {
        for (const obj of layer.objects ?? []) {
          const props = Object.fromEntries(obj.properties.map((p) => [p.name, p.value]));
          if (layer.name === 'spawns') {
            if (obj.type === 'spawn') {
              spawnIds.add(String(props.spawnId));
            } else if (obj.type === 'npc') {
              npcIds.add(String(props.npcId));
            } else if (obj.type === 'prop') {
              propIds.add(String(props.propId));
            }
          } else if (layer.name === 'transitions' && obj.type === 'transition') {
            transitionTargets.add(String(props.targetMap));
          }
        }
      }
    }

    for (const id of expectedSpawnIds) {
      expect(spawnIds.has(id), `spawn id ${id}`).toBe(true);
    }
    for (const id of expectedNpcIds) {
      expect(npcIds.has(id), `npc id ${id}`).toBe(true);
    }
    for (const id of expectedPropIds) {
      expect(propIds.has(id), `prop id ${id}`).toBe(true);
    }
    for (const target of expectedTransitionTargets) {
      expect(transitionTargets.has(target), `transition target ${target}`).toBe(true);
    }
  });
});
