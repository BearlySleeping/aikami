// packages/frontend/engine/src/__tests__/emberwatch_content_audit.test.ts
//
// C-375 AC-4 + AC-5 + C-376 AC-6 — per-pack static content integrity audit.
//
// Walks every pack under `content/packs/*` and validates
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
import { type ContentPackManifest, validatePack } from '@aikami/schemas';
import type { PackConfig } from '@aikami/types';
import { findDuplicateAtlasFrames } from '@aikami/utils';
import { buildCollisionGrid, type TilemapData } from '../assets/map_loader.ts';

// ---------------------------------------------------------------------------
// Fixture paths — the actual committed static content.
// ---------------------------------------------------------------------------

const CONTENT_PACKS_ROOT = join(import.meta.dir, '../../../../../content/packs');

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
    tilewidth?: number;
    columns: number;
    tilecount: number;
    spacing?: number;
    margin?: number;
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
      width?: number;
      height?: number;
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
  /**
   * Irregular prop-atlas pages. Oversized transparent props (a 192×152 ward
   * tree, a 256×224 inn) cannot live in the fixed 32px-cell grid atlas, so
   * their frames come from these pages instead. Frames are resolved by name
   * across the grid atlas and every page.
   */
  propAtlases?: Array<{ textureUrl?: string; spritesheetUrl?: string }>;
  tiles?: Record<string, { name?: string; frame?: string; isWalkable?: boolean; isWall?: boolean }>;
  props?: Record<string, { name?: string; frame?: string; isWalkable?: boolean }>;
  terrains?: Array<{
    name?: string;
    precedence?: number;
    wang?: string;
    frameBase?: string;
    variants?: string[];
    isWalkable?: boolean;
  }>;
  maps?: Record<string, { file?: string; interior?: boolean }>;
};

// ---------------------------------------------------------------------------
// Emberwatch fixtures (C-376 AC-6) — pack-specific expectations, not generic.
// ---------------------------------------------------------------------------

