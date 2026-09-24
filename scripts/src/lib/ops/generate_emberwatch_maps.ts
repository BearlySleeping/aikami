// scripts/src/lib/ops/generate_emberwatch_maps.ts
//
// Rebuilds the five Emberwatch maps around the regenerated coherent atlas.
// The retained scenes were expanded to the plan's proposed extents (gate 3):
// village 64×48, inn 28×20, merchant_shop 24×18. The two expansion maps stay
// at old_road 72×36 and ruined_shrine 40×36.
//
// Every spawn id, transition target, prop id, and NPC id is PRESERVED
// (saves + quest objectives depend on them) — enforced by the golden checks
// in `generate_emberwatch_maps.test.ts`. The map tileset block is derived
// from the shared tables module so it cannot drift from the atlas generator.
//
// Run: bun scripts/src/lib/ops/generate_emberwatch_maps.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInn, buildShop, buildVillage } from './emberwatch_map_retained.ts';
import { idx, type MapData, type MapObjectLayer } from './emberwatch_map_shared.ts';
import { buildOldRoad, buildRuinedShrine } from './generate_emberwatch_maps_extra.ts';
import {
  ATLAS_CELL,
  ATLAS_COLS,
  ATLAS_HEIGHT,
  ATLAS_PADDING,
  ATLAS_TILE_COUNT,
  ATLAS_TILE_SIZE,
  ATLAS_WIDTH,
  buildG,
  readManifestTerrains,
  readManifestTiles,
} from './generate_emberwatch_tables.ts';

export type { MapData, MapObjectLayer, SpawnObject } from './emberwatch_map_shared.ts';

const G = buildG();

/**
 * GID → manifest tile name, derived from the manifest (C-378 terrain
 * channel derivation). Inverse of the `buildG` alias map — GIDs that are
 * not declared in the manifest resolve to undefined and stay baked GIDs.
 */
const GID_TO_NAME: Map<number, string> = (() => {
  const tiles = readManifestTiles();
  const map = new Map<number, string>();
  for (const [gid, def] of Object.entries(tiles)) {
    map.set(Number(gid), def.name);
  }
  return map;
})();

const TILESET_BLOCK = {
  firstgid: 1,
  name: 'atlas',
  image: '/game-data/sprites/tilesets/atlas.webp',
  imagewidth: ATLAS_WIDTH,
  imageheight: ATLAS_HEIGHT,
  tilewidth: ATLAS_TILE_SIZE,
  tileheight: ATLAS_TILE_SIZE,
  columns: ATLAS_COLS,
  tilecount: ATLAS_TILE_COUNT,
  spacing: ATLAS_CELL - ATLAS_TILE_SIZE, // 2 — gap between frames
  margin: ATLAS_PADDING, // 1
};

// ---------------------------------------------------------------------------
// Explicit contribution application
// ---------------------------------------------------------------------------

type Contribution = readonly [number, number, number];
type LayerBuffers = {
  ground: number[];
  decor: number[];
  overhead: number[];
  terrainChannel: string[];
};

const contributionInBounds = (map: MapData, c: number, r: number): boolean =>
  Number.isInteger(c) && Number.isInteger(r) && c >= 0 && c < map.width && r >= 0 && r < map.height;

const cellKey = (c: number, r: number): string => `${c},${r}`;

const applyGroundContributions = (options: {
  map: MapData;
  extras: ReadonlyArray<Contribution> | undefined;
  layers: LayerBuffers;
  terrainNameToId: ReadonlyMap<string, string>;
}): Set<string> => {
  const { map, extras, layers, terrainNameToId } = options;
  const cells = new Set<string>();
  for (const [c, r, gid] of extras ?? []) {
    if (!contributionInBounds(map, c, r)) {
      continue;
    }
    const index = idx(map, c, r);
    layers.ground[index] = gid;
    layers.decor[index] = 0;
    layers.overhead[index] = 0;
    cells.add(cellKey(c, r));
    const tileName = GID_TO_NAME.get(gid);
    layers.terrainChannel[index] = tileName ? (terrainNameToId.get(tileName) ?? '') : '';
  }
  return cells;
};

