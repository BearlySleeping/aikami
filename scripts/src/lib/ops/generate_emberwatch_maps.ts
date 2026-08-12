// scripts/src/lib/ops/generate_emberwatch_maps.ts
//
// Rebuilds the three Emberwatch maps (C-375 AC-5) around the regenerated
// coherent atlas: visible stone walls + wall-top rims, distinct floors
// (grass village, wood inn, stone shop), paths, plaza, well/board pads,
// houses with roofs, and interior furniture decor.
//
// Every spawn id, transition target, prop id, and NPC id from the previous
// maps is PRESERVED (saves + quest objectives depend on them). The map
// tileset block is updated to match the new atlas (512×256, 16 columns,
// tilecount 128, firstgid 1).
//
// Run: bun scripts/src/lib/ops/generate_emberwatch_maps.ts

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

// ---------------------------------------------------------------------------
// Tile GIDs — DERIVED from manifest.tiles (C-376 AC-6 D5)
//
// The manifest is the single source of truth for the GID↔frame mapping.
// Semantic keys (GRASS, PATH, ...) map to manifest tile names; the numeric
// GID is looked up from the manifest so a manifest edit is the ONLY change
// needed to retile the generator.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32). */
const makeRng = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type MapData = {
  width: number;
  height: number;
  ground: number[];
  collision: number[];
};

const makeMap = (width: number, height: number): MapData => ({
  width,
  height,
  ground: new Array<number>(width * height).fill(G.GRASS),
  collision: new Array<number>(width * height).fill(0),
});

const idx = (m: MapData, col: number, row: number): number => row * m.width + col;

const setTile = (m: MapData, col: number, row: number, gid: number): void => {
  if (col < 0 || col >= m.width || row < 0 || row >= m.height) {
    return;
  }
  m.ground[idx(m, col, row)] = gid;
};

const fillRect = (
  m: MapData,
  c0: number,
  r0: number,
  c1: number,
  r1: number,
  gid: number,
): void => {
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      setTile(m, c, r, gid);
    }
  }
};

const block = (m: MapData, col: number, row: number): void => {
  if (col < 0 || col >= m.width || row < 0 || row >= m.height) {
    return;
  }
  m.collision[idx(m, col, row)] = 1;
};

const blockRect = (m: MapData, c0: number, r0: number, c1: number, r1: number): void => {
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      block(m, c, r);
    }
  }
};

/**
 * Scatters `gid` across cells currently holding `baseGid`, using a
 * deterministic mask. `baseGid` is explicit so variant tiles apply to the
 * actual interior floor (e.g. WOOD_VAR on WOOD_FLOOR, FLAGSTONE on
 * STONE_FLOOR) instead of hard-coding G.GRASS, which silently no-ops on
 * indoor maps (CodeRabbit review, C-375).
 */
const scatter = (
  m: MapData,
  rng: () => number,
  c0: number,
  r0: number,
  c1: number,
  r1: number,
  baseGid: number,
  gid: number,
  probability: number,
): void => {
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (m.ground[idx(m, c, r)] === baseGid && rng() < probability) {
        setTile(m, c, r, gid);
      }
    }
  }
};

// ---------------------------------------------------------------------------
// Village — 20×20
// ---------------------------------------------------------------------------

