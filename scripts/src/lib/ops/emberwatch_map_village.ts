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
//   gates  north cols 31-33 (row 0) · south cols 31-33 (row 47)
//          west rows 23-25 (col 0)  · east rows 23-25 (col 63)
//   arrival spawns sit clear of every transition rectangle on this map.

import {
  assertNoHousePropOverlaps,
  cell,
  isBridgeGid,
  OLD_ROAD_ARRIVAL,
  placeBridge,
  placeHouse,
  placeLandmark,
  placeNpc,
  placeProp,
  placeSpawn,
  placeTransition,
} from './emberwatch_authoring.ts';
import {
  block,
  fillRect,
  type MapData,
  type MapObjectLayer,
  makeMap,
  makeRng,
  scatter,
  scatterPatches,
  setTile,
} from './emberwatch_map_shared.ts';
import { buildG } from './generate_emberwatch_tables.ts';

const G = buildG();

const W = 64;
const H = 48;

/**
 * The four perimeter gates, kept walkable all the way through the rim.
 *
 * The north/south gates are three cells wide so the village's primary
 * north–south route keeps its companion-safe width (3 cells) through the
 * woodland rim instead of pinching to two at the gate mouth. West/east are
 * already three rows tall.
 */
const GATES = {
  north: [31, 32, 33],
  south: [31, 32, 33],
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
/**
 * The outermost ring: forest floor, blocked by trunks, broken at each gate.
 */
const paintOuterRing = (m: MapData): void => {
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
};

/** Opens the four gates through the outer ring. */
const openGates = (m: MapData): void => {
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
};

/** Gate mouths stay clear two cells in, so an arrival never lands on a trunk. */
const gateMouthCells = (): Set<number> => {
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
  return clear;
};

/** One ring in, the treeline thins with irregular gaps and the gate mouths stay open. */
const thinTreeline = (m: MapData, rng: () => number, clear: Set<number>): void => {
  const thinned = (c: number, r: number): boolean => clear.has(r * W + c) || rng() < 0.45;
  for (let c = 1; c < W - 1; c++) {
    for (const r of [1, H - 2]) {
      if (thinned(c, r)) {
        continue;
      }
      setTile(m, c, r, G.PLANT);
      block(m, c, r);
    }
  }
  for (let r = 1; r < H - 1; r++) {
    for (const c of [1, W - 2]) {
      if (thinned(c, r)) {
        continue;
      }
      setTile(m, c, r, G.PLANT);
      block(m, c, r);
    }
  }
};

/**
 * The woodland rim.
 *
 * The outermost ring stays solid so an actor can never leave the map, but it is
 * painted as forest floor and blocked with trunks — not a stone wall — and it is
 * broken at each gate. One ring in, the treeline thins with irregular gaps, so
 * the boundary reads as woodland rather than a box.
 */
const woodlandRim = (m: MapData, rng: () => number): void => {
  paintOuterRing(m);
  openGates(m);
  thinTreeline(m, rng, gateMouthCells());
};

/** The stream's channel, from the north-east treeline to the west rim. */
const streamChannel = (): Array<[number, number]> => {
  const channel: Array<[number, number]> = [];
  for (let c = 60; c >= 40; c--) {
    channel.push([c, 2]);
  }
  for (let r = 3; r <= 7; r++) {
    channel.push([40, r]);
  }
  // C-549: the E–W reach is two rows deep (7–8) from its west end to the elbow
  // at col 40, so the crossing sits on a straight span whose long sides are
  // water and whose travel ends are dry land.
  for (let c = 40; c >= 26; c--) {
    channel.push([c, 7], [c, 8]);
  }
  for (let r = 8; r <= 12; r++) {
    channel.push([26, r]);
  }
  for (let c = 25; c >= 2; c--) {
    channel.push([c, 12]);
  }
  return channel;
};

/** Pass 1: lay the channel as water, blocked. */
const layChannel = (m: MapData, channel: Array<[number, number]>): void => {
  for (const [c, r] of channel) {
    if (!inBounds(c, r)) {
      continue;
    }
    setTile(m, c, r, G.WATER);
    block(m, c, r);
  }
};

/**
 * Pass 2: bank the channel. Done after the whole channel is laid, so a cell
 * that is a neighbour of an EARLIER channel cell but becomes water itself is
 * never banked. The bank is a dry `sand` shore (a baked decor tile) — the
 * gravel terrain material is not carried by the published atlas, so using it
 * would render as fallback grass.
 */
const bankChannel = (m: MapData, channel: Array<[number, number]>): void => {
  // The generic pass follows the stream's inner (south/east) shore. The
  // straight E–W reach gets a paired-bank pass below so its two banks use the
  // same material.
  const neighbours = [
    [0, 1],
    [1, 0],
  ] as const;
  for (const [c, r] of channel) {
    if (!inBounds(c, r)) {
      continue;
    }
    for (const [dc, dr] of neighbours) {
      const nc = c + dc;
      const nr = r + dr;
      if (!inBounds(nc, nr)) {
        continue;
      }
      if (m.ground[nr * W + nc] === G.WATER || m.collision[nr * W + nc] === 1) {
        continue;
      }
      setTile(m, nc, nr, G.SAND);
    }
  }
};

/**
 * Paints the two dry banks of the straight E–W reach with the same material.
 * The channel's generic bank pass follows the stream's inner corner, which
 * leaves only a south-side strip at this reach. Keep the banks paired here;
 * the short worn approaches are painted after this pass.
 */
const bankStraightReach = (m: MapData): void => {
  for (let c = 26; c <= 40; c++) {
    for (const r of [6, 9]) {
      if (!inBounds(c, r)) {
        continue;
      }
      const index = r * W + c;
      if (m.ground[index] === G.WATER || m.collision[index] === 1) {
        continue;
      }
      setTile(m, c, r, G.SAND);
    }
  }
};

/** The wooden bridge: the only dry crossing of the stream. */
const buildStreamBridge = (m: MapData): void => {
  // C-549: on the straight E–W reach, so the strict bank check holds — both
  // travel ends are dry land and both long sides are water. Three columns keep
  // the north-road route companion-safe instead of creating a new two-cell
  // bottleneck at the widened crossing.
  placeBridge(m, {
    region: { c0: 36, r0: 7, c1: 38, r1: 8 },
    axis: 'ns',
    mapId: 'village',
  });
};

/**
 * The stream.
 *
 * Enters from the north-east treeline, runs west inside the northern rim and
 * drains out through the west rim. It shapes the perimeter instead of sitting in
 * the middle of the map as a decorative pond. Collision stays semantic — water
 * blocks — and the only dry crossing is the wooden bridge on the notice-board
 * approach.
 */
const stream = (m: MapData): void => {
  const channel = streamChannel();
  layChannel(m, channel);
  bankChannel(m, channel);
  bankStraightReach(m);
  buildStreamBridge(m);
};

/**
 * ── Primary routes ─────────────────────────────────────────────────────────
 * North–south, three cells clear, north gate to south gate; then east–west,
 * three cells clear, gate to gate.
 */
const paintPrimaryRoutes = (m: MapData): void => {
  fillRect(m, 31, 1, 33, H - 2, G.PATH);
  fillRect(m, 1, 23, W - 2, 25, G.PATH);
};

/**
 * ── Secondary routes (≥2 cells) ────────────────────────────────────────────
 *
 * These are trodden earth (the autotiled `dirt` terrain), not cobblestone:
 * the village's cobbled roads are the two primary routes, and every side path
 * is worn dirt, so the hierarchy reads at a glance.
 *
 * Order matters against the square: the side paths are painted after the
 * gravel square, and the square's paving is what a walker sees where they
 * overlap.
 */
const paintSecondaryRoutes = (m: MapData): void => {
  // Smith's approach: east–west link, then north to the yard.
  fillRect(m, 3, 28, 30, 29, G.DIRT);
  fillRect(m, 7, 26, 8, 28, G.DIRT);
  // Inn forecourt: from the east–west road up to the inn door.
  fillRect(m, 49, 20, 52, 22, G.DIRT);
  // Shop approach: south from the north–south road to the shop landing.
  fillRect(m, 39, 33, 53, 34, G.DIRT);
  fillRect(m, 50, 33, 51, 34, G.STONE_FLOOR);
  // Notice-board approach: north from the road to the crossing's south bank.
  // The short spurs onto each bank are painted after the stream so the bank
  // sand cannot overwrite them (see paintNoticeBoardApproach).
  fillRect(m, 39, 9, 40, 22, G.DIRT);
  // Well approach: west from the square.
  fillRect(m, 23, 22, 26, 23, G.DIRT);
  // A worn spur down to the south shed, so the south-west is not dead grass.
  fillRect(m, 26, 29, 27, 35, G.DIRT);
};

/** ── Pads ─────────────────────────────────────────────────────────────────── */
const paintPads = (m: MapData): void => {
  fillRect(m, 17, 21, 22, 25, G.STONE_FLOOR); // well
  fillRect(m, 4, 27, 14, 30, G.STONE_FLOOR); // smith's yard
  fillRect(m, 47, 20, 56, 22, G.STONE_FLOOR); // inn forecourt
  fillRect(m, 47, 33, 56, 34, G.STONE_FLOOR); // shop landing
};

/**
 * The notice board's compact worn approach (C-549).
 *
 * The existing dirt path at cols 39–40 runs north to the crossing's south bank;
 * a short three-cell landing meets the span on each bank. The board keeps a
 * grass surround; only the narrow approach below it is worn earth, so the
 * shared corner16 painter never gets a broad slab to turn into a sawtooth.
 */
const paintNoticeBoardApproach = (m: MapData): void => {
  // Reassert the authored trunk after the symmetric bank pass.
  fillRect(m, 39, 9, 40, 22, G.DIRT);
  fillRect(m, 35, 9, 38, 9, G.DIRT);
  fillRect(m, 36, 10, 38, 10, G.DIRT);
  fillRect(m, 37, 11, 38, 11, G.DIRT);
  setTile(m, 40, 11, G.DIRT);
  setTile(m, 39, 11, G.GRASS);
  setTile(m, 38, 12, G.DIRT);
  fillRect(m, 36, 5, 38, 5, G.DIRT); // short worn landing below the board
  fillRect(m, 36, 6, 38, 6, G.DIRT); // north landing → board walk
};

/** All seven village structures share the C-550/C-553 raised-house assembly. */
const placeBuildings = (m: MapData): void => {
  placeHouse(m, {
    region: { c0: 47, r0: 12, c1: 55, r1: 19 },
    door: { c: 51, state: 'open' },
    facing: 's',
    roofMaterial: 'slate',
    mapId: 'village',
  });
  placeHouse(m, {
    region: { c0: 47, r0: 26, c1: 55, r1: 32 },
    door: { c: 51, state: 'open' },
    facing: 's',
    roofMaterial: 'thatch',
    mapId: 'village',
  });
  placeHouse(m, {
    region: { c0: 4, r0: 30, c1: 12, r1: 36 },
    door: { c: 8, state: 'closed' },
    facing: 's',
    roofMaterial: 'slate',
    mapId: 'village',
  });
  placeHouse(m, {
    region: { c0: 5, r0: 15, c1: 12, r1: 20 },
    door: { c: 9, state: 'closed' },
    facing: 's',
    roofMaterial: 'cedar',
    mapId: 'village',
  });
  placeHouse(m, {
    region: { c0: 18, r0: 13, c1: 24, r1: 18 },
    door: { c: 21, state: 'closed' },
    facing: 's',
    roofMaterial: 'cedar',
    mapId: 'village',
  });
  placeHouse(m, {
    region: { c0: 24, r0: 36, c1: 30, r1: 41 },
    door: { c: 27, state: 'closed' },
    facing: 's',
    roofMaterial: 'thatch',
    mapId: 'village',
  });
  placeHouse(m, {
    region: { c0: 51, r0: 5, c1: 56, r1: 9 },
    door: { c: 54, state: 'closed' },
    facing: 's',
    roofMaterial: 'cedar',
    mapId: 'village',
  });
};

/**
 * The village square as an irregular lozenge rather than a rectangle, one
 * `[row, c0, c1]` span per row. Authored in warm trodden earth (the autotiled
 * `dirt` terrain) so the edge blends into the surrounding grass instead of
 * ending on a hard rectangular seam.
 */
const SQUARE_SPANS: ReadonlyArray<readonly [number, number, number]> = [
  [19, 30, 35],
  [20, 29, 36],
  [21, 28, 37],
  [22, 27, 38],
  [23, 25, 39],
  [24, 26, 40],
  [25, 27, 38],
  [26, 28, 37],
  [27, 29, 36],
  [28, 30, 35],
];

/** Small asymmetric worn patches keep the lozenge from reading as a stamp. */
const SQUARE_EDGE_SPURS: ReadonlyArray<readonly [number, number]> = [
  [31, 18],
  [34, 18],
  [25, 22],
  [40, 24],
  [30, 29],
  [35, 29],
];

/**
 * The ward circle: a rounded ring of trodden stone around the tree, so the
 * landmark has a deliberate surrounding path shape and its own negative space.
 */
const WARD_RING: ReadonlyArray<readonly [number, number]> = [
  [31, 20],
  [32, 20],
  [33, 20],
  [30, 21],
  [34, 21],
  [29, 22],
  [35, 22],
  [29, 23],
  [35, 23],
  [29, 24],
  [35, 24],
  [30, 25],
  [34, 25],
  [31, 26],
  [32, 26],
  [33, 26],
];

/** The rim stays solid except at the gates, whatever the pads and paths painted. */
const sealRimExceptGates = (m: MapData): void => {
  const north = GATES.north as readonly number[];
  const south = GATES.south as readonly number[];
  const west = GATES.west as readonly number[];
  const east = GATES.east as readonly number[];
  for (let c = 0; c < W; c++) {
    if (!north.includes(c)) {
      block(m, c, 0);
    }
    if (!south.includes(c)) {
      block(m, c, H - 1);
    }
  }
  for (let r = 0; r < H; r++) {
    if (!west.includes(r)) {
      block(m, 0, r);
    }
    if (!east.includes(r)) {
      block(m, W - 1, r);
    }
  }
};

/**
 * The gate mouths are cleared across the FULL primary-road corridor (three
 * cells), not just the gate columns: the road fill runs after the rim
 * thinning, so a corridor cell painted back to a walkable path must not keep
 * the rim's collision — the engine's content audit requires collision to
 * match manifest walkability exactly.
 */
const clearGateCorridors = (m: MapData): void => {
  const north = GATES.north as readonly number[];
  const south = GATES.south as readonly number[];
  for (const c of north) {
    for (let r = 0; r <= 2; r++) {
      m.collision[r * W + c] = 0;
    }
  }
  for (const c of south) {
    for (let r = H - 3; r <= H - 1; r++) {
      m.collision[r * W + c] = 0;
    }
  }
  // The road is three wide through the whole village; every gate column stays
  // open between the gate mouths so the rim never re-narrows it.
  for (const c of [...north, ...south]) {
    for (let r = 1; r <= H - 2; r++) {
      m.collision[r * W + c] = 0;
    }
  }
};

/** The stream must never be re-opened by the road fills above… */
const resealWater = (m: MapData): void => {
  for (let i = 0; i < W * H; i++) {
    if (m.ground[i] === G.WATER) {
      m.collision[i] = 1;
    }
  }
};

/** …and the bridge stays open after that. */
const reopenBridge = (m: MapData): void => {
  for (const c of [36, 37, 38]) {
    for (const r of [7, 8]) {
      if (isBridgeGid(m.ground[r * W + c])) {
        m.collision[r * W + c] = 0;
      }
    }
  }
};

/** Containment re-asserted: pads and paths may have re-opened rim cells. */
const reassertContainment = (m: MapData): void => {
  sealRimExceptGates(m);
  clearGateCorridors(m);
  resealWater(m);
  reopenBridge(m);
};

export const buildVillage = (): { map: MapData; objectLayers: MapObjectLayer[] } => {
  const m = makeMap(W, H);
  const rng = makeRng(0xe6b1);

  woodlandRim(m, rng);
  // The square is warm trodden earth (autotiled `dirt`); the cobbled roads and
  // the paved ward circle paint over it, so the square reads as ground between
  // the roads rather than a slab the roads cut through.
  for (const [r, c0, c1] of SQUARE_SPANS) {
    fillRect(m, c0, r, c1, r, G.DIRT);
  }
  for (const [c, r] of SQUARE_EDGE_SPURS) {
    setTile(m, c, r, G.DIRT);
  }
  for (const [c, r] of WARD_RING) {
    setTile(m, c, r, G.STONE_FLOOR);
  }
  paintPrimaryRoutes(m);
  paintSecondaryRoutes(m);
  paintPads(m);
  placeBuildings(m);
  stream(m);
  paintNoticeBoardApproach(m);

  // ── Ground variation and woodland stands ─────────────────────────────────
  // C-549: broad, soft grass patches (deterministic value noise), not
  // independent per-cell flecks that advertise the grid (plan §1.6).
  scatterPatches({
    map: m,
    seed: 0x5a11,
    c0: 2,
    r0: 2,
    c1: W - 3,
    r1: H - 3,
    baseGid: G.GRASS,
    gid: G.GRASS_DARK,
    threshold: 0.62,
  });
  scatterPatches({
    map: m,
    seed: 0x5a12,
    c0: 2,
    r0: 2,
    c1: W - 3,
    r1: H - 3,
    baseGid: G.GRASS,
    gid: G.GRASS_VARIANT,
    threshold: 0.82,
  });
  // Paving wear through the earthen square.
  scatter(m, rng, 26, 19, 39, 28, G.DIRT, G.FLAGSTONE, 0.14);

  reassertContainment(m);

  const objectLayers: MapObjectLayer[] = [
    {
      name: 'spawns',
      type: 'objectgroup',
      visible: true,
      objects: [
        // ── Story NPCs (ids preserved) ─────────────────────────────────────
        placeNpc(1, 'village_elder', 'Elder Thalia', 'elder_thalia_greeting', 32, 27),
        placeNpc(11, 'village_guard', 'Bram the Guard', 'bram_greeting', 33, 43),
        placeNpc(20, 'smith_orra', 'Orra the Smith', 'orra_greeting', 8, 29),
        placeNpc(21, 'cartographer_ivo', 'Ivo the Cartographer', 'ivo_greeting', 21, 23),

        // ── Landmarks ──────────────────────────────────────────────────────
        placeLandmark(2, 'village_well', 'Old Stone Well', 'prop_well.png', 19, 24),
        placeLandmark(3, 'notice_board', 'Village Notice Board', 'prop_notice_board.png', 37, 4),
        placeLandmark(4, 'village_gate', 'Emberwatch Village Gate', 'prop_gate.png', 32, 45),
        placeLandmark(12, 'ward_tree_landmark', 'The Ward Tree', 'ward_large.png', 32, 23),

        // ── Woodland stands (trunk footprint collides, canopy does not) ────
        // Ordinary trees sit on the village edge and leave the square's air
        // to the ward tree; the ward groves frame the landmark at three sides
        // and the south-east stays open toward the services.
        placeProp(13, 'woodland_oak', 'Woodland Oak', 'oak.png', 27, 14),
        placeProp(15, 'woodland_oak_2', 'Woodland Oak', 'oak.png', 44, 16),
        placeProp(16, 'woodland_oak_3', 'Woodland Oak', 'oak.png', 15, 20),
        placeProp(17, 'woodland_oak_4', 'Woodland Oak', 'oak.png', 56, 40),
        placeProp(18, 'woodland_birch', 'Woodland Birch', 'birch.png', 27, 17),
        placeProp(19, 'woodland_birch_2', 'Woodland Birch', 'birch.png', 45, 29),
        placeProp(22, 'ward_grove_a', 'Ward Grove (unlit)', 'ward_small_a.png', 35, 26),
        placeProp(14, 'ward_grove_b', 'Ward Grove (lit)', 'ward_small_b.png', 35, 20),
        placeProp(23, 'ward_grove_c', 'Ward Grove (lit)', 'ward_small_c.png', 29, 20),

        // ── Building-adjacent clutter (never blocks a route) ───────────────
        placeProp(24, 'inn_barrel', 'Barrel', 'prop_barrel.png', 56, 22),
        placeProp(25, 'inn_crate', 'Crate', 'prop_crate.png', 5, 27),
        placeProp(26, 'yard_anvil', 'Smith Anvil', 'prop_anvil.png', 5, 28),
        placeProp(27, 'shop_crate', 'Crate', 'prop_crate.png', 55, 35),
        placeProp(28, 'inn_chair', 'Chair', 'chair.png', 55, 22),
        // One existing prop definition, used as the inn's warm door light.
        placeProp(61, 'inn_brazier', 'Inn Door Brazier', 'prop_brazier.png', 53, 22),

        // ── Arrival markers ────────────────────────────────────────────────
        placeSpawn(7, 'from_merchant', 51, 36),
        placeSpawn(8, 'from_inn', 51, 23),
        placeSpawn(9, 'village_gate', 32, 44),
        placeSpawn(60, 'from_old_road', 32, 3),
      ],
    },
    {
      name: 'transitions',
      type: 'objectgroup',
      visible: true,
      objects: [
        placeTransition({
          id: 1005,
          targetMap: 'merchant_shop',
          targetSpawnId: 'shop_entrance',
          target: { x: cell(12), y: cell(15) },
          at: { c: 51, r: 33, width: 1, height: 2 },
        }),
        placeTransition({
          id: 1006,
          targetMap: 'inn',
          targetSpawnId: 'inn_entrance',
          target: { x: cell(14), y: cell(17) },
          at: { c: 51, r: 20, width: 1, height: 2 },
        }),
        placeTransition({
          id: 1007,
          targetMap: 'old_road',
          targetSpawnId: 'old_road_from_village',
          target: {
            x: OLD_ROAD_ARRIVAL.fromVillage.x,
            y: OLD_ROAD_ARRIVAL.fromVillage.y,
          },
          // Two rows tall: the actor's feet are clamped to y >= ENTITY_HEIGHT_ABOVE
          // (32px), so a one-row rect (y 0..32) sits entirely above legal
          // foot-space and never fires. The trigger reaches inward over row 1 so
          // it overlaps the strip the player can actually stand in.
          at: { c: 31, r: 0, width: 3, height: 2 },
        }),
      ],
    },
  ];

  assertNoHousePropOverlaps({ map: m, objectLayers });
  return { map: m, objectLayers };
};
