// scripts/src/lib/ops/generate_emberwatch_maps_extra.ts
//
// Builders for the two Emberwatch expansion maps (gate 3/4): `old_road`
// (72×36) and `ruined_shrine` (40×36). Kept in their own module so the
// original generator stays within its source-size budget; the shared map
// type and object-layer shape are imported type-only from it.
//
// Every spawn/transition target is a stable id, and every prop/NPC uses the
// same `propId`/`npcId` conventions as the retained maps so saves and quest
// objectives keep working.

import type { MapData, MapObjectLayer } from './generate_emberwatch_maps.ts';
import { buildG } from './generate_emberwatch_tables.ts';

const G = buildG();

type SpawnObject = MapObjectLayer['objects'][number];

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

/** Stone border with wall-top rim, leaving the given gaps walkable. */
const border = (m: MapData, gaps: Array<{ col?: number; row?: number }>): void => {
  const { width: W, height: H } = m;
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
  // Clear the gaps out of the border.
  for (const gap of gaps) {
    if (gap.col !== undefined) {
      for (const r of [0, H - 1]) {
        setTile(m, gap.col, r, G.PATH);
        block(m, gap.col, r);
        m.collision[idx(m, gap.col, r)] = 0;
      }
    }
    if (gap.row !== undefined) {
      for (const c of [0, W - 1]) {
        setTile(m, c, gap.row, G.PATH);
        m.collision[idx(m, c, gap.row)] = 0;
      }
    }
  }
  // Wall-top rim one tile in, skipping the gap columns/rows.
  for (let c = 1; c < W - 1; c++) {
    if (gaps.some((g) => g.col !== undefined && (c === g.col - 1 || c === g.col + 1))) {
      continue;
    }
    setTile(m, c, 1, G.WALL_TOP);
    block(m, c, 1);
  }
  for (let r = 2; r < H - 2; r++) {
    if (gaps.some((g) => g.row !== undefined && (r === g.row + 1 || r === g.row - 1))) {
      continue;
    }
    setTile(m, 1, r, G.WALL_TOP);
    setTile(m, W - 2, r, G.WALL_TOP);
    block(m, 1, r);
    block(m, W - 2, r);
  }
};

const prop = (
  id: number,
  propId: string,
  propName: string,
  frame: string,
  x: number,
  y: number,
  extra: Array<{ name: string; type: string; value: unknown }> = [],
): SpawnObject => ({
  id,
  type: 'prop',
  x,
  y,
  width: 0,
  height: 0,
  properties: [
    { name: 'propId', type: 'string', value: propId },
    { name: 'propName', type: 'string', value: propName },
    { name: 'frame', type: 'string', value: frame },
    ...extra,
  ],
});

const npc = (
  id: number,
  npcId: string,
  npcName: string,
  dialogueKey: string,
  x: number,
  y: number,
): SpawnObject => ({
  id,
  type: 'npc',
  x,
  y,
  width: 0,
  height: 0,
  properties: [
    { name: 'npcId', type: 'string', value: npcId },
    { name: 'npcName', type: 'string', value: npcName },
    { name: 'dialogueKey', type: 'string', value: dialogueKey },
    { name: 'interactionRadius', type: 'int', value: 48 },
  ],
});

const spawn = (id: number, spawnId: string, x: number, y: number): SpawnObject => ({
  id,
  type: 'spawn',
  x,
  y,
  width: 0,
  height: 0,
  properties: [{ name: 'spawnId', type: 'string', value: spawnId }],
});

const transition = (
  id: number,
  targetMap: string,
  targetSpawnId: string,
  targetX: number,
  targetY: number,
  x: number,
  y: number,
): SpawnObject => ({
  id,
  type: 'transition',
  x,
  y,
  width: 0,
  height: 0,
  properties: [
    { name: 'targetMap', type: 'string', value: targetMap },
    { name: 'targetX', type: 'int', value: targetX },
    { name: 'targetY', type: 'int', value: targetY },
    { name: 'targetSpawnId', type: 'string', value: targetSpawnId },
  ],
});

// ---------------------------------------------------------------------------
// old_road — 72×36: the broken waystation, a bridge/ford crossing and the
// woodland trail. North gate → ruined_shrine, south gate → village.
// ---------------------------------------------------------------------------

