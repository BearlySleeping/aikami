// scripts/src/lib/ops/emberwatch_map_village.ts
//
// Emberwatch village — 64×48.
//
// The previous builder produced a rectangular grass sandbox enclosed by a stone
// wall: a border, four identical cottages and two straight paths crossing at the
// middle. It read as a level-editor test map, not as an inhabited woodland
// border village, and its only landmark (the ward tree) sat in an empty apron.
//
// This builder composes the village the pack's own prose describes:
//   • a southern arrival through the gate, opening into a readable square;
//   • the ward tree as the visual landmark at the square's heart;
//   • the inn east, the shop south-east, the smith's yard west;
//   • a north gate onto the old road;
//   • a woodland boundary — oak/birch stands with irregular gaps, not a wall —
//     with a stream shaping the north-east arc and the west perimeter;
//   • one primary north–south route and one primary east–west route, both
//     ≥3 cells clear, plus ≥2-cell secondary paths into every building;
//   • clutter near the buildings that never blocks a route.
//
// Every spawn id, transition target, prop id and NPC id is preserved — saves and
// quest objectives resolve them by name.
//
// Geometry contract (enforced by generate_emberwatch_maps.test.ts):
//   gates  north cols 31-32 (row 0) · south cols 31-32 (row 47)
//          west rows 23-25 (col 0)  · east rows 23-25 (col 63)
//   arrival spawns sit clear of every transition rectangle on this map.

import {
  block,
  fillRect,
  type MapData,
  type MapObjectLayer,
  makeMap,
  makeRng,
  npc,
  OLD_ROAD_ARRIVAL,
  prop,
  scatter,
  setTile,
  spawn,
  transition,
} from './emberwatch_map_shared.ts';
import { buildG } from './generate_emberwatch_tables.ts';

const G = buildG();

const W = 64;
const H = 48;

/** The four perimeter gates, kept walkable all the way through the rim. */
const GATES = {
  north: [31, 32],
  south: [31, 32],
  west: [23, 24, 25],
  east: [23, 24, 25],
} as const;

const inBounds = (c: number, r: number): boolean => c >= 1 && c <= W - 2 && r >= 1 && r <= H - 2;

/**
 * The woodland rim.
 *
 * The outermost ring stays solid so an actor can never leave the map, but it is
 * painted as forest floor and blocked with trunks — not a stone wall — and it is
 * broken at each gate. One ring in, the treeline thins with irregular gaps, so
 * the boundary reads as woodland rather than a box.
 */
const woodlandRim = (m: MapData, rng: () => number): void => {
  for (let c = 0; c < W; c++) {
    for (const r of [0, H - 1]) {
      setTile(m, c, r, G.PLANT);
      block(m, c, r);
    }
  }
  for (let r = 0; r < H; r++) {
    for (const c of [0, W - 1]) {
      setTile(m, c, r, G.PLANT);
      block(m, c, r);
    }
  }

  for (const c of GATES.north) {
    setTile(m, c, 0, G.PATH);
    m.collision[c] = 0;
  }
  for (const c of GATES.south) {
    setTile(m, c, H - 1, G.PATH);
    m.collision[(H - 1) * W + c] = 0;
  }
  for (const r of GATES.west) {
    setTile(m, 0, r, G.PATH);
    m.collision[r * W] = 0;
  }
  for (const r of GATES.east) {
    setTile(m, W - 1, r, G.PATH);
    m.collision[r * W + W - 1] = 0;
  }

  // Gate mouths stay clear two cells in, so an arrival never lands on a trunk.
  const clear = new Set<number>();
  const mark = (c: number, r: number): void => {
    if (inBounds(c, r)) {
      clear.add(r * W + c);
    }
  };
  for (const c of [...GATES.north, ...GATES.south]) {
    for (const r of [1, 2, H - 3, H - 2]) {
      mark(c, r);
    }
  }
  for (const r of [...GATES.west, ...GATES.east]) {
    for (const c of [1, 2, W - 3, W - 2]) {
      mark(c, r);
    }
  }

  for (let c = 1; c < W - 1; c++) {
    for (const r of [1, H - 2]) {
      if (clear.has(r * W + c) || rng() < 0.45) {
        continue;
      }
      setTile(m, c, r, G.PLANT);
      block(m, c, r);
    }
  }
  for (let r = 1; r < H - 1; r++) {
    for (const c of [1, W - 2]) {
      if (clear.has(r * W + c) || rng() < 0.45) {
        continue;
      }
      setTile(m, c, r, G.PLANT);
      block(m, c, r);
    }
  }
};

