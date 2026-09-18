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
  block,
  blockRect,
  fillRect,
  type MapData,
  type MapObjectLayer,
  makeMap,
  makeRng,
  npc,
  prop,
  scatter,
  setTile,
  spawn,
  transition,
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
  const W = 72;
  const H = 36;
  const m = makeMap(W, H);
  const rng = makeRng(0x0d09);

  borderWithGaps(m, [34, 35]);

  // ── The exposed direct route ─────────────────────────────────────────────
  // Dirt road along row 18, three cells wide so companions fit.
  fillRect(m, 2, 17, W - 3, 19, G.DIRT);

  // ── The woodland trail ───────────────────────────────────────────────────
  // Leaves the road at cols 12-13, runs north-east through the trees, and
  // rejoins at cols 46-47.
  fillRect(m, 12, 10, 13, 19, G.DIRT);
  fillRect(m, 12, 9, 47, 11, G.DIRT);
  fillRect(m, 46, 11, 47, 19, G.DIRT);

  // ── Shrine connector ─────────────────────────────────────────────────────
  // North from the road junction to the shrine gate.
  fillRect(m, 34, 2, 35, 17, G.DIRT);

  // ── The culvert ──────────────────────────────────────────────────────────
  // A stream cuts the direct route; the only crossing is the waystation bridge.
  for (let r = 1; r <= H - 2; r++) {
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

  // ── The broken waystation ────────────────────────────────────────────────
  // A stone shell with a collapsed east end: the wall run is deliberately
  // incomplete, and debris spills out of the doorway.
  fillRect(m, 54, 8, 62, 13, G.STONE_FLOOR);
  for (let c = 53; c <= 62; c++) {
    setTile(m, c, 7, G.STONE_WALL);
    block(m, c, 7);
  }
  for (let r = 8; r <= 12; r++) {
    setTile(m, 53, r, G.STONE_WALL);
    block(m, 53, r);
  }
  // Collapsed east side: only two stubs of wall survive.
  for (const r of [8, 12]) {
    setTile(m, 63, r, G.STONE_WALL);
    block(m, 63, r);
  }
  // Rubble across the fallen end.
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
  // Doorway on the west wall.
  for (const r of [10, 11]) {
    setTile(m, 53, r, G.STONE_FLOOR);
    m.collision[r * W + 53] = 0;
  }

  // ── Woodland and wear ────────────────────────────────────────────────────
  scatter(m, rng, 2, 2, W - 3, H - 3, G.GRASS, G.GRASS_DARK, 0.12);
  scatter(m, rng, 2, 2, W - 3, H - 3, G.GRASS, G.GRASS_VARIANT, 0.05);
  // Ash and churned earth where the corruption has reached the road. `earth`
  // is a terrain-channel material with no baked tile GID, so it is written as
  // a terrain override rather than through `setTile`.
  const roadOverrides: Array<[number, number, string]> = [];
  for (let r = 4; r <= 16; r++) {
    for (let c = 30; c <= 44; c++) {
      if (m.ground[r * W + c] === G.GRASS && rng() < 0.25) {
        roadOverrides.push([c, r, 'earth']);
      }
    }
  }
  m.terrainOverrides = roadOverrides;

  // Tree stands lining the woodland trail, clear of both routes.
  const trees: Array<[number, number, 'oak' | 'birch']> = [
    [9, 6, 'oak'],
    [16, 5, 'birch'],
    [26, 6, 'oak'],
    [28, 5, 'birch'],
    [33, 6, 'oak'],
    [40, 5, 'birch'],
    [52, 5, 'oak'],
    [60, 4, 'birch'],
    [66, 9, 'oak'],
    [8, 14, 'birch'],
    [17, 22, 'oak'],
    [26, 24, 'birch'],
    [40, 23, 'oak'],
    [55, 24, 'birch'],
    [64, 26, 'oak'],
    [30, 30, 'birch'],
    [45, 30, 'oak'],
  ];

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
        spawn(1, 'old_road_from_village', 34 * 32, (H - 3) * 32),
        spawn(2, 'old_road_to_shrine', 34 * 32, 2 * 32),
        npc(3, 'woodcutter_ada', 'Ada the Woodcutter', 'ada_greeting', 12 * 32, 10 * 32),
        npc(4, 'apprentice_tess', 'Tess the Apprentice', 'tess_greeting', 58 * 32, 12 * 32),

        // ── Waystation remains (environmental storytelling) ────────────────
        prop(5, 'waystation_cart', 'Abandoned Cart', 'prop_cart.png', 61 * 32, 11 * 32),
        prop(6, 'waystation_barrel', 'Waystation Barrel', 'prop_barrel.png', 55 * 32, 9 * 32),
        prop(9, 'tess_component', 'Intact Ward Component', 'prop_component.png', 57 * 32, 11 * 32),
        prop(20, 'waystation_crate', 'Crate', 'crate.png', 56 * 32, 12 * 32),
        prop(21, 'waystation_crate_2', 'Crate', 'crate.png', 60 * 32, 8 * 32),
        prop(22, 'waystation_support', 'Rotting Support', 'prop_support.png', 59 * 32, 12 * 32),
        prop(23, 'road_notice', 'Road Marker', 'prop_notice_board.png', 32 * 32, 20 * 32),

        // ── Woodland trail tree stands ─────────────────────────────────────
        ...trees.map(([c, r, kind], index) =>
          kind === 'oak'
            ? prop(100 + index, `road_oak_${index}`, 'Woodland Oak', 'oak.png', c * 32, r * 32)
            : prop(
                200 + index,
                `road_birch_${index}`,
                'Woodland Birch',
                'birch.png',
                c * 32,
                r * 32,
              ),
        ),
      ],
    },
    {
      name: 'transitions',
      type: 'objectgroup',
      visible: true,
      objects: [
        transition(1007, 'village', 'from_old_road', 32 * 32, 3 * 32, 34 * 32, (H - 1) * 32, 64, 32),
        transition(1008, 'ruined_shrine', 'ruin_from_old_road', 19 * 32, 34 * 32, 34 * 32, 0, 64, 32),
      ],
    },
  ];

  return { map: m, objectLayers };
};

