// scripts/src/lib/ops/generate_emberwatch_maps_extra.ts
//
// Builders for the two Emberwatch expansion maps:
//   old_road       72×36
//   ruined_shrine  40×36
//
// `old_road` is the pack's transitional adventure map, so it is composed as one:
// a broken waystation with real debris, an exposed direct route over the culvert
// and a longer woodland trail that both rejoin before the shrine transition, and
// the two road NPCs (Ada on the trail, Tess at the waystation) standing where
// their dialogue says they are.
//
// `ruined_shrine` is a single-level ruin: a gravel forecourt, collapsed cloister
// fragments that read as fallen masonry, more than one approach to the ritual
// apron, the ward socket as the focal point, and scarred ground around it. There
// is deliberately no multi-level traversal — the pack models no elevation.
//
// Every spawn/transition target is a stable id, and every prop/NPC uses the same
// `propId`/`npcId` conventions as the retained maps so saves and quest
// objectives keep working.

import {
  cell,
  placeLandmark,
  placeNpc,
  placeProp,
  placeSpawn,
  placeTransition,
} from './emberwatch_authoring.ts';
import {
  block,
  blockRect,
  fillRect,
  type MapData,
  type MapObjectLayer,
  makeMap,
  makeRng,
  scatter,
  setTile,
} from './emberwatch_map_shared.ts';
import { buildG } from './generate_emberwatch_tables.ts';

const G = buildG();

/** A stone border wall with a one-tile rim, opened at the given gate columns. */
const borderWithGaps = (m: MapData, gateCols: readonly number[]): void => {
  const W = m.width;
  const H = m.height;
  const gates = new Set(gateCols);
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
  for (const c of gates) {
    for (const r of [0, H - 1]) {
      setTile(m, c, r, G.PATH);
      m.collision[r * W + c] = 0;
    }
  }
  for (let c = 1; c < W - 1; c++) {
    if (gates.has(c)) {
      continue;
    }
    setTile(m, c, 1, G.WALL_TOP);
    block(m, c, 1);
    setTile(m, c, H - 2, G.WALL_TOP);
    block(m, c, H - 2);
  }
  for (let r = 2; r < H - 2; r++) {
    setTile(m, 1, r, G.WALL_TOP);
    setTile(m, W - 2, r, G.WALL_TOP);
    block(m, 1, r);
    block(m, W - 2, r);
  }
};

// ---------------------------------------------------------------------------
// old_road — 72×36
// ---------------------------------------------------------------------------

/** The direct road, the woodland trail and the three-cell shrine corridor. */
const paintOldRoadRoutes = (m: MapData): void => {
  fillRect(m, 2, 17, m.width - 3, 19, G.DIRT);
  fillRect(m, 12, 10, 13, 19, G.DIRT);
  fillRect(m, 12, 9, 47, 11, G.DIRT);
  fillRect(m, 46, 11, 47, 19, G.DIRT);
  fillRect(m, 33, 2, 35, 17, G.DIRT);
  fillRect(m, 33, 19, 35, m.height - 1, G.DIRT);
};

/** The stream that cuts the direct route and its single dry crossing. */
const carveCulvert = (m: MapData): void => {
  const W = m.width;
  for (let r = 1; r <= m.height - 2; r++) {
    for (let c = 20; c <= 23; c++) {
      setTile(m, c, r, G.WATER);
      block(m, c, r);
    }
  }
  for (let c = 20; c <= 23; c++) {
    for (let r = 17; r <= 19; r++) {
      setTile(m, c, r, G.BRIDGE);
      m.collision[r * W + c] = 0;
    }
  }
};

/** The broken waystation shell, its collapsed east end and its doorway. */
const raiseWaystation = (m: MapData): void => {
  const W = m.width;
  fillRect(m, 54, 8, 62, 13, G.STONE_FLOOR);
  for (let c = 53; c <= 62; c++) {
    setTile(m, c, 7, G.STONE_WALL);
    block(m, c, 7);
  }
  for (let r = 8; r <= 12; r++) {
    setTile(m, 53, r, G.STONE_WALL);
    block(m, 53, r);
  }
  for (const r of [8, 12]) {
    setTile(m, 63, r, G.STONE_WALL);
    block(m, 63, r);
  }
  for (const [c, r] of [
    [63, 9],
    [63, 10],
    [63, 11],
    [62, 13],
    [61, 13],
  ] as const) {
    setTile(m, c, r, G.BRICK);
    block(m, c, r);
  }
  for (const r of [10, 11]) {
    setTile(m, 53, r, G.STONE_FLOOR);
    m.collision[r * W + 53] = 0;
  }
};