/**
 * The stream.
 *
 * Enters from the north-east treeline, runs west inside the northern rim and
 * drains out through the west rim. It shapes the perimeter instead of sitting in
 * the middle of the map as a decorative pond. Collision stays semantic — water
 * blocks — and the only dry crossing is the stone bridge on the notice-board
 * approach.
 */
const stream = (m: MapData): void => {
  const channel: Array<[number, number]> = [];
  for (let c = 60; c >= 40; c--) {
    channel.push([c, 2]);
  }
  for (let r = 3; r <= 7; r++) {
    channel.push([40, r]);
  }
  for (let c = 39; c >= 26; c--) {
    channel.push([c, 7]);
  }
  for (let r = 8; r <= 12; r++) {
    channel.push([26, r]);
  }
  for (let c = 25; c >= 2; c--) {
    channel.push([c, 12]);
  }

  // Pass 1: lay the channel.
  for (const [c, r] of channel) {
    if (!inBounds(c, r)) {
      continue;
    }
    setTile(m, c, r, G.WATER);
    block(m, c, r);
  }

  // Pass 2: bank the channel. Done after the whole channel is laid, so a cell
  // that is a neighbour of an EARLIER channel cell but becomes water itself is
  // never banked — banking in the same pass left the terrain channel saying
  // "gravel" on a cell whose tile is water.
  m.terrainOverrides = m.terrainOverrides ?? [];
  for (const [c, r] of channel) {
    if (!inBounds(c, r)) {
      continue;
    }
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nc = c + dc;
      const nr = r + dr;
      if (!inBounds(nc, nr)) {
        continue;
      }
      if (m.ground[nr * W + nc] === G.WATER || m.collision[nr * W + nc] === 1) {
        continue;
      }
      // `gravel` is a TERRAIN-CHANNEL material: it declares no baked tile GID,
      // so writing it through `setTile` would put `undefined` into the ground
      // layer (serialized as `null`). It goes through `terrainOverrides`.
      m.terrainOverrides.push([nc, nr, 'gravel']);
    }
  }

  // Stone bridge: the only dry crossing of the stream.
  for (const c of [39, 40, 41]) {
    for (const r of [7, 8]) {
      setTile(m, c, r, G.BRIDGE);
      m.collision[r * W + c] = 0;
    }
  }
};

type DoorSide = 'north' | 'south' | 'east' | 'west';

/**
 * A walled building shell with a two-tile door on the given side and a
 * two-cell landing in front of it, so no entrance is a dead end.
 */