export const buildOldRoad = (): { map: MapData; objectLayers: MapObjectLayer[] } => {
  const W = 72;
  const H = 36;
  const m = makeMap(W, H);
  const rng = makeRng(0x0d09);

  // South gap (cols 34-35) → village; north gap (cols 34-35) → ruined_shrine.
  border(m, [{ col: 34 }, { col: 35 }]);
  for (const c of [34, 35]) {
    for (const r of [0, H - 1]) {
      setTile(m, c, r, G.PATH);
      m.collision[idx(m, c, r)] = 0;
    }
  }

  // Horizontal road across the map at row 18; a second trail loops north
  // through the woods (rows 8-12) so there are two approaches.
  for (let c = 2; c <= W - 3; c++) {
    setTile(m, c, 18, G.DIRT);
  }
  for (let r = 8; r <= 18; r++) {
    setTile(m, 12, r, G.DIRT);
    setTile(m, 13, r, G.DIRT);
  }
  for (let c = 12; c <= 46; c++) {
    setTile(m, c, 10, G.DIRT);
    setTile(m, c, 11, G.DIRT);
  }
  for (let r = 10; r <= 18; r++) {
    setTile(m, 46, r, G.DIRT);
    setTile(m, 47, r, G.DIRT);
  }
  // North-to-shrine connector.
  for (let r = 0; r <= 10; r++) {
    setTile(m, 34, r, G.DIRT);
    setTile(m, 35, r, G.DIRT);
  }

  // River through cols 20-23 with a wooden bridge on the road.
  for (let r = 1; r <= H - 2; r++) {
    for (let c = 20; c <= 23; c++) {
      setTile(m, c, r, G.WATER);
      block(m, c, r);
    }
  }
  for (let c = 20; c <= 23; c++) {
    setTile(m, c, 18, G.BRIDGE);
    m.collision[idx(m, c, 18)] = 0;
  }

  // Waystation: stone floor interior walled with stone wall GIDs (a blocked
  // walkable-floor cell would violate the manifest-walkability invariant).
  fillRect(m, 55, 8, 61, 12, G.STONE_FLOOR);
  for (let c = 54; c <= 62; c++) {
    setTile(m, c, 7, G.STONE_WALL);
    setTile(m, c, 13, G.STONE_WALL);
    block(m, c, 7);
    block(m, c, 13);
  }
  for (let r = 8; r <= 12; r++) {
    setTile(m, 54, r, G.STONE_WALL);
    setTile(m, 62, r, G.STONE_WALL);
    block(m, 54, r);
    block(m, 62, r);
  }
  setTile(m, 57, 13, G.STONE_FLOOR);
  m.collision[idx(m, 57, 13)] = 0;

  // Scatter quiet variation.
  for (let r = 2; r <= H - 3; r++) {
    for (let c = 2; c <= W - 3; c++) {
      if (m.ground[idx(m, c, r)] === G.GRASS && rng() < 0.08) {
        setTile(m, c, r, G.GRASS_DARK);
      }
    }
  }

  const objectLayers: MapObjectLayer[] = [
    {
      name: 'spawns',
      type: 'objectgroup',
      visible: true,
      objects: [
        spawn(1, 'old_road_from_village', 34 * 32, 35 * 32),
        spawn(2, 'old_road_to_shrine', 34 * 32, 0),
        npc(3, 'woodcutter_ada', 'Ada the Woodcutter', 'ada_greeting', 12 * 32, 10 * 32),
        npc(4, 'apprentice_tess', 'Tess the Apprentice', 'tess_greeting', 58 * 32, 11 * 32),
        prop(5, 'waystation_cart', 'Abandoned Cart', 'crate.png', 60 * 32, 11 * 32),
        prop(6, 'waystation_barrel', 'Waystation Barrel', 'barrel.png', 55 * 32, 9 * 32),
        prop(9, 'tess_component', 'Intact Ward Component', 'crate.png', 59 * 32, 10 * 32),
      ],
    },
    {
      name: 'transitions',
      type: 'objectgroup',
      visible: true,
      objects: [
        transition(7, 'village', 'from_old_road', 34 * 32, 34 * 32, 34 * 32, H * 32),
        transition(8, 'ruined_shrine', 'ruin_from_old_road', 19 * 32, 34 * 32, 34 * 32, 0),
      ],
    },
  ];

  return { map: m, objectLayers };
};

// ---------------------------------------------------------------------------
// ruined_shrine — 40×36: forecourt, collapsed cloister and the ward socket.
// ---------------------------------------------------------------------------

export const buildRuinedShrine = (): { map: MapData; objectLayers: MapObjectLayer[] } => {
  const W = 40;
  const H = 36;
  const m = makeMap(W, H);
  const rng = makeRng(0x5c11);

  // South gap (cols 19-20) → old_road.
  border(m, []);
  for (const c of [19, 20]) {
    setTile(m, c, H - 1, G.PATH);
    m.collision[idx(m, c, H - 1)] = 0;
  }

  // Gravel forecourt (terrain-only material) with a stone ritual apron.
  const overrides: Array<[number, number, string]> = [];
  for (let r = 8; r <= 28; r++) {
    for (let c = 8; c <= 31; c++) {
      overrides.push([c, r, 'gravel']);
    }
  }
  m.terrainOverrides = overrides;
  fillRect(m, 14, 16, 25, 27, G.STONE_FLOOR);

  // Path from the south gate to the apron.
  for (let r = 28; r <= H - 1; r++) {
    setTile(m, 19, r, G.STONE_FLOOR);
    setTile(m, 20, r, G.STONE_FLOOR);
  }

  // Collapsed cloister: broken wall fragments around the forecourt.
  for (const [c0, r0, c1, r1] of [
    [10, 12, 13, 12],
    [26, 12, 29, 12],
    [10, 24, 13, 24],
    [26, 24, 29, 24],
    [10, 13, 10, 15],
    [29, 13, 29, 15],
  ] as const) {
    fillRect(m, c0, r0, c1, r1, G.STONE_WALL);
    blockRect(m, c0, r0, c1, r1);
  }

  // Scatter ash/gravel wear.
  for (let r = 9; r <= 27; r++) {
    for (let c = 9; c <= 30; c++) {
      if (m.ground[idx(m, c, r)] === G.GRASS && rng() < 0.1) {
        setTile(m, c, r, G.GRASS_DARK);
      }
    }
  }

  const objectLayers: MapObjectLayer[] = [
    {
      name: 'spawns',
      type: 'objectgroup',
      visible: true,
      objects: [
        spawn(1, 'ruin_from_old_road', 19 * 32, 34 * 32),
        npc(2, 'shrine_keeper_nemi', 'Nemi the Shrine Keeper', 'nemi_greeting', 20 * 32, 18 * 32),
        prop(3, 'shrine_arch', 'Shrine Arch', 'column.png', 19 * 32, 14 * 32),
        prop(4, 'ward_socket', 'Ward Socket', 'column.png', 21 * 32, 14 * 32),
      ],
    },
    {
      name: 'transitions',
      type: 'objectgroup',
      visible: true,
      objects: [transition(5, 'old_road', 'old_road_to_shrine', 34 * 32, 32, 20 * 32, H * 32)],
    },
  ];

  return { map: m, objectLayers };
};
