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
import { dirname, join } from 'node:path';
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
// Emit map JSON
// ---------------------------------------------------------------------------

const emit = (
  mapName: string,
  { map: m, objectLayers }: { map: MapData; objectLayers: MapObjectLayer[] },
): void => {
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

  // Overlay `overheadExtra` tiles (e.g. the gate arch). Collision and the
  // terrain channel are untouched, so byte-parity holds.
  for (const [c, r, gid] of m.overheadExtra ?? []) {
    if (c < 0 || c >= m.width || r < 0 || r >= m.height) {
      continue;
    }
    overhead[idx(m, c, r)] = gid;
  }

  // Terrain-only materials with no baked tile GID write the terrain
  // channel directly; the ground GID stays the base fill.
  for (const [c, r, terrain] of m.terrainOverrides ?? []) {
    if (c < 0 || c >= m.width || r < 0 || r >= m.height) {
      continue;
    }
    terrainChannel[idx(m, c, r)] = terrain;
  }

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
        data: m.ground,
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

  const outPath = join(
    dirname(fileURLToPath(import.meta.url)),
    `../../../../content/packs/emberwatch/maps/${mapName}.json`,
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(mapJson, null, 2)}\n`);
  console.log(`Wrote ${mapName}.json (${m.width}x${m.height})`);
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = (): void => {
  emit('village', buildVillage());
  emit('inn', buildInn());
  emit('merchant_shop', buildShop());
  emit('old_road', buildOldRoad());
  emit('ruined_shrine', buildRuinedShrine());
};

main();