const applyDecorContributions = (options: {
  map: MapData;
  extras: ReadonlyArray<Contribution> | undefined;
  layers: LayerBuffers;
  groundCells: ReadonlySet<string>;
}): Set<string> => {
  const { map, extras, layers, groundCells } = options;
  const cells = new Set<string>();
  for (const [c, r, gid] of extras ?? []) {
    if (!contributionInBounds(map, c, r)) {
      continue;
    }
    const key = cellKey(c, r);
    if (groundCells.has(key)) {
      throw new Error(
        `generate_emberwatch_maps: cell (${c},${r}) has both ground and decor contributions`,
      );
    }
    layers.decor[idx(map, c, r)] = gid;
    layers.overhead[idx(map, c, r)] = 0;
    cells.add(key);
  }
  return cells;
};

const applyOverheadContributions = (options: {
  map: MapData;
  extras: ReadonlyArray<Contribution> | undefined;
  layers: LayerBuffers;
  lowerBandCells: ReadonlySet<string>;
}): void => {
  const { map, extras, layers, lowerBandCells } = options;
  for (const [c, r, gid] of extras ?? []) {
    if (!contributionInBounds(map, c, r)) {
      continue;
    }
    const key = cellKey(c, r);
    if (lowerBandCells.has(key)) {
      throw new Error(
        `generate_emberwatch_maps: cell (${c},${r}) has both lower-band and overhead contributions`,
      );
    }
    layers.overhead[idx(map, c, r)] = gid;
  }
};

const applyTerrainOverrides = (options: {
  map: MapData;
  overrides: ReadonlyArray<readonly [number, number, string]> | undefined;
  layers: LayerBuffers;
  protectedCells: ReadonlySet<string>;
}): void => {
  const { map, overrides, layers, protectedCells } = options;
  for (const [c, r, terrain] of overrides ?? []) {
    if (!contributionInBounds(map, c, r)) {
      continue;
    }
    const key = cellKey(c, r);
    if (protectedCells.has(key)) {
      throw new Error(
        `generate_emberwatch_maps: terrain override (${c},${r}) overlaps an explicit ground contribution`,
      );
    }
    layers.terrainChannel[idx(map, c, r)] = terrain;
  }
};

// ---------------------------------------------------------------------------
// Build map JSON
// ---------------------------------------------------------------------------

/**
 * Builds the runtime Tiled JSON for one map, deterministically. Exported (and
 * pure) so the map-compile-stability test can compare the builder output to the
 * committed maps without writing to the repository.
 */