const buildVillage = (): MapData => {
  const m = makeMap(20, 20);
  const rng = makeRng(0xc375);
  const W = 20;
  const H = 20;

  // Border walls with transition gaps at rows 9-11 (left/right) and the
  // gate gap at cols 9-10 (bottom).
  for (let c = 0; c < W; c++) {
    setTile(m, c, 0, G.STONE_WALL);
    setTile(m, c, H - 1, G.STONE_WALL);
    block(m, c, 0);
    block(m, c, H - 1);
  }
  for (let r = 1; r < H - 1; r++) {
    setTile(m, 0, r, G.STONE_WALL);
    setTile(m, W - 1, r, G.STONE_WALL);
    block(m, 0, r);
    block(m, W - 1, r);
  }
  // Transition gaps (left: rows 8-12, right: rows 8-12) — walkable openings.
  // The gap spans 5 rows so the player's 32px bounding box (which extends
  // upward from the feet) fits through while the feet land in the zone rect
  // (rows 9-11).
  for (let r = 8; r <= 12; r++) {
    setTile(m, 0, r, G.PATH);
    setTile(m, W - 1, r, G.PATH);
    m.collision[idx(m, 0, r)] = 0;
    m.collision[idx(m, W - 1, r)] = 0;
  }
  // Gate gap (bottom: cols 9-10, row 18) — walkable opening.
  setTile(m, 9, 18, G.PATH);
  setTile(m, 10, 18, G.PATH);
  setTile(m, 9, 19, G.PATH);
  setTile(m, 10, 19, G.PATH);
  m.collision[idx(m, 9, 18)] = 0;
  m.collision[idx(m, 10, 18)] = 0;
  m.collision[idx(m, 9, 19)] = 0;
  m.collision[idx(m, 10, 19)] = 0;

  // Wall-top rim one tile inside the border (not on gaps).
  for (let c = 1; c < W - 1; c++) {
    if (m.ground[idx(m, c, 1)] === G.STONE_WALL) {
      continue;
    }
    setTile(m, c, 1, G.WALL_TOP);
    block(m, c, 1);
  }
  for (let r = 2; r < H - 2; r++) {
    // Rim cols 1 and 18 — but leave the transition gaps at rows 8-12
    // walkable so the player's bounding box fits through to the exits.
    if (r >= 8 && r <= 12) {
      continue;
    }
    setTile(m, 1, r, G.WALL_TOP);
    setTile(m, W - 2, r, G.WALL_TOP);
    block(m, 1, r);
    block(m, W - 2, r);
  }
  // Rim row just above the bottom border (row H-2), except the gate gap at
  // cols 9-10 — visible wall-top rim with matching collision. Runs AFTER the
  // r loop (the loop's bound excludes H-2, so the rim used to never emit).
  for (let c = 2; c < W - 2; c++) {
    if (c === 9 || c === 10) {
      continue;
    }
    setTile(m, c, H - 2, G.WALL_TOP);
    block(m, c, H - 2);
  }

  // Scatter grass patches across the interior.
  scatter(m, rng, 2, 2, 17, 17, G.GRASS, G.GRASS_DARK, 0.14);
  scatter(m, rng, 2, 2, 17, 17, G.GRASS, G.DIRT, 0.05);

  // Paths: horizontal row 10 (left → right transitions) + vertical cols 9-10
  // (gate → plaza). Dirt edges flank the paths.
  for (let c = 2; c <= 17; c++) {
    setTile(m, c, 10, G.PATH);
  }
  for (let r = 6; r <= 17; r++) {
    setTile(m, 9, r, G.PATH);
    setTile(m, 10, r, G.PATH);
  }
  for (let c = 2; c <= 17; c++) {
    setTile(m, c, 9, G.DIRT);
    setTile(m, c, 11, G.DIRT);
  }
  for (let r = 7; r <= 16; r++) {
    if (r % 2 === 0) {
      setTile(m, 8, r, G.DIRT);
      setTile(m, 11, r, G.DIRT);
    }
  }

  // Elder's plaza (stone floor) around (288,192) = col 9, row 6.
  fillRect(m, 7, 4, 12, 7, G.STONE_FLOOR);
  // Path tiles merge into the plaza.
  for (let r = 6; r <= 7; r++) {
    setTile(m, 9, r, G.STONE_FLOOR);
    setTile(m, 10, r, G.STONE_FLOOR);
  }

  // Well pad around (160,384) = col 5, row 12.
  fillRect(m, 4, 11, 6, 13, G.STONE_FLOOR);

  // Notice-board pad around (448,352) = col 14, row 11.
  fillRect(m, 13, 10, 15, 12, G.STONE_FLOOR);

  // C-378: village pond (cols 11-13, rows 15-17) — the autotiled water
  // overlay demonstrates grass/dirt/water edges in the production map.
  // Water terrain is non-walkable; the explicit collision layer marks the
  // pond solid so BOTH the terrain-derived and legacy GID-derived paths
  // agree cell-for-cell. Placed between the vertical path (cols 9-10) and
  // the SE house (cols 14-17) in previously-open grass.
  //
  // A 1-tile dirt border surrounds the pond so the corner-16 transitions
  // (dirt corners cut by water) are visible — water over open grass renders
  // straight edges (grass is the base fill and has no corner frames). The
  // ring stops at row 17 so it never overwrites the bottom wall-rim row 18.
  for (let r = 15; r <= 17; r++) {
    for (let c = 11; c <= 13; c++) {
      setTile(m, c, r, G.WATER);
      block(m, c, r);
    }
  }
  for (let r = 14; r <= 17; r++) {
    for (let c = 10; c <= 14; c++) {
      if (m.ground[idx(m, c, r)] === G.WATER) {
        continue;
      }
      setTile(m, c, r, G.DIRT);
    }
  }

  // Houses: wall shell + roof interior + door opening.
  const house = (c0: number, r0: number): void => {
    // shell (cols c0..c0+3, rows r0..r0+3)
    for (let c = c0; c <= c0 + 3; c++) {
      setTile(m, c, r0, G.STONE_WALL);
      setTile(m, c, r0 + 3, G.STONE_WALL);
      block(m, c, r0);
      block(m, c, r0 + 3);
    }
    for (let r = r0 + 1; r <= r0 + 2; r++) {
      setTile(m, c0, r, G.STONE_WALL);
      setTile(m, c0 + 3, r, G.STONE_WALL);
      block(m, c0, r);
      block(m, c0 + 3, r);
    }
    // roof interior
    fillRect(m, c0 + 1, r0 + 1, c0 + 2, r0 + 2, G.ROOF);
    blockRect(m, c0 + 1, r0 + 1, c0 + 2, r0 + 2);
    // door (bottom wall, 2 tiles) — walkable opening
    setTile(m, c0 + 1, r0 + 3, G.GRASS);
    setTile(m, c0 + 2, r0 + 3, G.GRASS);
    // clear collision for the door tiles (visual opening = walkable)
    const doorIdx = idx(m, c0 + 1, r0 + 3);
    const doorIdx2 = idx(m, c0 + 2, r0 + 3);
    m.collision[doorIdx] = 0;
    m.collision[doorIdx2] = 0;
  };
  house(2, 2); // NW
  house(14, 2); // NE
  house(2, 14); // SW
  house(14, 14); // SE

  // Decor: fences + plants near the plaza/gate. Solid cells must be blocked
  // so collision matches the visible decor (C-375 AC-5).
  setTile(m, 6, 4, G.FENCE);
  setTile(m, 6, 5, G.FENCE);
  setTile(m, 13, 4, G.FENCE);
  setTile(m, 13, 5, G.FENCE);
  setTile(m, 8, 17, G.PLANT);
  setTile(m, 11, 17, G.PLANT);
  setTile(m, 3, 13, G.PLANT);
  setTile(m, 14, 13, G.PLANT);
  for (const [c, r] of [
    [6, 4],
    [6, 5],
    [13, 4],
    [13, 5],
    [8, 17],
    [11, 17],
    [3, 13],
    [14, 13],
  ] as const) {
    block(m, c, r);
  }

  return m;
};