/**
 * Grass variation and the ash that darkens the road toward the shrine.
 * `sand` is a baked decor tile, so this is a scatter rather than a terrain
 * override; a terrain material the published atlas does not carry would render
 * as fallback grass.
 */
const scatterRoadWear = (m: MapData, rng: () => number): void => {
  const W = m.width;
  const H = m.height;
  scatter(m, rng, 2, 2, W - 3, H - 3, G.GRASS, G.GRASS_DARK, 0.12);
  scatter(m, rng, 2, 2, W - 3, H - 3, G.GRASS, G.GRASS_VARIANT, 0.05);
  for (let r = 3; r <= 15; r++) {
    for (let c = 30; c <= 42; c++) {
      if (m.ground[r * W + c] === G.GRASS && rng() < 0.14) {
        setTile(m, c, r, G.SAND);
      }
    }
  }
  for (let r = 4; r <= 14; r++) {
    for (let c = 31; c <= 39; c++) {
      if (m.ground[r * W + c] === G.GRASS && rng() < 0.08) {
        setTile(m, c, r, G.SAND);
      }
    }
  }
};

/**
 * Tree stands grouped into a few irregular clusters rather than an even
 * scatter, leaving open glades between them. Clear of both routes and the
 * waystation.
 */
const OLD_ROAD_TREES: ReadonlyArray<readonly [number, number, 'oak' | 'birch']> = [
  [8, 5, 'oak'],
  [10, 7, 'birch'],
  [13, 4, 'oak'],
  [26, 4, 'birch'],
  [29, 6, 'oak'],
  [43, 4, 'birch'],
  [39, 5, 'oak'],
  [55, 6, 'birch'],
  [51, 4, 'oak'],
  [65, 4, 'birch'],
  [67, 8, 'oak'],
  [7, 26, 'birch'],
  [11, 29, 'oak'],
  [28, 30, 'birch'],
  [24, 27, 'oak'],
  [49, 29, 'birch'],
  [45, 26, 'oak'],
];

/**
 * The Old Road.
 *
 * Two routes from the village gate to the shrine gate:
 *   • the exposed direct route — the dirt road along row 18, crossing the
 *     culvert on the waystation's wooden bridge;
 *   • the longer woodland trail — north through the trees, past Ada's cutting
 *     ground, then down to rejoin the road at the waystation.
 * Both rejoin at col 46-47 before the shrine connector at cols 34-35, so the
 * player is never committed to one route by an invisible wall.
 */
export const buildOldRoad = (): { map: MapData; objectLayers: MapObjectLayer[] } => {
  const m = makeMap(72, 36);
  const rng = makeRng(0x0d09);

  borderWithGaps(m, [33, 34, 35]);
  paintOldRoadRoutes(m);

  carveCulvert(m);
  raiseWaystation(m);
  scatterRoadWear(m, rng);
  const trees = OLD_ROAD_TREES;

  const objectLayers: MapObjectLayer[] = [
    {
      name: 'spawns',
      type: 'objectgroup',
      visible: true,
      objects: [
        // Arrival markers sit INSIDE the map, clear of the exit rectangles at
        // the map edges. ZoningSystem tests the player's position inclusively
        // against each transition rect, so a marker placed on the rect's corner
        // re-triggers the exit the instant the map loads (C-138).
        placeSpawn(1, 'old_road_from_village', 34, 33),
        placeSpawn(2, 'old_road_to_shrine', 34, 2),
        placeNpc(3, 'woodcutter_ada', 'Ada the Woodcutter', 'ada_greeting', 12, 10),
        placeNpc(4, 'apprentice_tess', 'Tess the Apprentice', 'tess_greeting', 58, 12),

        // ── Waystation remains (environmental storytelling) ────────────────
        placeProp(5, 'waystation_cart', 'Abandoned Cart', 'prop_cart.png', 61, 11),
        placeProp(6, 'waystation_barrel', 'Waystation Barrel', 'prop_barrel.png', 55, 9),
        placeProp(9, 'tess_component', 'Intact Ward Component', 'prop_component.png', 57, 11),
        placeProp(20, 'waystation_crate', 'Crate', 'prop_crate.png', 56, 12),
        placeProp(21, 'waystation_crate_2', 'Crate', 'prop_crate.png', 60, 8),
        placeProp(22, 'waystation_support', 'Rotting Support', 'prop_support.png', 59, 12),
        placeLandmark(23, 'road_notice', 'Road Marker', 'prop_notice_board.png', 32, 20),

        // ── Woodland trail tree stands ─────────────────────────────────────
        ...trees.map(([c, r, kind], index) =>
          kind === 'oak'
            ? placeProp(100 + index, `road_oak_${index}`, 'Woodland Oak', 'oak.png', c, r)
            : placeProp(200 + index, `road_birch_${index}`, 'Woodland Birch', 'birch.png', c, r),
        ),
      ],
    },
    {
      name: 'transitions',
      type: 'objectgroup',
      visible: true,
      objects: [
        placeTransition({
          id: 1007,
          targetMap: 'village',
          targetSpawnId: 'from_old_road',
          target: { x: cell(32), y: cell(3) },
          at: { c: 33, r: m.height - 1, width: 3, height: 1 },
        }),
        placeTransition({
          id: 1008,
          targetMap: 'ruined_shrine',
          targetSpawnId: 'ruin_from_old_road',
          target: { x: cell(19), y: cell(34) },
          at: { c: 33, r: 0, width: 3, height: 1 },
        }),
      ],
    },
  ];

  return { map: m, objectLayers };
};

