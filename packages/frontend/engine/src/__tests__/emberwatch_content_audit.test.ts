// packages/frontend/engine/src/__tests__/emberwatch_content_audit.test.ts
//
// C-375 AC-4 + AC-5 + C-376 AC-6 — per-pack static content integrity audit.
//
// Walks every pack under `static/content-packs/*` and validates
// manifest ↔ atlas ↔ maps consistency generically:
//   - every map spawn `frame` exists in the pack's atlas
//   - every manifest `tiles[x].frame` / `props[y].frame` exists + fallbackTile exists
//   - map tileset blocks match the atlas grid
//   - no tile GID exceeds the declared frame grid
//   - collision layer matches visible walls (wall GIDs blocked, floor GIDs open)
//
// Emberwatch-specific expectations (gameplay IDs, footprints, pack version)
// live in the `EMBERWATCH_FIXTURES` block below — they are fixtures, not
// part of the generic validator.

import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PackConfig } from '@aikami/types';
import { buildCollisionGrid, type TilemapData } from '../assets/map_loader.ts';

// ---------------------------------------------------------------------------
// Fixture paths — the actual committed static content.
// ---------------------------------------------------------------------------

const CONTENT_PACKS_ROOT = join(
  import.meta.dir,
  '../../../../../apps/frontend/client/static/content-packs',
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
  id: string;
  version: string;
  fallbackTile?: string;
  atlas?: {
    textureUrl?: string;
    spritesheetUrl?: string;
    tileSize?: number;
  };
  tiles?: Record<string, { name?: string; frame?: string; isWalkable?: boolean; isWall?: boolean }>;
  props?: Record<string, { name?: string; frame?: string; isWalkable?: boolean }>;
  maps?: Record<string, { file?: string }>;
};

// ---------------------------------------------------------------------------
// Emberwatch fixtures (C-376 AC-6) — pack-specific expectations, not generic.
// ---------------------------------------------------------------------------

const EMBERWATCH_FIXTURES = {
  packId: 'emberwatch',
  version: '3.1.0',
  atlas: {
    path: join(
      import.meta.dir,
      '../../../../../apps/frontend/client/static/game-data/sprites/tilesets/atlas.json',
    ),
    minFrames: 32,
    size: { w: 512, h: 256 },
    columns: 16,
    tilecount: 128,
    maxGid: 48,
  },
  fallbackTile: 'grass.png',
  footprints: {
    village: { width: 20, height: 20 },
    inn: { width: 16, height: 12 },
    // biome-ignore lint/style/useNamingConvention: map file names use snake_case
    merchant_shop: { width: 16, height: 12 },
  },
  spawnIds: ['village_gate', 'from_merchant', 'from_inn', 'inn_entrance', 'shop_entrance'],
  npcIds: ['village_elder', 'rollo_grasper', 'merchant'],
  transitionTargets: ['merchant_shop', 'inn', 'village'],
  propIds: [
    'village_well',
    'notice_board',
    'village_gate',
    'inn_barrel',
    'inn_barrel_2',
    'inn_crate',
    'shop_counter_l',
    'shop_counter_r',
    'shop_crate',
  ],
} as const;