// ---------------------------------------------------------------------------
// Inn — 16×12 (wood floor interior, furniture props as spawned entities)
// ---------------------------------------------------------------------------

const buildInn = (): MapData => {
  const m = makeMap(16, 12);
  const rng = makeRng(0x1a11);
  const W = 16;
  const H = 12;

  // Border walls; bottom gap for the door/transition (cols 7-8).
  for (let c = 0; c < W; c++) {
    setTile(m, c, 0, G.STONE_WALL);
    setTile(m, c, H - 1, G.STONE_WALL);
    block(m, c, 0);
    block(m, c, H - 1);
  }
  for (let r = 1; r < H - 1; r++) {
    setTile(m, 0, r, G.STONE_WALL);
    setTile(m, W - 1, r, G.STONE_WALL);
    block(m, 0, r);
    block(m, W - 1, r);
  }
  // Bottom door gap
  setTile(m, 7, H - 1, G.WOOD_FLOOR);
  setTile(m, 8, H - 1, G.WOOD_FLOOR);
  m.collision[idx(m, 7, H - 1)] = 0;
  m.collision[idx(m, 8, H - 1)] = 0;

  // Wall-top rim
  for (let c = 1; c < W - 1; c++) {
    setTile(m, c, 1, G.WALL_TOP);
    block(m, c, 1);
  }
  for (let r = 2; r < H - 2; r++) {
    setTile(m, 1, r, G.WALL_TOP);
    setTile(m, W - 2, r, G.WALL_TOP);
    block(m, 1, r);
    block(m, W - 2, r);
  }

  // Wood floor with variant patches + rugs (decor layer on the floor).
  // Floor extends through row 10 so the interior is fully floored up to
  // the bottom wall rim — including the rim columns at row 10 (indices
  // 161-174 in the emitted JSON) (CodeRabbit review, C-375).
  fillRect(m, 2, 2, 13, 10, G.WOOD_FLOOR);
  setTile(m, 1, 10, G.WOOD_FLOOR);
  setTile(m, 14, 10, G.WOOD_FLOOR);
  scatter(m, rng, 2, 2, 13, 9, G.WOOD_FLOOR, G.WOOD_VAR, 0.18);
  // Floor rugs near furniture.
  setTile(m, 7, 6, G.RUG_ROUND);
  setTile(m, 3, 8, G.RUG);
  setTile(m, 12, 8, G.RUG);

  return m;
};