// ---------------------------------------------------------------------------
// ruined_shrine — 40×36
// ---------------------------------------------------------------------------

/** Per-row spans for the shrine courtyard (`[row, c0, c1]`), tapering to the gate. */
const SHRINE_COURTYARD_SPANS: ReadonlyArray<readonly [number, number, number]> = [
  [10, 11, 28],
  [11, 10, 29],
  [12, 10, 29],
  [13, 9, 30],
  [14, 9, 30],
  [15, 9, 30],
  [16, 9, 30],
  [17, 9, 30],
  [18, 9, 30],
  [19, 9, 30],
  [20, 9, 30],
  [21, 9, 30],
  [22, 10, 29],
  [23, 10, 29],
  [24, 11, 28],
  [25, 12, 27],
  [26, 13, 26],
  [27, 14, 25],
  [28, 15, 24],
];

/** Per-row spans for the octagonal ritual apron (`[row, c0, c1]`). */
const SHRINE_APRON_SPANS: ReadonlyArray<readonly [number, number, number]> = [
  [14, 17, 22],
  [15, 16, 23],
  [16, 15, 24],
  [17, 15, 24],
  [18, 15, 24],
  [19, 15, 24],
  [20, 15, 24],
  [21, 15, 24],
  [22, 15, 24],
  [23, 16, 23],
  [24, 17, 22],
];

/** Broken cloister wall runs (`[c0, r0, c1, r1]`), uneven and gapped. */
const SHRINE_CLOISTER_FRAGMENTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [12, 9, 16, 9],
  [23, 9, 27, 9],
  [10, 12, 10, 15],
  [10, 21, 10, 25],
  [29, 12, 29, 15],
  [29, 21, 29, 25],
  [13, 26, 16, 26],
  [23, 26, 26, 26],
  [13, 12, 14, 12],
  [25, 12, 26, 12],
  [13, 27, 15, 27],
];

/** Fallen columns and rubble cells around the apron (`[c, r]`, walk-blocking). */
const SHRINE_RUBBLE: ReadonlyArray<readonly [number, number]> = [
  [13, 14],
  [26, 14],
  [13, 25],
  [26, 25],
  [17, 12],
  [22, 12],
  [17, 27],
  [22, 27],
  [9, 20],
  [31, 24],
  [32, 12],
  [7, 14],
  [11, 18],
  [28, 16],
  [18, 8],
  [23, 29],
];

/** The scorched ward-scar cells around the socket (`[c, r]`). */
const SHRINE_WARD_SCAR: ReadonlyArray<readonly [number, number]> = [
  [19, 14],
  [20, 14],
  [19, 25],
  [20, 25],
  [14, 19],
  [14, 20],
  [25, 19],
  [25, 20],
];

/** Earthen courtyard, tapering toward the gate, one span per row. */
const paintShrineCourtyard = (m: MapData): void => {
  for (const [r, c0, c1] of SHRINE_COURTYARD_SPANS) {
    fillRect(m, c0, r, c1, r, G.DIRT);
  }
};