/** Maps the emberwatch fixture map keys to their file names. */
const EMBERWATCH_MAP_FILES = {
  village: 'maps/village.json',
  inn: 'maps/inn.json',
  merchantShop: 'maps/merchant_shop.json',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Discovers every pack directory under static/content-packs/*. */
const listPackDirs = (): string[] => {
  const entries = readdirSync(CONTENT_PACKS_ROOT, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && e.name !== 'index.json')
    .map((e) => join(CONTENT_PACKS_ROOT, e.name));
};

// ---------------------------------------------------------------------------
// Generic per-pack audit (C-376 AC-6)
// ---------------------------------------------------------------------------

describe('Per-pack content audit (C-376 AC-6)', () => {
  const packDirs = listPackDirs();

  test('discovers at least one content pack', () => {
    // Asserted inside a test (not the describe body) so an empty pack
    // directory reports a named failing test instead of aborting collection.
    expect(packDirs.length).toBeGreaterThan(0);
  });

  for (const packDir of packDirs) {
    const manifest = readJson<ManifestJson>(join(packDir, 'manifest.json'));
    const packId = manifest.id;
    const maps = Object.values(manifest.maps ?? {});

    // Every pack: declared map files must exist on disk.
    test(`[${packId}] every manifest maps[].file exists`, () => {
      for (const map of maps) {
        const mapPath = map?.file;
        if (!mapPath) {
          continue;
        }
        const full = join(packDir, mapPath);
        expect(existsSync(full), `${packId} map file ${mapPath}`).toBe(true);
      }
    });

    // Packs with an atlas: frame/grid consistency.
    if (manifest.atlas && manifest.tiles) {
      const atlasUrl = manifest.atlas.spritesheetUrl ?? manifest.atlas.textureUrl;
      if (!atlasUrl) {
        continue;
      }
      const atlasPath = atlasUrl.startsWith('/')
        ? join(import.meta.dir, `../../../../../apps/frontend/client/static${atlasUrl}`)
        : atlasUrl;
      const atlas = readJson<AtlasJson>(atlasPath);
      const frames = new Set(Object.keys(atlas.frames));

      test(`[${packId}] every manifest tiles[x].frame exists in the atlas`, () => {
        for (const [tileId, def] of Object.entries(manifest.tiles ?? {})) {
          expect(frames.has(def.frame ?? ''), `tiles[${tileId}].frame ${def.frame}`).toBe(true);
        }
      });

      test(`[${packId}] every manifest props[y].frame exists in the atlas`, () => {
        for (const [propId, def] of Object.entries(manifest.props ?? {})) {
          expect(frames.has(def.frame ?? ''), `props[${propId}].frame ${def.frame}`).toBe(true);
        }
      });

      if (manifest.fallbackTile) {
        test(`[${packId}] fallbackTile exists in the atlas`, () => {
          expect(frames.has(manifest.fallbackTile ?? '')).toBe(true);
        });
      }

      // Every map: tileset block matches the atlas grid + GID bounds.
      for (const mapEntry of maps) {
        const mapPath = mapEntry?.file;
        if (!mapPath) {
          continue;
        }
        const map = readJson<MapJson>(join(packDir, mapPath));

        test(`[${packId}/${mapPath}] map tileset block matches the atlas grid`, () => {
          const block = map.tilesets[0];
          expect(block.firstgid).toBe(1);
          expect(block.imagewidth).toBe(atlas.meta.size.w);
          expect(block.imageheight).toBe(atlas.meta.size.h);
          expect(block.columns).toBe(16);
        });

        test(`[${packId}/${mapPath}] no tile GID exceeds the declared frame grid`, () => {
          // Highest numeric key from manifest.tiles — not the tile count, so
          // a manifest with non-sequential GIDs still bounds map data
          // correctly (CodeRabbit review, C-376).
          const declaredGids = Object.keys(manifest.tiles ?? {})
            .map(Number)
            .filter((gid) => Number.isInteger(gid));
          const maxGid = declaredGids.length > 0 ? Math.max(...declaredGids) : 0;
          for (const layer of map.layers) {
            if (layer.type !== 'tilelayer') {
              continue;
            }
            for (const gid of layer.data ?? []) {
              expect(gid, `${mapPath}/${layer.name} GID ${gid}`).toBeLessThanOrEqual(maxGid);
            }
          }
        });

        test(`[${packId}/${mapPath}] every prop spawn frame exists in the atlas`, () => {
          for (const layer of map.layers) {
            if (layer.name !== 'spawns') {
              continue;
            }
            for (const obj of layer.objects ?? []) {
              const frame = obj.properties.find((p) => p.name === 'frame')?.value as
                | string
                | undefined;
              if (frame) {
                expect(frames.has(frame), `${mapPath} spawn frame ${frame}`).toBe(true);
              }
            }
          }
        });

        test(`[${packId}/${mapPath}] collision layer matches manifest walkability`, () => {
          const tilesById = manifest.tiles ?? {};
          const ground = map.layers.find((l) => l.name === 'ground')?.data ?? [];
          const collision = map.layers.find((l) => l.name === 'collision')?.data ?? [];
          expect(ground.length).toBe(map.width * map.height);
          expect(collision.length).toBe(map.width * map.height);

          for (let i = 0; i < ground.length; i++) {
            const gid = ground[i];
            if (gid === 0) {
              continue;
            }
            const tileDef = tilesById[String(gid)];
            expect(
              tileDef,
              `${mapPath} cell ${i} GID ${gid} must be declared in manifest.tiles`,
            ).toBeDefined();
            if (tileDef?.isWalkable ?? true) {
              expect(collision[i], `${mapPath} cell ${i} walkable GID ${gid} must be open`).toBe(0);
            }
            // Manifest-declared non-walkable tiles may omit duplicated
            // collision cells — buildCollisionGrid derives their solidity
            // from the manifest at load (C-376 AC-1). Only the walkable-
            // GID-must-be-open direction is asserted here.
          }
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Emberwatch fixtures — the pack-specific expectations (C-376 AC-6 D4).
// ---------------------------------------------------------------------------

describe('Emberwatch content audit (C-375 AC-4 + C-376 AC-6 fixtures)', () => {
  const packDir = join(CONTENT_PACKS_ROOT, EMBERWATCH_FIXTURES.packId);
  const atlas = readJson<AtlasJson>(EMBERWATCH_FIXTURES.atlas.path);
  const frames = new Set(Object.keys(atlas.frames));
  const manifest = readJson<ManifestJson>(join(packDir, 'manifest.json'));

  test('atlas.json declares >= 32 frames at the fixture size', () => {
    expect(frames.size).toBeGreaterThanOrEqual(EMBERWATCH_FIXTURES.atlas.minFrames);
    expect(atlas.meta.size).toEqual(EMBERWATCH_FIXTURES.atlas.size);
  });

  test('fallbackTile grass.png exists in the atlas', () => {
    expect(manifest.fallbackTile).toBe(EMBERWATCH_FIXTURES.fallbackTile);
    expect(frames.has(EMBERWATCH_FIXTURES.fallbackTile)).toBe(true);
  });

  test('manifest declares every atlas frame in the 1..48 GID grid (no gaps)', () => {
    const declared = new Set(Object.keys(manifest.tiles ?? {}));
    for (const [frameName, cell] of Object.entries(atlas.frames)) {
      const gid = String((cell.frame.y / 32) * 16 + cell.frame.x / 32 + 1);
      expect(
        declared.has(gid),
        `atlas frame ${frameName} (GID ${gid}) must have a manifest tiles entry`,
      ).toBe(true);
    }
  });

  test('pack version bumped to the fixture version', () => {
    expect(manifest.version).toBe(EMBERWATCH_FIXTURES.version);
  });
});

describe('Emberwatch map audit (C-375 AC-5 + C-376 AC-6 fixtures)', () => {
  const packDir = join(CONTENT_PACKS_ROOT, EMBERWATCH_FIXTURES.packId);

  const maps: Record<string, MapJson> = {
    village: readJson<MapJson>(join(packDir, EMBERWATCH_MAP_FILES.village)),
    inn: readJson<MapJson>(join(packDir, EMBERWATCH_MAP_FILES.inn)),
    merchantShop: readJson<MapJson>(join(packDir, EMBERWATCH_MAP_FILES.merchantShop)),
  };

  test('all three maps keep their fixture footprints', () => {
    expect(maps.village.width).toBe(EMBERWATCH_FIXTURES.footprints.village.width);
    expect(maps.village.height).toBe(EMBERWATCH_FIXTURES.footprints.village.height);
    expect(maps.inn.width).toBe(EMBERWATCH_FIXTURES.footprints.inn.width);
    expect(maps.inn.height).toBe(EMBERWATCH_FIXTURES.footprints.inn.height);
    expect(maps.merchantShop.width).toBe(EMBERWATCH_FIXTURES.footprints.merchant_shop.width);
    expect(maps.merchantShop.height).toBe(EMBERWATCH_FIXTURES.footprints.merchant_shop.height);
  });

  test('map tileset blocks match the atlas grid (512×256, 16 cols, 128 tiles)', () => {
    for (const [, map] of Object.entries(maps)) {
      const block = map.tilesets[0];
      expect(block.firstgid).toBe(1);
      expect(block.imagewidth).toBe(EMBERWATCH_FIXTURES.atlas.size.w);
      expect(block.imageheight).toBe(EMBERWATCH_FIXTURES.atlas.size.h);
      expect(block.columns).toBe(EMBERWATCH_FIXTURES.atlas.columns);
      expect(block.tilecount).toBe(EMBERWATCH_FIXTURES.atlas.tilecount);
    }
  });

  test('spawn ids, transition targets, npc ids, and prop ids are stable (fixtures)', () => {
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

    for (const id of EMBERWATCH_FIXTURES.spawnIds) {
      expect(spawnIds.has(id), `spawn id ${id}`).toBe(true);
    }
    for (const id of EMBERWATCH_FIXTURES.npcIds) {
      expect(npcIds.has(id), `npc id ${id}`).toBe(true);
    }
    for (const id of EMBERWATCH_FIXTURES.propIds) {
      expect(propIds.has(id), `prop id ${id}`).toBe(true);
    }
    for (const target of EMBERWATCH_FIXTURES.transitionTargets) {
      expect(transitionTargets.has(target), `transition target ${target}`).toBe(true);
    }
  });
});

describe('C-376 AC-1 parity — buildCollisionGrid matches manifest solidity on committed maps', () => {
  const packDir = join(CONTENT_PACKS_ROOT, EMBERWATCH_FIXTURES.packId);
  const manifest = readJson<{
    tiles?: Record<
      string,
      { name?: string; frame?: string; isWalkable?: boolean; isWall?: boolean }
    >;
    props?: Record<string, unknown>;
  }>(join(packDir, 'manifest.json'));

  // Project the manifest onto the runtime PackConfig shape (same projection
  // the client builds in game_engine_service for LOAD_MAP).
  const packConfig: PackConfig = {
    tiles: Object.fromEntries(
      Object.entries(manifest.tiles ?? {}).map(([gid, def]) => [
        gid,
        {
          name: def.name ?? gid,
          frame: def.frame ?? '',
          isWalkable: def.isWalkable ?? true,
          isWall: def.isWall,
        },
      ]),
    ),
    props: Object.fromEntries(
      Object.entries(manifest.props ?? {}).map(([propId, def]) => [
        propId,
        {
          name: (def as { name?: string }).name ?? propId,
          frame: (def as { frame?: string }).frame ?? '',
          isWalkable: (def as { isWalkable?: boolean }).isWalkable,
        },
      ]),
    ),
  };

  /**
   * Explicit expected grid derived from the configured solidity manifest +
   * the explicit collision layer — the C-376 contract itself, independent of
   * the pre-C-376 water-merge internals (CodeRabbit review, C-376):
   *   - every manifest-declared non-walkable tile GID marks its cells solid
   *   - the collision layer adds solid cells on top (never re-opens)
   */
  const expectedGridFromManifest = (tilemap: TilemapData): boolean[] | undefined => {
    const tiles = packConfig.tiles;
    const totalCells = tilemap.width * tilemap.height;
    const grid = new Array<boolean>(totalCells).fill(false) as boolean[];
    let hasAnyBlocked = false;

    for (const layer of tilemap.layers) {
      if (layer.name === 'collision' || !Array.isArray(layer.data)) {
        continue;
      }
      for (let i = 0; i < totalCells; i++) {
        const gid = layer.data[i] ?? 0;
        if (gid === 0) {
          continue;
        }
        if (!tiles[String(gid)]?.isWalkable) {
          grid[i] = true;
          hasAnyBlocked = true;
        }
      }
    }

    const collisionLayer = tilemap.layers.find((l) => l.name === 'collision');
    if (collisionLayer) {
      for (let i = 0; i < totalCells; i++) {
        if (collisionLayer.data[i] !== 0) {
          grid[i] = true;
          hasAnyBlocked = true;
        }
      }
    }

    if (!hasAnyBlocked && !collisionLayer) {
      return undefined;
    }
    return grid;
  };

  test('buildCollisionGrid output matches the manifest-derived expectation on village/inn/merchant_shop', () => {
    const maps: Array<[string, string]> = [
      ['village', EMBERWATCH_MAP_FILES.village],
      ['inn', EMBERWATCH_MAP_FILES.inn],
      ['merchant_shop', EMBERWATCH_MAP_FILES.merchantShop],
    ];

    for (const [name, file] of maps) {
      const tilemap = readJson<TilemapData>(join(packDir, file));
      const expected = expectedGridFromManifest(tilemap);
      const derived = buildCollisionGrid(tilemap, packConfig);

      expect(derived, `${name}: derived grid defined`).toBeDefined();
      expect(expected, `${name}: expected grid defined`).toBeDefined();
      if (!derived || !expected) {
        continue;
      }
      expect(derived.length).toBe(expected.length);
      for (let i = 0; i < expected.length; i++) {
        expect(derived[i], `${name} cell ${i}`).toBe(expected[i]);
      }
    }
  });

  test('GID 2 (grass_variant) cells without a collision marker stay walkable (fixture)', () => {
    // C-376 A1 fixture against the REAL emberwatch manifest: a ground layer
    // with GID 2 scattered among grass + brick, no collision layer. The
    // manifest declares GID 2 walkable — buildCollisionGrid must leave those
    // cells open while brick stays solid.
    const tilemap: TilemapData = {
      width: 3,
      height: 1,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      layers: [
        {
          name: 'ground',
          width: 3,
          height: 1,
          data: [1, 2, 8], // grass, grass_variant, brick
          visible: true,
        },
      ],
    };

    const grid = buildCollisionGrid(tilemap, packConfig);

    expect(grid).toBeDefined();
    expect(grid?.[0]).toBe(false); // grass walkable
    expect(grid?.[1]).toBe(false); // GID 2 grass_variant walkable
    expect(grid?.[2]).toBe(true); // brick manifest-solid
  });
});