// ---------------------------------------------------------------------------
// ruined_shrine — 40×36
// ---------------------------------------------------------------------------

/**
 * The Ruined Shrine.
 *
 * A gravel forecourt ringed by collapsed cloister fragments, a raised stone
 * ritual apron at the centre with the ward socket as its focal point, and the
 * shrine arch standing over the socket. Two approaches lead in — the main south
 * path and a broken north-west side aisle — and both reach the apron, so the
 * ritual area is readable from more than one direction.
 *
 * Nemi stands just inside the south entrance, on the safe side of the rubble.
 */
export const buildRuinedShrine = (): { map: MapData; objectLayers: MapObjectLayer[] } => {
  const W = 40;
  const H = 36;
  const m = makeMap(W, H);
  const rng = makeRng(0x5c11);

  borderWithGaps(m, [19, 20]);

  // ── Gravel forecourt and the scarred ritual apron ────────────────────────
  const overrides: Array<[number, number, string]> = [];
  for (let r = 6; r <= 30; r++) {
    for (let c = 6; c <= 33; c++) {
      overrides.push([c, r, 'gravel']);
    }
  }
  // Corrupted ground: earth rings the apron where the ward has failed.
  for (let r = 12; r <= 26; r++) {
    for (let c = 12; c <= 27; c++) {
      overrides.push([c, r, 'earth']);
    }
  }
  m.terrainOverrides = overrides;

  // The raised ritual apron.
  fillRect(m, 15, 15, 24, 24, G.STONE_FLOOR);
  // Flagstone wear inside it.
  scatter(m, rng, 16, 16, 23, 23, G.STONE_FLOOR, G.FLAGSTONE, 0.18);

  // ── Approaches ───────────────────────────────────────────────────────────
  // Main south path: a four-cell apron inside the map, narrowing to the two
  // gate columns through the wall-top rim and the border row.
  fillRect(m, 18, 25, 21, H - 3, G.STONE_FLOOR);
  fillRect(m, 19, H - 2, 20, H - 1, G.STONE_FLOOR);
  // Broken north-west side aisle: enters past the collapsed cloister.
  fillRect(m, 8, 9, 9, 16, G.STONE_FLOOR);
  fillRect(m, 9, 16, 16, 17, G.STONE_FLOOR);
  // East side aisle to the apron's other edge.
  fillRect(m, 25, 18, 31, 19, G.STONE_FLOOR);
  fillRect(m, 30, 8, 31, 19, G.STONE_FLOOR);

  // ── Collapsed cloister ───────────────────────────────────────────────────
  // Wall fragments, each with a stub and a broken end, so the ruin reads as
  // fallen masonry rather than a tidy corridor.
  const fragments: Array<[number, number, number, number]> = [
    [10, 12, 13, 12],
    [26, 12, 29, 12],
    [10, 27, 13, 27],
    [26, 27, 29, 27],
    [11, 13, 11, 15],
    [28, 13, 28, 15],
    [11, 24, 11, 26],
    [28, 24, 28, 26],
    [14, 6, 17, 6],
    [23, 6, 26, 6],
  ];
  for (const [c0, r0, c1, r1] of fragments) {
    fillRect(m, c0, r0, c1, r1, G.STONE_WALL);
    blockRect(m, c0, r0, c1, r1);
  }
  // Fallen columns and rubble around the apron (walk-blocking, single cells).
  const rubble: Array<[number, number]> = [
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
  ];
  for (const [c, r] of rubble) {
    setTile(m, c, r, G.COLUMN);
    block(m, c, r);
  }

  // ── Ward scar ────────────────────────────────────────────────────────────
  // A ring of scorched, cracked ground around the socket.
  // `earth` carries no baked tile GID — it is a terrain-channel material.
  m.terrainOverrides = [
    ...(m.terrainOverrides ?? []),
    [19, 14, 'earth'],
    [20, 14, 'earth'],
    [19, 25, 'earth'],
    [20, 25, 'earth'],
    [14, 19, 'earth'],
    [14, 20, 'earth'],
    [25, 19, 'earth'],
    [25, 20, 'earth'],
  ];

  scatter(m, rng, 7, 7, W - 8, H - 7, G.GRASS, G.GRASS_DARK, 0.1);

  const objectLayers: MapObjectLayer[] = [
    {
      name: 'spawns',
      type: 'objectgroup',
      visible: true,
      objects: [
        spawn(1, 'ruin_from_old_road', 19 * 32, 34 * 32),
        // Nemi stands just inside the entrance, on the safe side of the rubble.
        npc(2, 'shrine_keeper_nemi', 'Nemi the Shrine Keeper', 'nemi_greeting', 21 * 32, 28 * 32),
        // The focal socket and the arch that frames it.
        prop(4, 'ward_socket', 'Ward Socket', 'prop_ward_socket.png', 20 * 32, 20 * 32),
        prop(3, 'shrine_arch', 'Shrine Arch', 'shrine_arch.png', 19 * 32, 18 * 32),
        // Clutter: fallen masonry and the remains of the cloister garden.
        prop(30, 'shrine_brazier', 'Brazier', 'prop_brazier.png', 17 * 32, 23 * 32),
        prop(31, 'shrine_barrel', 'Barrel', 'prop_barrel.png', 26 * 32, 22 * 32),
        prop(32, 'shrine_crate', 'Crate', 'crate.png', 12 * 32, 8 * 32),
        prop(33, 'shrine_oak', 'Woodland Oak', 'oak.png', 5 * 32, 30 * 32),
        prop(34, 'shrine_birch', 'Woodland Birch', 'birch.png', 34 * 32, 31 * 32),
      ],
    },
    {
      name: 'transitions',
      type: 'objectgroup',
      visible: true,
      objects: [
        transition(1005, 'old_road', 'old_road_to_shrine', 34 * 32, 0, 19 * 32, (H - 1) * 32, 64, 32),
      ],
    },
  ];

  return { map: m, objectLayers };
};