export const buildMapJson = ({
  map: m,
  objectLayers,
}: {
  map: MapData;
  objectLayers: MapObjectLayer[];
}): { json: unknown; width: number; height: number } => {
  // C-378: derive the semantic terrain channel from the ground layer by
  // inverting `tiles[gid].name` → terrain id. Cells whose GID is not a
  // declared terrain (walls, roofs, furniture) stay hand-placed GIDs.
  const terrains = readManifestTerrains();
  const frameToTileName = new Map<string, string>();
  for (const def of Object.values(readManifestTiles())) {
    frameToTileName.set(def.frame, def.name);
  }
  const terrainNameToId = new Map<string, string>();
  for (const t of terrains) {
    terrainNameToId.set(t.name, t.name);
    for (const variantFrame of t.variants ?? []) {
      const variantTileName = frameToTileName.get(variantFrame);
      if (variantTileName) {
        terrainNameToId.set(variantTileName, t.name);
      }
    }
  }
  const ground = [...m.ground];
  const decor: number[] = [];
  const overhead: number[] = [];
  const terrainChannel: string[] = [];
  const overheadGids = new Set([G.ROOF]);
  for (const gid of m.ground) {
    const tileName = gid === 0 ? undefined : GID_TO_NAME.get(gid);
    const terrainId = tileName ? terrainNameToId.get(tileName) : undefined;
    terrainChannel.push(terrainId ?? '');
    if (terrainId) {
      decor.push(0);
      overhead.push(0);
    } else if (gid === 0) {
      decor.push(0);
      overhead.push(0);
    } else if (overheadGids.has(gid)) {
      decor.push(0);
      overhead.push(gid);
    } else {
      decor.push(gid);
      overhead.push(0);
    }
  }

  // Explicit contributions are authored after the baked layer split. Ground
  // owns architectural silhouettes; decor owns contact decals; overhead owns
  // walk-behind roof cells. Each helper rejects lower/upper band collisions.
  const layers: LayerBuffers = { ground, decor, overhead, terrainChannel };
  const groundExtraCells = applyGroundContributions({
    map: m,
    extras: m.groundExtra,
    layers,
    terrainNameToId,
  });
  const decorExtraCells = applyDecorContributions({
    map: m,
    extras: m.decorExtra,
    layers,
    groundCells: groundExtraCells,
  });
  applyOverheadContributions({
    map: m,
    extras: m.overheadExtra,
    layers,
    lowerBandCells: new Set([...groundExtraCells, ...decorExtraCells]),
  });
  applyTerrainOverrides({
    map: m,
    overrides: m.terrainOverrides,
    layers,
    protectedCells: groundExtraCells,
  });

  // A map whose terrain channel is ALL empty (interior maps like the inn)
  // OMITS the terrain property entirely. A present-but-empty channel would
  // flip the renderer into the autotiled terrain path.
  const hasAnyTerrain = terrainChannel.some((id) => id !== '');
  const mapJson = {
    compressionlevel: -1,
    width: m.width,
    height: m.height,
    tilewidth: 32,
    tileheight: 32,
    infinite: false,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    tilesets: [TILESET_BLOCK],
    aikami: {
      formatVersion: 1,
      ...(hasAnyTerrain ? { terrain: terrainChannel } : {}),
      elevation: new Array(m.width * m.height).fill(0),
    },
    layers: [
      {
        name: 'ground',
        type: 'tilelayer',
        width: m.width,
        height: m.height,
        visible: true,
        properties: [{ name: 'band', type: 'string', value: 'ground' }],
        data: ground,
      },
      {
        name: 'decor',
        type: 'tilelayer',
        width: m.width,
        height: m.height,
        visible: true,
        properties: [{ name: 'band', type: 'string', value: 'decor' }],
        data: decor,
      },
      {
        name: 'overhead',
        type: 'tilelayer',
        width: m.width,
        height: m.height,
        visible: true,
        properties: [{ name: 'band', type: 'string', value: 'overhead' }],
        data: overhead,
      },
      {
        name: 'collision',
        type: 'tilelayer',
        width: m.width,
        height: m.height,
        visible: false,
        data: m.collision,
      },
      ...objectLayers,
    ],
  };

  return { json: mapJson, width: m.width, height: m.height };
};

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

/** The five map builders, keyed by map id. */
export const EMBERWATCH_MAP_BUILDERS: Record<
  string,
  () => { map: MapData; objectLayers: MapObjectLayer[] }
> = {
  village: buildVillage,
  inn: buildInn,
  merchant_shop: buildShop,
  old_road: buildOldRoad,
  ruined_shrine: buildRuinedShrine,
};

/** Output directory; `EMBERWATCH_MAP_OUT` lets tests write to a temp dir. */
const mapOutDir = (): string =>
  process.env.EMBERWATCH_MAP_OUT
    ? resolve(process.env.EMBERWATCH_MAP_OUT)
    : join(dirname(fileURLToPath(import.meta.url)), '../../../../content/packs/emberwatch/maps');

const emit = (mapName: string): void => {
  const builder = EMBERWATCH_MAP_BUILDERS[mapName];
  if (!builder) {
    throw new Error(`generate_emberwatch_maps: no builder for map "${mapName}"`);
  }
  const { json, width, height } = buildMapJson(builder());
  const outPath = join(mapOutDir(), `${mapName}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`Wrote ${mapName}.json (${width}x${height})`);
};

const main = (): void => {
  for (const mapName of Object.keys(EMBERWATCH_MAP_BUILDERS)) {
    emit(mapName);
  }
};

if (import.meta.main) {
  main();
}