// ---------------------------------------------------------------------------
// Merchant shop — 16×12 (stone floor, counter row at y=288)
// ---------------------------------------------------------------------------

const buildShop = (): MapData => {
  const m = makeMap(16, 12);
  const rng = makeRng(0x5b0f);
  const W = 16;
  const H = 12;

  // Border walls; bottom gap for the door/transition (cols 7-8).
  for (let c = 0; c < W; c++) {
    setTile(m, c, 0, G.STONE_WALL);
    setTile(m, c, H - 1, G.STONE_WALL);
    block(m, c, 0);
    block(m, c, H - 1);
  }
  for (let r = 1; r < H - 1; r++) {
    setTile(m, 0, r, G.STONE_WALL);
    setTile(m, W - 1, r, G.STONE_WALL);
    block(m, 0, r);
    block(m, W - 1, r);
  }
  setTile(m, 7, H - 1, G.STONE_FLOOR);
  setTile(m, 8, H - 1, G.STONE_FLOOR);
  m.collision[idx(m, 7, H - 1)] = 0;
  m.collision[idx(m, 8, H - 1)] = 0;

  for (let c = 1; c < W - 1; c++) {
    setTile(m, c, 1, G.WALL_TOP);
    block(m, c, 1);
  }
  for (let r = 2; r < H - 2; r++) {
    setTile(m, 1, r, G.WALL_TOP);
    setTile(m, W - 2, r, G.WALL_TOP);
    block(m, 1, r);
    block(m, W - 2, r);
  }

  // Stone floor with flagstone patches.
  // Floor extends through row 10 so the interior is fully floored up to
  // the bottom wall rim — including the rim columns at row 10 (indices
  // 161-174 in the emitted JSON) (CodeRabbit review, C-375).
  fillRect(m, 2, 2, 13, 10, G.STONE_FLOOR);
  setTile(m, 1, 10, G.STONE_FLOOR);
  setTile(m, 14, 10, G.STONE_FLOOR);
  scatter(m, rng, 2, 2, 13, 9, G.STONE_FLOOR, G.FLAGSTONE, 0.22);
  // Counter-area platform (row 9 = y 288-320).
  fillRect(m, 2, 9, 13, 9, G.STONE_VAR);

  return m;
};

// ---------------------------------------------------------------------------
// Emit map JSON
// ---------------------------------------------------------------------------

type SpawnObject = {
  id: number;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  properties: Array<{ name: string; type: string; value: unknown }>;
};

const TILESET_BLOCK = {
  firstgid: 1,
  name: 'atlas',
  image: '/game-data/sprites/tilesets/atlas.webp',
  // Atlas geometry is derived from the shared tables module so the tileset
  // block cannot drift from the atlas generator (CodeRabbit review, C-376).
  // C-378 AC-5: frames are extruded 1px — 34px cell pitch, 1px margin.
  imagewidth: ATLAS_WIDTH,
  imageheight: ATLAS_HEIGHT,
  tilewidth: ATLAS_TILE_SIZE,
  tileheight: ATLAS_TILE_SIZE,
  columns: ATLAS_COLS,
  tilecount: ATLAS_TILE_COUNT,
  spacing: ATLAS_CELL - ATLAS_TILE_SIZE, // 2 — gap between frames
  margin: ATLAS_PADDING, // 1
};