const building = (
  m: MapData,
  c0: number,
  r0: number,
  w: number,
  h: number,
  wall: number,
  doorSide: DoorSide,
): void => {
  for (let c = c0; c <= c0 + w - 1; c++) {
    setTile(m, c, r0, wall);
    setTile(m, c, r0 + h - 1, wall);
    block(m, c, r0);
    block(m, c, r0 + h - 1);
  }
  for (let r = r0 + 1; r <= r0 + h - 2; r++) {
    setTile(m, c0, r, wall);
    setTile(m, c0 + w - 1, r, wall);
    block(m, c0, r);
    block(m, c0 + w - 1, r);
  }
  for (let r = r0 + 1; r <= r0 + h - 2; r++) {
    for (let c = c0 + 1; c <= c0 + w - 2; c++) {
      setTile(m, c, r, G.ROOF);
      block(m, c, r);
    }
  }

  const midC = c0 + Math.floor(w / 2);
  const midR = r0 + Math.floor(h / 2);
  const doorCells: Array<[number, number]> = [];
  const landingCells: Array<[number, number]> = [];
  if (doorSide === 'south' || doorSide === 'north') {
    const doorRow = doorSide === 'south' ? r0 + h - 1 : r0;
    const step = doorSide === 'south' ? 1 : -1;
    for (const c of [midC - 1, midC]) {
      doorCells.push([c, doorRow]);
      landingCells.push([c, doorRow + step], [c, doorRow + step * 2]);
    }
  } else {
    const doorCol = doorSide === 'east' ? c0 + w - 1 : c0;
    const step = doorSide === 'east' ? 1 : -1;
    for (const r of [midR - 1, midR]) {
      doorCells.push([doorCol, r]);
      landingCells.push([doorCol + step, r], [doorCol + step * 2, r]);
    }
  }
  for (const [c, r] of doorCells) {
    if (!inBounds(c, r)) {
      continue;
    }
    setTile(m, c, r, G.STONE_FLOOR);
    m.collision[r * W + c] = 0;
  }
  for (const [c, r] of landingCells) {
    if (!inBounds(c, r)) {
      continue;
    }
    setTile(m, c, r, G.STONE_FLOOR);
    m.collision[r * W + c] = 0;
  }
};