const EMBERWATCH_FIXTURES = {
  packId: 'emberwatch',
  // C-378: bumped for the new top-level `terrains` block + aikami map
  // channels — consumers that cache/gate on the pack version observe it.
  // C-495: the manifest was bumped to 4.1.0 for the dramatic-structure work
  // but this fixture was left at 4.0.0, so the version-drift gate had been
  // reporting a false failure ever since. Kept in sync with the manifest.
  // Gate 3/4 rebuild: bumped to 4.2.0 for the new maps, cast, evidence and
  // side quests.
  version: '4.2.0',
  atlas: {
    path: join(
      import.meta.dir,
      '../../../../../apps/frontend/client/static/game-data/sprites/tilesets/atlas.json',
    ),
    // C-378 AC-5: 1px extruded frames — 34px cell pitch, 544×272 atlas.
    // tileSize/spacing/margin mirror the map tileset blocks (asserted
    // below) so GID math derives from geometry instead of hardcoded 34/16/1.
    minFrames: 80,
    size: { w: 544, h: 272 },
    columns: 16,
    tilecount: 128,
    tileSize: 32,
    spacing: 2,
    margin: 1,
    maxGid: 48,
  },
  fallbackTile: 'grass.png',
  footprints: {
    // Gate 3: the retained scenes were expanded to the plan's proposed
    // extents; the two expansion maps already matched.
    village: { width: 64, height: 48 },
    inn: { width: 28, height: 20 },
    // biome-ignore lint/style/useNamingConvention: map file names use snake_case
    merchant_shop: { width: 24, height: 18 },
    // biome-ignore lint/style/useNamingConvention: map file names use snake_case
    old_road: { width: 72, height: 36 },
    // biome-ignore lint/style/useNamingConvention: map file names use snake_case
    ruined_shrine: { width: 40, height: 36 },
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
  // C-378: corner-16 terrain frame names derived from frameBase (mask order).
  terrainFrames: {
    dirt: 'dirt_0.png',
    water: 'water_0.png',
  },
} as const;

/** Maps the emberwatch fixture map keys to their file names. */
const EMBERWATCH_MAP_FILES = {
  village: 'maps/village.json',
  inn: 'maps/inn.json',
  merchantShop: 'maps/merchant_shop.json',
  oldRoad: 'maps/old_road.json',
  ruinedShrine: 'maps/ruined_shrine.json',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * C-378: derives the 16 mask-order frame names for a corner16 terrain from
 * its `frameBase` (mask 0). Validates the `_0.png` naming contract BEFORE
 * deriving — a frameBase that does not end in `_0.png` would silently
 * produce wrong mask names (the suffix replace would no-op), so invalid
 * naming must fail explicitly instead of generating garbage names.
 */
const terrainMaskFrameNames = (terrain: { name?: string; frameBase?: string }): string[] => {
  const frameBase = terrain.frameBase;
  if (!frameBase) {
    throw new Error(`terrain "${terrain.name}" is missing frameBase`);
  }
  if (!/_0\.png$/.test(frameBase)) {
    throw new Error(
      `terrain "${terrain.name}" frameBase "${frameBase}" must follow the _0.png naming contract (mask-0 frame)`,
    );
  }
  const names: string[] = [frameBase];
  for (let mask = 1; mask < 16; mask++) {
    names.push(frameBase.replace(/_0\.png$/, `_${mask}.png`));
  }
  return names;
};

/** Discovers every pack directory under content/packs/*. */
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

    // C-381 AC-5: validatePack is the single source of truth for manifest
    // validation. Assert it passes before running pack-specific checks.
    test(`[${packId}] validatePack passes`, () => {
      const result = validatePack({ manifest: manifest as unknown as ContentPackManifest });
      expect(result.errors, `${packId} validatePack errors`).toHaveLength(0);
    });

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

      // Guard atlas loading: a missing/unreadable atlas file must surface as
      // a named test failure, not abort collection for the whole pack
      // (CodeRabbit review, C-376 round 2).
      let atlas: AtlasJson | undefined;
      try {
        atlas = readJson<AtlasJson>(atlasPath);
      } catch {
        // Left undefined — the named test below reports the failure.
      }
      const frames = new Set(Object.keys(atlas?.frames ?? {}));

      // Frames contributed by the irregular prop-atlas pages. A prop frame
      // legitimately lives in either place; tile frames and the fallback tile
      // must still come from the grid atlas (asserted separately below).
      const propAtlasFrames = new Set<string>();
      /** Per-page frame ownership, so page↔page collisions are detectable. */
      const propAtlasFrameSources: { label: string; frames: string[] }[] = [];
      const propAtlasPages = manifest.propAtlases ?? [];
      /** Maps a manifest asset URL to its path under `static/`. */
      const staticPathFor = (assetUrl: string): string =>
        assetUrl.startsWith('/')
          ? join(import.meta.dir, `../../../../../apps/frontend/client/static${assetUrl}`)
          : assetUrl;

      for (const [pageIndex, page] of propAtlasPages.entries()) {
        // A page needs BOTH halves. Picking one via nullish coalescing would
        // accept a half-declared page and then check the wrong file.
        if (!page.textureUrl || !page.spritesheetUrl) {
          test(`[${packId}] propAtlases[${pageIndex}] declares both textureUrl and spritesheetUrl`, () => {
            expect({
              textureUrl: page.textureUrl ?? null,
              spritesheetUrl: page.spritesheetUrl ?? null,
            }).toEqual({ textureUrl: expect.any(String), spritesheetUrl: expect.any(String) });
          });
          continue;
        }
        const texturePath = staticPathFor(page.textureUrl);
        const sheetPath = staticPathFor(page.spritesheetUrl);
        test(`[${packId}] propAtlases[${pageIndex}] texture exists at ${page.textureUrl}`, () => {
          expect(existsSync(texturePath), `prop atlas texture ${texturePath} must exist`).toBe(
            true,
          );
        });
        test(`[${packId}] propAtlases[${pageIndex}] spritesheet exists at ${page.spritesheetUrl}`, () => {
          expect(existsSync(sheetPath), `prop atlas spritesheet ${sheetPath} must exist`).toBe(
            true,
          );
        });
        if (!existsSync(texturePath) || !existsSync(sheetPath)) {
          continue;
        }
        const pageDoc = readJson<AtlasJson>(sheetPath);
        // Record ownership per page so a duplicate BETWEEN pages is visible
        // rather than silently deduplicated into one set.
        propAtlasFrameSources.push({
          label: `propAtlases[${pageIndex}]`,
          frames: Object.keys(pageDoc.frames ?? {}),
        });
        for (const name of Object.keys(pageDoc.frames ?? {})) {
          propAtlasFrames.add(name);
        }
      }

      /** Every frame a prop may reference: the grid atlas or any page. */
      const propFrames = new Set([...frames, ...propAtlasFrames]);

      test(`[${packId}] atlas.json is readable at ${atlasUrl}`, () => {
        expect(atlas, `atlas ${atlasPath} must exist and parse`).toBeDefined();
      });

      // A missing atlas was reported by the named test above — skip the
      // remaining atlas-dependent checks for this pack so other discovered
      // packs still produce named results (CodeRabbit review, C-376 r2).
      if (!atlas) {
        continue;
      }

      test(`[${packId}] every manifest tiles[x].frame exists in the atlas`, () => {
        for (const [tileId, def] of Object.entries(manifest.tiles ?? {})) {
          expect(frames.has(def.frame ?? ''), `tiles[${tileId}].frame ${def.frame}`).toBe(true);
        }
      });

      test(`[${packId}] every manifest props[y].frame exists in the atlas or a prop-atlas page`, () => {
        for (const [propId, def] of Object.entries(manifest.props ?? {})) {
          expect(propFrames.has(def.frame ?? ''), `props[${propId}].frame ${def.frame}`).toBe(true);
        }
      });

      test(`[${packId}] a frame name is never declared by two atlas sources`, () => {
        // The resolver indexes frames by name across all sources and drops an
        // ambiguous name entirely, so a collision would silently degrade a
        // prop to the fallback tile. The pack build rejects it too.
        //
        // Checked across the grid atlas AND every page, so a name shared by two
        // prop-atlas pages is reported rather than deduplicated away.
        const duplicates = findDuplicateAtlasFrames([
          { label: 'atlas', frames: [...frames] },
          ...propAtlasFrameSources,
        ]);
        expect(duplicates.map((entry) => `${entry.name} (${entry.sources.join(', ')})`)).toEqual(
          [],
        );
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
          // Derive the expected column count from the atlas width and the
          // map's declared tile width instead of hardcoding 16, so a tileset
          // geometry change is caught here (CodeRabbit review, C-376 r2).
          // C-378 AC-5: frames are extruded — cell pitch is tilewidth + 2px
          // padding, so columns = imagewidth / (tilewidth + spacing).
          const tileWidth = block.tilewidth ?? 32;
          const spacing = block.spacing ?? 0;
          const pitch = tileWidth + spacing;
          expect(block.columns).toBe(Math.floor(atlas.meta.size.w / pitch));
          // C-378: extruded atlas declares a 1px margin (content offset).
          if (spacing > 0) {
            expect(block.margin).toBe(1);
          }
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

        test(`[${packId}/${mapPath}] every prop spawn frame exists in the atlas or a prop-atlas page`, () => {
          for (const layer of map.layers) {
            if (layer.name !== 'spawns') {
              continue;
            }
            for (const obj of layer.objects ?? []) {
              const frame = obj.properties.find((p) => p.name === 'frame')?.value as
                | string
                | undefined;
              if (frame) {
                expect(propFrames.has(frame), `${mapPath} spawn frame ${frame}`).toBe(true);
              }
            }
          }
        });

        test(`[${packId}/${mapPath}] collision layer matches manifest walkability`, () => {
          const tilesById = manifest.tiles ?? {};
          const ground = map.layers.find((l) => l.name === 'ground')?.data ?? [];
          const collisionLayer = map.layers.find((l) => l.name === 'collision');
          const collision = collisionLayer?.data ?? [];
          expect(ground.length).toBe(map.width * map.height);

          // Collision-layer assertions apply only when the map declares one
          // — maps may omit duplicated collision cells because
          // buildCollisionGrid derives non-walkable solidity from the
          // manifest at load (C-376 AC-1) (CodeRabbit review, C-376 r2).
          if (collisionLayer) {
            expect(collision.length, `${mapPath} collision layer dims`).toBe(
              map.width * map.height,
            );
          }

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
            // Walkable GIDs must never be blocked by the collision layer
            // (when one exists).
            if ((tileDef?.isWalkable ?? true) && collisionLayer) {
              expect(collision[i], `${mapPath} cell ${i} walkable GID ${gid} must be open`).toBe(0);
            }
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

  test('manifest declares every baked-GID atlas frame; terrain frames derive from terrains (C-378)', () => {
    // C-378: baked frames (GIDs 1..48) must each have a manifest.tiles
    // entry, and the corner-16 terrain frames must derive from the pack's
    // `terrains[].frameBase` in mask order (dirt_0..15, water_0..15). The
    // atlas is extruded 1px (34px pitch) — content lives at +1 offset.
    const declared = new Set(Object.keys(manifest.tiles ?? {}));
    const terrainFrameNames = new Set<string>();
    for (const terrain of manifest.terrains ?? []) {
      if (terrain.wang === 'corner16' && terrain.frameBase) {
        for (const name of terrainMaskFrameNames(terrain)) {
          terrainFrameNames.add(name);
        }
      }
    }
    // GID math derived from the atlas/tileset geometry (pitch = tileSize +
    // spacing, margin = 1, columns = 16) — never hardcoded 34/16/1, so a
    // packer change to spacing/margin keeps this correct.
    const cellPitch = EMBERWATCH_FIXTURES.atlas.tileSize + EMBERWATCH_FIXTURES.atlas.spacing;
    const atlasMargin = EMBERWATCH_FIXTURES.atlas.margin;
    const atlasColumns = EMBERWATCH_FIXTURES.atlas.columns;
    for (const [frameName, cell] of Object.entries(atlas.frames)) {
      const gid =
        Math.floor((cell.frame.y - atlasMargin) / cellPitch) * atlasColumns +
        Math.floor((cell.frame.x - atlasMargin) / cellPitch) +
        1;
      if (terrainFrameNames.has(frameName)) {
        expect(gid, `terrain frame ${frameName} outside baked GID grid`).toBeGreaterThan(
          EMBERWATCH_FIXTURES.atlas.maxGid,
        );
        continue;
      }
      expect(
        declared.has(String(gid)),
        `atlas frame ${frameName} (GID ${gid}) must have a manifest tiles entry`,
      ).toBe(true);
    }
  });

  test('corner-16 terrain frames all exist in the atlas (C-378)', () => {
    for (const terrain of manifest.terrains ?? []) {
      if (terrain.wang !== 'corner16' || !terrain.frameBase) {
        continue;
      }
      const names = terrainMaskFrameNames(terrain);
      for (let mask = 0; mask < names.length; mask++) {
        expect(
          frames.has(names[mask]),
          `terrain ${terrain.name} mask ${mask} frame ${names[mask]}`,
        ).toBe(true);
      }
    }
  });

  test('pack version bumped to the fixture version', () => {
    expect(manifest.version).toBe(EMBERWATCH_FIXTURES.version);
  });

  test('C-417 AC-2: inn and merchant_shop declare interior lighting, village does not', () => {
    // The interior-lighting property is declared generically per-map in the
    // manifest (`interior: true`) and projected into PackConfig by the
    // engine service — the engine never hard-codes map ids.
    expect(manifest.maps?.inn?.interior).toBe(true);
    expect(manifest.maps?.merchant_shop?.interior).toBe(true);
    expect(manifest.maps?.village?.interior).toBeUndefined();
  });
});

describe('Emberwatch map audit (C-375 AC-5 + C-376 AC-6 fixtures)', () => {
  const packDir = join(CONTENT_PACKS_ROOT, EMBERWATCH_FIXTURES.packId);

  const maps: Record<string, MapJson> = {
    village: readJson<MapJson>(join(packDir, EMBERWATCH_MAP_FILES.village)),
    inn: readJson<MapJson>(join(packDir, EMBERWATCH_MAP_FILES.inn)),
    merchantShop: readJson<MapJson>(join(packDir, EMBERWATCH_MAP_FILES.merchantShop)),
    oldRoad: readJson<MapJson>(join(packDir, EMBERWATCH_MAP_FILES.oldRoad)),
    ruinedShrine: readJson<MapJson>(join(packDir, EMBERWATCH_MAP_FILES.ruinedShrine)),
  };

  /** Manifest map id → parsed map, for cross-map transition checks. */
  const mapsById: Record<string, MapJson> = {
    village: maps.village,
    inn: maps.inn,
    // biome-ignore lint/style/useNamingConvention: map file names use snake_case
    merchant_shop: maps.merchantShop,
    // biome-ignore lint/style/useNamingConvention: map file names use snake_case
    old_road: maps.oldRoad,
    // biome-ignore lint/style/useNamingConvention: map file names use snake_case
    ruined_shrine: maps.ruinedShrine,
  };

  const objectsOf = (map: MapJson, layerName: string) =>
    map.layers.find((layer) => layer.name === layerName)?.objects ?? [];

  const propsOf = (object: { properties: Array<{ name: string; value: unknown }> }) =>
    Object.fromEntries(object.properties.map((p) => [p.name, p.value]));

  test('all five maps keep their fixture footprints', () => {
    const pairs = [
      ['village', maps.village],
      ['inn', maps.inn],
      ['merchant_shop', maps.merchantShop],
      ['old_road', maps.oldRoad],
      ['ruined_shrine', maps.ruinedShrine],
    ] as const;
    for (const [name, map] of pairs) {
      expect(map.width, `${name} width`).toBe(EMBERWATCH_FIXTURES.footprints[name].width);
      expect(map.height, `${name} height`).toBe(EMBERWATCH_FIXTURES.footprints[name].height);
    }
  });

  test('map tileset blocks match the atlas grid (544×272 extruded, 16 cols, 128 tiles)', () => {
    for (const [, map] of Object.entries(maps)) {
      const block = map.tilesets[0];
      expect(block.firstgid).toBe(1);
      expect(block.imagewidth).toBe(EMBERWATCH_FIXTURES.atlas.size.w);
      expect(block.imageheight).toBe(EMBERWATCH_FIXTURES.atlas.size.h);
      expect(block.columns).toBe(EMBERWATCH_FIXTURES.atlas.columns);
      expect(block.tilecount).toBe(EMBERWATCH_FIXTURES.atlas.tilecount);
      // C-378 AC-5: extruded frames — 2px spacing, 1px margin (derived
      // from the fixture so the atlas and tileset blocks cannot drift).
      expect(block.spacing).toBe(EMBERWATCH_FIXTURES.atlas.spacing);
      expect(block.margin).toBe(EMBERWATCH_FIXTURES.atlas.margin);
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

  // ── Gate 3/5: resized-scene compatibility ───────────────────────────────
  // The retained maps grew from 20×20 / 16×12 / 16×12. These guards ensure the
  // repositioned markers still describe a loadable, reciprocal world.

  test('every spawn and transition marker stays inside its map extent (gate 3 resize)', () => {
    for (const [mapId, map] of Object.entries(mapsById)) {
      const boundsW = map.width * 32;
      const boundsH = map.height * 32;
      for (const layerName of ['spawns', 'transitions']) {
        for (const obj of objectsOf(map, layerName)) {
          const label = `${mapId} ${layerName} object ${obj.id} (${obj.type})`;
          expect(obj.x, `${label} x`).toBeGreaterThanOrEqual(0);
          expect(obj.y, `${label} y`).toBeGreaterThanOrEqual(0);
          expect(obj.x, `${label} x origin`).toBeLessThan(boundsW);
          expect(obj.y, `${label} y origin`).toBeLessThan(boundsH);
          expect(obj.x + (obj.width ?? 0), `${label} x+width`).toBeLessThanOrEqual(boundsW);
          expect(obj.y + (obj.height ?? 0), `${label} y+height`).toBeLessThanOrEqual(boundsH);
        }
      }
    }
  });

  test('every transition resolves a target spawn on its target map (reciprocity)', () => {
    for (const [mapId, map] of Object.entries(mapsById)) {
      for (const obj of objectsOf(map, 'transitions')) {
        const props = propsOf(obj);
        const targetMapId = String(props.targetMap);
        const targetSpawnId = String(props.targetSpawnId);
        const target = mapsById[targetMapId];
        const label = `${mapId} -> ${targetMapId} (${targetSpawnId})`;
        expect(target, `${label} target map exists`).toBeDefined();
        const spawnIds = new Set(
          objectsOf(target, 'spawns')
            .filter((o) => o.type === 'spawn')
            .map((o) => String(propsOf(o).spawnId)),
        );
        expect(spawnIds.has(targetSpawnId), `${label} spawn marker exists`).toBe(true);

        // The loader drops a transition whose numeric fallback is missing.
        expect(typeof props.targetX, `${label} targetX numeric`).toBe('number');
        expect(typeof props.targetY, `${label} targetY numeric`).toBe('number');
        expect(Number(props.targetX), `${label} targetX in bounds`).toBeGreaterThanOrEqual(0);
        expect(Number(props.targetY), `${label} targetY in bounds`).toBeGreaterThanOrEqual(0);
        expect(Number(props.targetX), `${label} targetX in bounds`).toBeLessThan(target.width * 32);
        expect(Number(props.targetY), `${label} targetY in bounds`).toBeLessThan(
          target.height * 32,
        );
        expect(
          (obj.width ?? 0) > 0 && (obj.height ?? 0) > 0,
          `${label} trigger rect is non-degenerate`,
        ).toBe(true);
      }
    }
  });

  test('every spawn marker lands on a non-colliding cell', () => {
    for (const [mapId, map] of Object.entries(mapsById)) {
      const collision = map.layers.find((layer) => layer.name === 'collision')?.data;
      expect(collision, `${mapId} has a collision layer`).toBeDefined();
      for (const obj of objectsOf(map, 'spawns').filter((o) => o.type === 'spawn')) {
        const col = Math.floor(obj.x / 32);
        const row = Math.floor(obj.y / 32);
        expect(
          collision?.[row * map.width + col],
          `${mapId} spawn ${propsOf(obj).spawnId} at cell (${col},${row})`,
        ).toBe(0);
      }
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
    if (collisionLayer && Array.isArray(collisionLayer.data)) {
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

// ---------------------------------------------------------------------------
// C-378 AC-6 — terrain channel validation + conversion parity on committed maps
// ---------------------------------------------------------------------------

describe('C-378 AC-6 — terrain channel audit on committed maps', () => {
  const packDir = join(CONTENT_PACKS_ROOT, EMBERWATCH_FIXTURES.packId);
  const manifest = readJson<ManifestJson>(join(packDir, 'manifest.json'));
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
    props: {},
    terrains: manifest.terrains as PackConfig['terrains'],
  };

  const maps: Array<[string, string]> = [
    ['village', EMBERWATCH_MAP_FILES.village],
    ['inn', EMBERWATCH_MAP_FILES.inn],
    ['merchant_shop', EMBERWATCH_MAP_FILES.merchantShop],
  ];

  test('every terrain id in each map exists in the pack terrains block', () => {
    const terrainNames = new Set((manifest.terrains ?? []).map((t) => t.name ?? ''));
    for (const [, file] of maps) {
      const map = readJson<{ aikami?: { terrain?: string[] } }>(join(packDir, file));
      const terrain = map.aikami?.terrain ?? [];
      for (const id of terrain) {
        if (id === '') {
          continue; // '' = the pack's base terrain
        }
        expect(terrainNames.has(id), `${file} terrain id "${id}"`).toBe(true);
      }
    }
  });

  test('terrain-derived collision equals the pre-conversion GID-derived grid cell-for-cell', () => {
    // Conversion correctness proof: walk each committed map with its terrain
    // channel (terrain-derived path) and WITHOUT it (legacy GID path, ground
    // band only). The grids must be byte-identical — if this fails, the
    // converter's name → terrain inversion is wrong, not the engine.
    for (const [name, file] of maps) {
      const raw = readJson<MapJson & { aikami?: { terrain?: string[] } }>(join(packDir, file));
      const tilemap: TilemapData = {
        width: raw.width,
        height: raw.height,
        tilewidth: 32,
        tileheight: 32,
        tilesets: raw.tilesets.map((t) => ({
          firstgid: t.firstgid,
          name: 'atlas',
          image: '',
          imagewidth: t.imagewidth,
          imageheight: t.imageheight,
          tilewidth: t.tilewidth ?? 32,
          tileheight: t.tilewidth ?? 32,
          columns: t.columns,
          tilecount: t.tilecount,
          spacing: t.spacing ?? 0,
          margin: t.margin ?? 0,
        })),
        layers: raw.layers
          .filter((l) => l.type === 'tilelayer')
          .map((l) => ({
            name: l.name,
            width: raw.width,
            height: raw.height,
            data: [...(l.data ?? [])],
            visible: true,
          })),
        terrain: raw.aikami?.terrain,
      };

      const derived = buildCollisionGrid(tilemap, packConfig);
      const legacy = buildCollisionGrid({ ...tilemap, terrain: undefined }, packConfig, {
        solidityLayers: ['ground'],
      });

      expect(derived, `${name}: terrain-derived grid defined`).toBeDefined();
      expect(legacy, `${name}: legacy grid defined`).toBeDefined();
      if (!derived || !legacy) {
        continue;
      }
      expect(derived.length).toBe(legacy.length);
      for (let i = 0; i < derived.length; i++) {
        expect(derived[i], `${name} cell ${i} parity`).toBe(legacy[i]);
      }
    }
  });

  test('base terrain is the lowest-precedence fill (grass) and every corner16 terrain has 16 frames', () => {
    const terrains = [...(manifest.terrains ?? [])].sort(
      (a, b) => (a.precedence ?? 0) - (b.precedence ?? 0),
    );
    expect(terrains.length).toBeGreaterThanOrEqual(2);
    expect(terrains[0]?.wang).toBe('fill');
    expect(terrains[0]?.name).toBe('grass');
    for (const t of terrains) {
      if (t.wang === 'corner16') {
        expect(t.frameBase).toBeDefined();
      }
    }
  });
});