/** Reads the original map's object layers (spawns + transitions) verbatim. */
const loadObjectLayers = (
  mapName: string,
): Array<{ name: string; type: string; visible: boolean; objects: SpawnObject[] }> => {
  const src = JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        `../../../../apps/frontend/client/static/content-packs/emberwatch/maps/${mapName}.json`,
      ),
      'utf-8',
    ),
  ) as { layers: Array<Record<string, unknown>> };
  return src.layers
    .filter((l) => l.type === 'objectgroup')
    .map((l) => ({
      name: String(l.name),
      type: String(l.type),
      visible: Boolean(l.visible),
      objects: (l.objects as SpawnObject[]).map((o) => JSON.parse(JSON.stringify(o))),
    }));
};

/** Applies new prop frames for props that previously reused chest art. */
const fixPropFrames = (layers: Array<{ name: string; objects: SpawnObject[] }>): void => {
  const frameOverrides: Record<string, string> = {
    inn_barrel: 'barrel.png',
    inn_barrel_2: 'barrel.png',
    inn_crate: 'crate.png',
    shop_counter_l: 'counter.png',
    shop_counter_r: 'counter.png',
    shop_crate: 'crate.png',
  };
  for (const layer of layers) {
    if (layer.name !== 'spawns') {
      continue;
    }
    for (const obj of layer.objects) {
      if (obj.type !== 'prop') {
        continue;
      }
      const propId = obj.properties.find((p) => p.name === 'propId')?.value as string | undefined;
      const override = propId ? frameOverrides[propId] : undefined;
      if (override) {
        const frameProp = obj.properties.find((p) => p.name === 'frame');
        if (frameProp) {
          frameProp.value = override;
        } else {
          // No frame property on the source prop — add one so the override
          // is applied instead of being silently dropped (CodeRabbit, C-375).
          obj.properties.push({ name: 'frame', type: 'string', value: override });
        }
      }
    }
  }
};

const emit = (mapName: string, m: MapData): void => {
  const objectLayers = loadObjectLayers(mapName);
  fixPropFrames(objectLayers);

  // C-378: derive the semantic terrain channel from the ground layer by
  // inverting `tiles[gid].name` → terrain id. Cells whose GID is not a
  // declared terrain (walls, roofs, furniture) stay hand-placed GIDs —
  // they are NOT terrains. `` = the pack's base terrain.
  //
  // The baked ground layer is kept verbatim for the legacy path (AC-8);
  // the terrain path renders the autotiled ground band INSTEAD of the
  // baked ground (the renderer skips ground-band baked layers when terrain
  // layers are present). Non-terrain cells that must still draw over the
  // autotiled ground (walls, fences, plants, roofs) are duplicated into
  // decor/overhead bands so they render in BOTH paths.
  const terrains = readManifestTerrains();
  const terrainNameToId = new Map(terrains.map((t) => [t.name, t.name]));
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
    // C-378: additive semantic channels. `elevation` is reserved (all 0).
    aikami: {
      formatVersion: 1,
      terrain: terrainChannel,
      elevation: new Array(m.width * m.height).fill(0),
    },
    layers: [
      {
        name: 'ground',
        type: 'tilelayer',
        width: m.width,
        height: m.height,
        visible: true,
        // C-378 AC-1: bands are declared per layer, never name-sniffed.
        properties: [{ name: 'band', type: 'string', value: 'ground' }],
        data: m.ground,
      },
      {
        name: 'decor',
        type: 'tilelayer',
        width: m.width,
        height: m.height,
        visible: true,
        // C-378 AC-1: decor renders below entities, above the terrain base.
        properties: [{ name: 'band', type: 'string', value: 'decor' }],
        data: decor,
      },
      {
        name: 'overhead',
        type: 'tilelayer',
        width: m.width,
        height: m.height,
        visible: true,
        // C-378 AC-1: overhead (roofs) draws above every entity.
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
    `../../../../apps/frontend/client/static/content-packs/emberwatch/maps/${mapName}.json`,
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
};

main();