/** The raised octagonal stone apron and its flagstone wear. */
const raiseShrineApron = (m: MapData, rng: () => number): void => {
  for (const [r, c0, c1] of SHRINE_APRON_SPANS) {
    fillRect(m, c0, r, c1, r, G.STONE_FLOOR);
  }
  scatter(m, rng, 16, 16, 23, 23, G.STONE_FLOOR, G.FLAGSTONE, 0.16);
};

/** The processional south path, gate threshold and the broken side aisles. */
const layShrineApproaches = (m: MapData): void => {
  fillRect(m, 19, 24, 21, m.height - 1, G.STONE_FLOOR);
  fillRect(m, 18, 32, 22, 33, G.FLAGSTONE);
  fillRect(m, 8, 9, 9, 15, G.STONE_FLOOR);
  fillRect(m, 9, 15, 15, 16, G.STONE_FLOOR);
  fillRect(m, 25, 18, 30, 19, G.STONE_FLOOR);
  fillRect(m, 29, 8, 30, 18, G.STONE_FLOOR);
};

/** Collapsed cloister walls and the fallen columns around the apron. */
const layCloister = (m: MapData): void => {
  for (const [c0, r0, c1, r1] of SHRINE_CLOISTER_FRAGMENTS) {
    fillRect(m, c0, r0, c1, r1, G.STONE_WALL);
    blockRect(m, c0, r0, c1, r1);
  }
  for (const [c, r] of SHRINE_RUBBLE) {
    setTile(m, c, r, G.COLUMN);
    block(m, c, r);
  }
};

/** The scorched ward scar and the surrounding grass variation. */
const scarWard = (m: MapData, rng: () => number): void => {
  for (const [c, r] of SHRINE_WARD_SCAR) {
    setTile(m, c, r, G.SAND);
  }
  scatter(m, rng, 2, 2, m.width - 3, m.height - 3, G.GRASS, G.GRASS_DARK, 0.1);
};

/**
 * The Ruined Shrine.
 *
 * A walled compound whose cloister has fallen in: a gravel courtyard that
 * tapers from the south gate toward the ritual apron, corrupted earth ringing
 * the raised stone platform, and broken wall fragments that read as collapsed
 * masonry rather than a tidy corridor. The shrine arch frames the ward socket
 * on the apron; the south path is the processional approach, and a broken
 * north-west aisle and an east aisle give the ruin more than one way in.
 *
 * Nemi stands on the apron, tending the shrine rather than guarding the gate.
 */
export const buildRuinedShrine = (): { map: MapData; objectLayers: MapObjectLayer[] } => {
  const m = makeMap(40, 36);
  const rng = makeRng(0x5c11);

  borderWithGaps(m, [19, 20, 21]);
  paintShrineCourtyard(m);
  raiseShrineApron(m, rng);
  layShrineApproaches(m);
  layCloister(m);
  scarWard(m, rng);

  const objectLayers: MapObjectLayer[] = [
    {
      name: 'spawns',
      type: 'objectgroup',
      visible: true,
      objects: [
        placeSpawn(1, 'ruin_from_old_road', 19, 34),
        // Nemi tends the shrine from the apron, west of the socket.
        placeNpc(2, 'shrine_keeper_nemi', 'Nemi the Shrine Keeper', 'nemi_greeting', 16, 21),
        // The focal socket and the arch that frames it.
        placeLandmark(4, 'ward_socket', 'Ward Socket', 'prop_ward_socket.png', 20, 20),
        placeLandmark(3, 'shrine_arch', 'Shrine Arch', 'shrine_arch.png', 19, 18),
        // Clutter: fallen masonry and the remains of the cloister garden.
        placeProp(30, 'shrine_brazier', 'Brazier', 'prop_brazier.png', 17, 23),
        placeProp(31, 'shrine_barrel', 'Barrel', 'prop_barrel.png', 27, 11),
        placeProp(32, 'shrine_crate', 'Crate', 'prop_crate.png', 12, 10),
        placeProp(33, 'shrine_oak', 'Woodland Oak', 'oak.png', 4, 29),
        placeProp(34, 'shrine_birch', 'Woodland Birch', 'birch.png', 35, 30),
      ],
    },
    {
      name: 'transitions',
      type: 'objectgroup',
      visible: true,
      objects: [
        placeTransition({
          id: 1005,
          targetMap: 'old_road',
          targetSpawnId: 'old_road_to_shrine',
          target: { x: cell(34), y: cell(2) },
          at: { c: 19, r: m.height - 1, width: 3, height: 1 },
        }),
      ],
    },
  ];

  return { map: m, objectLayers };
};