export const buildVillage = (): { map: MapData; objectLayers: MapObjectLayer[] } => {
  const m = makeMap(W, H);
  const rng = makeRng(0xe6b1);

  woodlandRim(m, rng);

  // ── Primary routes ───────────────────────────────────────────────────────
  // North–south, three cells clear, north gate to south gate.
  fillRect(m, 31, 1, 33, H - 2, G.PATH);
  // East–west, three cells clear, gate to gate.
  fillRect(m, 1, 23, W - 2, 25, G.PATH);

  // ── The square ───────────────────────────────────────────────────────────
  // The gravel plaza is a terrain-channel material with no baked tile GID, so
  // it is written as a terrain override; the stone paving over it is a tile.
  const overrides: Array<[number, number, string]> = [];
  for (let r = 18; r <= 30; r++) {
    for (let c = 26; c <= 39; c++) {
      overrides.push([c, r, 'gravel']);
    }
  }
  fillRect(m, 28, 20, 37, 28, G.STONE_FLOOR);
  // Earth apron under the ward tree.
  for (let r = 21; r <= 26; r++) {
    for (let c = 29; c <= 35; c++) {
      overrides.push([c, r, 'earth']);
    }
  }

  // ── Secondary routes (≥2 cells) ──────────────────────────────────────────
  // Smith's approach: east–west link, then north to the yard.
  fillRect(m, 3, 28, 30, 29, G.PATH);
  fillRect(m, 7, 26, 8, 28, G.PATH);
  // Inn forecourt: from the east–west road up to the inn door.
  fillRect(m, 49, 20, 52, 22, G.PATH);
  // Shop approach: south from the north–south road to the shop landing.
  fillRect(m, 39, 33, 53, 34, G.PATH);
  fillRect(m, 50, 33, 51, 34, G.STONE_FLOOR);
  // Notice-board approach: north from the road, over the bridge.
  fillRect(m, 39, 9, 40, 22, G.PATH);
  fillRect(m, 41, 10, 46, 11, G.PATH);
  // Well approach: west from the square.
  fillRect(m, 23, 22, 26, 23, G.PATH);

  // ── Pads ─────────────────────────────────────────────────────────────────
  fillRect(m, 17, 21, 22, 25, G.STONE_FLOOR); // well
  fillRect(m, 43, 8, 47, 12, G.STONE_FLOOR); // notice board
  fillRect(m, 4, 27, 14, 30, G.STONE_FLOOR); // smith's yard
  fillRect(m, 47, 20, 56, 22, G.STONE_FLOOR); // inn forecourt
  fillRect(m, 47, 33, 56, 34, G.STONE_FLOOR); // shop landing
  fillRect(m, 30, 21, 34, 24, G.STONE_FLOOR); // ward tree apron

  // ── Buildings ────────────────────────────────────────────────────────────
  building(m, 47, 12, 9, 8, G.STONE_WALL, 'south'); // the inn (east)
  building(m, 47, 26, 9, 7, G.WOOD_WALL, 'south'); // the shop (south-east)
  building(m, 4, 30, 9, 7, G.STONE_WALL, 'north'); // the smithy (west)
  building(m, 5, 15, 8, 6, G.WOOD_WALL, 'south'); // cottage (north-west)
  building(m, 16, 15, 7, 6, G.WOOD_WALL, 'south'); // cottage (north)

  stream(m);

  // ── Ground variation and woodland stands ─────────────────────────────────
  scatter(m, rng, 2, 2, W - 3, H - 3, G.GRASS, G.GRASS_DARK, 0.14);
  scatter(m, rng, 2, 2, W - 3, H - 3, G.GRASS, G.GRASS_VARIANT, 0.06);

  m.terrainOverrides = [...(m.terrainOverrides ?? []), ...overrides];

  // ── Containment re-asserted ──────────────────────────────────────────────
  // Pads and paths above may have re-opened rim cells; the rim stays solid
  // except at the gates.
  for (let c = 0; c < W; c++) {
    if (!(GATES.north as readonly number[]).includes(c)) {
      block(m, c, 0);
    }
    if (!(GATES.south as readonly number[]).includes(c)) {
      block(m, c, H - 1);
    }
  }
  for (let r = 0; r < H; r++) {
    if (!(GATES.west as readonly number[]).includes(r)) {
      block(m, 0, r);
    }
    if (!(GATES.east as readonly number[]).includes(r)) {
      block(m, W - 1, r);
    }
  }
  // The gate mouths are cleared across the FULL primary-road corridor (three
  // cells), not just the two gate columns: the road fill runs after the rim
  // thinning, so a corridor cell painted back to a walkable path must not keep
  // the rim's collision — the engine's content audit requires collision to
  // match manifest walkability exactly.
  for (const c of [31, 32]) {
    for (let r = 0; r <= 2; r++) {
      m.collision[r * W + c] = 0;
    }
    for (let r = H - 3; r <= H - 1; r++) {
      m.collision[r * W + c] = 0;
    }
  }
  // The road is three wide INSIDE the village; at the rim only the two gate
  // columns are open, so the third column stays rim woodland.
  for (let r = 1; r <= H - 2; r++) {
    m.collision[r * W + 33] = 0;
  }
  // The stream must never be re-opened by the road fills above.
  for (let i = 0; i < W * H; i++) {
    if (m.ground[i] === G.WATER) {
      m.collision[i] = 1;
    }
  }
  // …and the bridge stays open after that.
  for (const c of [39, 40, 41]) {
    for (const r of [7, 8]) {
      if (m.ground[r * W + c] === G.BRIDGE) {
        m.collision[r * W + c] = 0;
      }
    }
  }

  // ── Overhead canopy over the ward tree ───────────────────────────────────
  // Canopies may overlap actors; the trunk/base footprint is what collides.
  m.overheadExtra = [
    [30, 20, G.ROOF],
    [31, 20, G.ROOF],
    [32, 20, G.ROOF],
    [33, 20, G.ROOF],
    [34, 20, G.ROOF],
  ];

  const objectLayers: MapObjectLayer[] = [
    {
      name: 'spawns',
      type: 'objectgroup',
      visible: true,
      objects: [
        // ── Story NPCs (ids preserved) ─────────────────────────────────────
        npc(1, 'village_elder', 'Elder Thalia', 'elder_thalia_greeting', 32 * 32, 27 * 32),
        npc(11, 'village_guard', 'Bram the Guard', 'bram_greeting', 33 * 32, 43 * 32),
        npc(20, 'smith_orra', 'Orra the Smith', 'orra_greeting', 8 * 32, 29 * 32),
        npc(21, 'cartographer_ivo', 'Ivo the Cartographer', 'ivo_greeting', 21 * 32, 23 * 32),

        // ── Landmarks ──────────────────────────────────────────────────────
        prop(2, 'village_well', 'Old Stone Well', 'well.png', 19 * 32, 24 * 32),
        prop(3, 'notice_board', 'Village Notice Board', 'prop_notice_board.png', 45 * 32, 11 * 32),
        prop(4, 'village_gate', 'Emberwatch Village Gate', 'prop_gate.png', 32 * 32, 45 * 32),
        prop(12, 'ward_tree_landmark', 'The Ward Tree', 'ward_large.png', 32 * 32, 23 * 32),

        // ── Woodland stands (trunk footprint collides, canopy does not) ────
        prop(13, 'woodland_oak', 'Woodland Oak', 'oak.png', 27 * 32, 14 * 32),
        prop(15, 'woodland_oak_2', 'Woodland Oak', 'oak.png', 43 * 32, 15 * 32),
        prop(16, 'woodland_oak_3', 'Woodland Oak', 'oak.png', 11 * 32, 22 * 32),
        prop(17, 'woodland_oak_4', 'Woodland Oak', 'oak.png', 57 * 32, 40 * 32),
        prop(18, 'woodland_birch', 'Woodland Birch', 'birch.png', 23 * 32, 17 * 32),
        prop(19, 'woodland_birch_2', 'Woodland Birch', 'birch.png', 45 * 32, 28 * 32),
        prop(22, 'ward_grove_a', 'Ward Grove (unlit)', 'ward_small_a.png', 28 * 32, 29 * 32),
        prop(14, 'ward_grove_b', 'Ward Grove (lit)', 'ward_small_b.png', 37 * 32, 25 * 32),
        prop(23, 'ward_grove_c', 'Ward Grove (lit)', 'ward_small_c.png', 30 * 32, 20 * 32),

        // ── Building-adjacent clutter (never blocks a route) ───────────────
        prop(24, 'inn_barrel', 'Barrel', 'prop_barrel.png', 54 * 32, 21 * 32),
        prop(25, 'inn_crate', 'Crate', 'crate.png', 56 * 32, 21 * 32),
        prop(26, 'yard_anvil', 'Smith Anvil', 'anvil.png', 5 * 32, 28 * 32),
        prop(27, 'shop_crate', 'Crate', 'crate.png', 55 * 32, 34 * 32),
        prop(28, 'inn_chair', 'Chair', 'chair.png', 44 * 32, 11 * 32),

        // ── Arrival markers ────────────────────────────────────────────────
        spawn(7, 'from_merchant', 3 * 32, 24 * 32),
        spawn(8, 'from_inn', 60 * 32, 24 * 32),
        spawn(9, 'village_gate', 32 * 32, 44 * 32),
        spawn(60, 'from_old_road', 32 * 32, 3 * 32),
      ],
    },
    {
      name: 'transitions',
      type: 'objectgroup',
      visible: true,
      objects: [
        transition(1005, 'merchant_shop', 'shop_entrance', 12 * 32, 15 * 32, 0, 23 * 32, 32, 96),
        transition(1006, 'inn', 'inn_entrance', 14 * 32, 17 * 32, 63 * 32, 23 * 32, 32, 96),
        transition(
          1007,
          'old_road',
          'old_road_from_village',
          OLD_ROAD_ARRIVAL.fromVillage.x,
          OLD_ROAD_ARRIVAL.fromVillage.y,
          31 * 32,
          0,
          64,
          32,
        ),
      ],
    },
  ];

  return { map: m, objectLayers };
};
