// scripts/src/lib/ops/emberwatch_map_retained.ts
//
// Builders for the three retained Emberwatch scenes, expanded to the plan's
// proposed extents (gate 3):
//   village        64×48
//   inn            28×20
//   merchant_shop  24×18
//
// Every spawn id, transition target, prop id and NPC id from the previous
// maps is preserved (saves and quest objectives depend on them). Positions
// are re-authored for the larger layouts; the golden checks live in
// `generate_emberwatch_maps.test.ts`.

import {
  block,
  border,
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

/** Wall shell + roof interior + a two-tile door opening on the south wall. */
const house = (m: MapData, c0: number, r0: number, w: number, h: number): void => {
  for (let c = c0; c <= c0 + w - 1; c++) {
    setTile(m, c, r0, G.STONE_WALL);
    setTile(m, c, r0 + h - 1, G.STONE_WALL);
    block(m, c, r0);
    block(m, c, r0 + h - 1);
  }
  for (let r = r0 + 1; r <= r0 + h - 2; r++) {
    setTile(m, c0, r, G.STONE_WALL);
    setTile(m, c0 + w - 1, r, G.STONE_WALL);
    block(m, c0, r);
    block(m, c0 + w - 1, r);
  }
  for (let r = r0 + 1; r <= r0 + h - 2; r++) {
    for (let c = c0 + 1; c <= c0 + w - 2; c++) {
      setTile(m, c, r, G.ROOF);
      block(m, c, r);
    }
  }
  // Door: two centred floor tiles on the south wall, unblocked.
  const mid = c0 + Math.floor(w / 2);
  for (const c of [mid - 1, mid]) {
    setTile(m, c, r0 + h - 1, G.GRASS);
    m.collision[(r0 + h - 1) * m.width + c] = 0;
  }
};

// ---------------------------------------------------------------------------
// Village — 64×48
// ---------------------------------------------------------------------------

export const buildVillage = (): { map: MapData; objectLayers: MapObjectLayer[] } => {
  const W = 64;
  const H = 48;
  const m = makeMap(W, H);
  const rng = makeRng(0xc375);

  // North gate (cols 31-32) → old_road; south arrival (cols 31-32); west
  // gate (rows 23-25) → merchant_shop; east gate (rows 23-25) → inn.
  border(m, {
    north: [31, 32],
    south: [31, 32],
    west: [23, 24, 25],
    east: [23, 24, 25],
  });

  // Central gravel plaza with an embedded earth patch (corner16 materials).
  const overrides: Array<[number, number, string]> = [];
  for (let r = 20; r <= 28; r++) {
    for (let c = 26; c <= 38; c++) {
      overrides.push([c, r, 'gravel']);
    }
  }
  for (let r = 23; r <= 25; r++) {
    for (let c = 30; c <= 35; c++) {
      overrides.push([c, r, 'earth']);
    }
  }
  m.terrainOverrides = overrides;

  // Paths: north and south approaches meet the plaza; west/east approaches
  // run from the side gates into it.
  for (const c of [31, 32]) {
    for (let r = 2; r <= 45; r++) {
      setTile(m, c, r, G.PATH);
    }
  }
  for (const r of [23, 24, 25]) {
    for (let c = 2; c <= 61; c++) {
      setTile(m, c, r, G.PATH);
    }
  }
  // Dirt edges flank the approaches.
  for (const c of [30, 33]) {
    for (let r = 4; r <= 44; r++) {
      setTile(m, c, r, G.DIRT);
    }
  }

  // Ward tree plaza — a stone apron at the square's heart.
  for (let r = 22; r <= 26; r++) {
    for (let c = 30; c <= 34; c++) {
      setTile(m, c, r, G.STONE_FLOOR);
    }
  }

  // Well pad (west of the square) and notice-board pad (east of it).
  for (let r = 22; r <= 26; r++) {
    for (let c = 18; c <= 22; c++) {
      setTile(m, c, r, G.STONE_FLOOR);
    }
  }
  for (let r = 22; r <= 26; r++) {
    for (let c = 42; c <= 46; c++) {
      setTile(m, c, r, G.STONE_FLOOR);
    }
  }
  // Smith yard (in front of the south-west smithy), market apron.
  for (let r = 30; r <= 33; r++) {
    for (let c = 4; c <= 10; c++) {
      setTile(m, c, r, G.STONE_FLOOR);
    }
  }
  for (let r = 30; r <= 33; r++) {
    for (let c = 42; c <= 50; c++) {
      setTile(m, c, r, G.STONE_FLOOR);
    }
  }

  // Houses: NW cottage, NE inn facade, SW smithy, SE shop.
  house(m, 4, 4, 7, 6);
  house(m, 52, 4, 8, 7);
  house(m, 4, 34, 7, 7);
  house(m, 52, 34, 8, 7);

  // Stream in the north-east woodland.
  for (let r = 8; r <= 13; r++) {
    for (let c = 44; c <= 50; c++) {
      setTile(m, c, r, G.WATER);
      block(m, c, r);
    }
  }
  for (let r = 7; r <= 14; r++) {
    for (let c = 43; c <= 51; c++) {
      if (m.ground[r * W + c] !== G.WATER) {
        setTile(m, c, r, G.DIRT);
      }
    }
  }

  // Quiet grass variation, then boundary trees.
  scatter(m, rng, 2, 2, W - 3, H - 3, G.GRASS, G.GRASS_DARK, 0.12);
  for (const [c, r] of [
    [2, 2],
    [14, 2],
    [18, 17],
    [24, 8],
    [40, 8],
    [47, 30],
    [2, 18],
    [61, 33],
    [14, 45],
    [49, 45],
    [24, 31],
  ] as const) {
    setTile(m, c, r, G.PLANT);
    block(m, c, r);
  }

  // Overhead gate arch above the southern arrival.
  m.overheadExtra = [
    [31, 44, G.ROOF],
    [32, 44, G.ROOF],
    [31, 45, G.ROOF],
    [32, 45, G.ROOF],
  ];

  const objectLayers: MapObjectLayer[] = [
    {
      name: 'spawns',
      type: 'objectgroup',
      visible: true,
      objects: [
        npc(1, 'village_elder', 'Elder Thalia', 'elder_thalia_greeting', 32 * 32, 25 * 32),
        npc(11, 'village_guard', 'Bram the Guard', 'bram_greeting', 33 * 32, 43 * 32),
        npc(20, 'smith_orra', 'Orra the Smith', 'orra_greeting', 7 * 32, 32 * 32),
        npc(21, 'cartographer_ivo', 'Ivo the Cartographer', 'ivo_greeting', 46 * 32, 32 * 32),
        prop(2, 'village_well', 'Old Stone Well', 'well.png', 20 * 32, 24 * 32),
        prop(3, 'notice_board', 'Village Notice Board', 'notice_board.png', 44 * 32, 24 * 32),
        prop(4, 'village_gate', 'Emberwatch Village Gate', 'village_gate.png', 32 * 32, 46 * 32),
        prop(12, 'ward_tree_landmark', 'The Ward Tree', 'ward_large.png', 32 * 32, 22 * 32),
        prop(13, 'woodland_oak', 'Woodland Oak', 'oak.png', 24 * 32, 21 * 32),
        prop(14, 'ward_grove_b', 'Ward Grove (lit)', 'ward_small_b.png', 40 * 32, 21 * 32),
        spawn(7, 'from_merchant', 3 * 32, 24 * 32),
        spawn(8, 'from_inn', 60 * 32, 24 * 32),
        spawn(9, 'village_gate', 32 * 32, 45 * 32),
        spawn(22, 'from_old_road', 32 * 32, 3 * 32),
      ],
    },
    {
      name: 'transitions',
      type: 'objectgroup',
      visible: true,
      objects: [
        transition(5, 'merchant_shop', 'shop_entrance', 12 * 32, 15 * 32, 0, 23 * 32, 32, 96),
        transition(6, 'inn', 'inn_entrance', 14 * 32, 17 * 32, 63 * 32, 23 * 32, 32, 96),
        transition(7, 'old_road', 'old_road_from_village', 34 * 32, 35 * 32, 31 * 32, 0, 64, 32),
      ],
    },
  ];

  return { map: m, objectLayers };
};

// ---------------------------------------------------------------------------
// Inn — 28×20 (wood floor interior, furniture props as spawned entities)
// ---------------------------------------------------------------------------

export const buildInn = (): { map: MapData; objectLayers: MapObjectLayer[] } => {
  const W = 28;
  const H = 20;
  const m = makeMap(W, H);
  const rng = makeRng(0x1a11);

  // Bottom door gap at cols 13-14.
  border(m, { south: [13, 14] });

  // Wood floor with variant patches and rugs.
  for (let r = 2; r <= H - 2; r++) {
    for (let c = 2; c <= W - 3; c++) {
      setTile(m, c, r, G.WOOD_FLOOR);
    }
  }
  setTile(m, 1, H - 2, G.WOOD_FLOOR);
  setTile(m, W - 2, H - 2, G.WOOD_FLOOR);
  scatter(m, rng, 2, 2, W - 3, H - 3, G.WOOD_FLOOR, G.WOOD_VAR, 0.16);
  setTile(m, 14, 10, G.RUG_ROUND);
  setTile(m, 6, 14, G.RUG);
  setTile(m, 22, 14, G.RUG);

  const objectLayers: MapObjectLayer[] = [
    {
      name: 'spawns',
      type: 'objectgroup',
      visible: true,
      objects: [
        npc(1, 'rollo_grasper', 'Rollo the Grasper', 'rollo_greeting', 22 * 32, 5 * 32),
        npc(20, 'innkeeper_sella', 'Sella the Innkeeper', 'sella_greeting', 13 * 32, 8 * 32),
        prop(2, 'inn_barrel', 'Barrel', 'barrel.png', 3 * 32, 3 * 32),
        prop(4, 'inn_barrel_2', 'Barrel', 'barrel.png', 24 * 32, 3 * 32),
        prop(3, 'inn_crate', 'Crate', 'crate.png', 24 * 32, 15 * 32),
        prop(21, 'sella_receipt', "Sella's Custody Receipt", 'notice_board.png', 15 * 32, 8 * 32),
        spawn(6, 'inn_entrance', 14 * 32, 17 * 32),
      ],
    },
    {
      name: 'transitions',
      type: 'objectgroup',
      visible: true,
      objects: [transition(5, 'village', 'from_inn', 60 * 32, 24 * 32, 13 * 32, 19 * 32, 64, 32)],
    },
  ];

  return { map: m, objectLayers };
};

// ---------------------------------------------------------------------------
// Merchant shop — 24×18 (stone floor, lateral counter)
// ---------------------------------------------------------------------------

export const buildShop = (): { map: MapData; objectLayers: MapObjectLayer[] } => {
  const W = 24;
  const H = 18;
  const m = makeMap(W, H);
  const rng = makeRng(0x5b0f);

  // Bottom door gap at cols 11-12.
  border(m, { south: [11, 12] });

  // Stone floor with flagstone patches; a raised counter strip at row 11.
  for (let r = 2; r <= H - 2; r++) {
    for (let c = 2; c <= W - 3; c++) {
      setTile(m, c, r, G.STONE_FLOOR);
    }
  }
  setTile(m, 1, H - 2, G.STONE_FLOOR);
  setTile(m, W - 2, H - 2, G.STONE_FLOOR);
  scatter(m, rng, 2, 2, W - 3, H - 3, G.STONE_FLOOR, G.FLAGSTONE, 0.2);
  for (let c = 2; c <= W - 3; c++) {
    setTile(m, c, 11, G.STONE_VAR);
  }

  const objectLayers: MapObjectLayer[] = [
    {
      name: 'spawns',
      type: 'objectgroup',
      visible: true,
      objects: [
        npc(1, 'merchant', 'Mara the Merchant', 'merchant_mara_greeting', 12 * 32, 4 * 32, [
          { name: 'isVendor', type: 'bool', value: true },
          {
            name: 'vendorInventory',
            type: 'string',
            value: 'ironSword,steelSword,healthPotion,manaPotion,ironArmor,woodenShield',
          },
        ]),
        prop(2, 'shop_counter_l', 'Counter', 'counter.png', 4 * 32, 11 * 32),
        prop(3, 'shop_counter_r', 'Counter', 'counter.png', 18 * 32, 11 * 32),
        prop(4, 'shop_crate', 'Crate', 'crate.png', 12 * 32, 11 * 32),
        spawn(6, 'shop_entrance', 12 * 32, 15 * 32),
      ],
    },
    {
      name: 'transitions',
      type: 'objectgroup',
      visible: true,
      objects: [
        transition(5, 'village', 'from_merchant', 3 * 32, 24 * 32, 11 * 32, 17 * 32, 64, 32),
      ],
    },
  ];

  return { map: m, objectLayers };
};
