// scripts/src/lib/ops/emberwatch_map_retained.ts
//
// Builders for the two retained Emberwatch interiors:
//   inn            28×20
//   merchant_shop  24×18
//
// The village builder moved to `emberwatch_map_village.ts` when the overhaul
// replaced its rectangular sandbox with a composed woodland border village;
// this module re-exports it so the generator's import surface is unchanged.
//
// Both interiors are composed rather than tiled: a real entrance vestibule, a
// service counter with the keeper behind it, a clear rear aisle, furniture
// placed the way the room is actually used, and enough open floor for combat
// and companions. No furniture placement blocks a route.
//
// Every spawn id, transition target, prop id and NPC id is preserved (saves and
// quest objectives depend on them); the golden checks live in
// `generate_emberwatch_maps.test.ts`.

import {
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

export { buildVillage } from './emberwatch_map_village.ts';

// ---------------------------------------------------------------------------
// Inn — 28×20
// ---------------------------------------------------------------------------

/**
 * The Guttering Candle.
 *
 * Layout: a south entrance vestibule (cols 12-15) opening into the common room;
 * Sella's service counter across the west of the room with the rear aisle behind
 * it; Rollo's corner east; tables, chairs, barrels and crates arranged as a
 * working inn rather than scattered decor.
 *
 * The combat proof encounter authors its own environment objects at
 * (7,9)-(10,10); this layout deliberately keeps cols 6-11 × rows 8-11 free of
 * furniture so those placements never stack on a table.
 */
export const buildInn = (): { map: MapData; objectLayers: MapObjectLayer[] } => {
  const W = 28;
  const H = 20;
  const m = makeMap(W, H);
  const rng = makeRng(0x1a11);

  // South entrance, two tiles wide.
  border(m, { south: [13, 14] });

  // Wood floor across the interior.
  for (let r = 2; r < H - 2; r++) {
    for (let c = 2; c <= W - 3; c++) {
      setTile(m, c, r, G.WOOD_FLOOR);
    }
  }
  scatter(m, rng, 2, 2, W - 3, H - 3, G.WOOD_FLOOR, G.WOOD_VAR, 0.16);

  // The vestibule: stone threshold so the entrance reads as a separate space.
  // The south wall-top rim (row H-2) is deliberately left intact — only the
  // two door columns are paved through it, so the interior stays enclosed.
  for (let r = 14; r <= H - 3; r++) {
    for (let c = 12; c <= 15; c++) {
      setTile(m, c, r, G.STONE_FLOOR);
    }
  }
  for (const c of [13, 14]) {
    setTile(m, c, H - 2, G.STONE_FLOOR);
  }

  // Rugs: one under the common room's centre, one at each table cluster.
  setTile(m, 14, 11, G.RUG_ROUND);
  setTile(m, 5, 12, G.RUG);
  setTile(m, 21, 12, G.RUG);

  // Service counter across the west, with the rear aisle behind it.
  setTile(m, 10, 4, G.COUNTER);
  setTile(m, 11, 4, G.COUNTER);
  setTile(m, 12, 4, G.COUNTER);
  m.collision[4 * W + 10] = 1;
  m.collision[4 * W + 11] = 1;
  m.collision[4 * W + 12] = 1;

  const objectLayers: MapObjectLayer[] = [
    {
      name: 'spawns',
      type: 'objectgroup',
      visible: true,
      objects: [
        // ── People ─────────────────────────────────────────────────────────
        npc(1, 'rollo_grasper', 'Rollo the Grasper', 'rollo_greeting', 22 * 32, 6 * 32),
        npc(20, 'innkeeper_sella', 'Sella the Innkeeper', 'sella_greeting', 11 * 32, 3 * 32),

        // ── Service counter and its evidence ───────────────────────────────
        prop(30, 'inn_counter', 'Service Counter', 'counter.png', 10 * 32, 4 * 32),
        prop(31, 'inn_counter_2', 'Service Counter', 'counter.png', 12 * 32, 4 * 32),
        prop(21, 'sella_receipt', "Sella's Custody Receipt", 'prop_receipt.png', 14 * 32, 5 * 32),

        // ── Hearth and storage along the north wall ────────────────────────
        prop(32, 'inn_hearth', 'Hearth', 'prop_hearth.png', 4 * 32, 2 * 32),
        prop(33, 'inn_shelf', 'Storage Shelf', 'bookshelf.png', 24 * 32, 3 * 32),

        // ── Tables and chairs (common room, clear of the combat footprint) ──
        prop(34, 'inn_table', 'Ale Table', 'table.png', 4 * 32, 7 * 32),
        prop(35, 'inn_chair', 'Chair', 'chair.png', 3 * 32, 8 * 32),
        prop(36, 'inn_chair_2', 'Chair', 'chair.png', 5 * 32, 8 * 32),
        prop(37, 'inn_table_2', 'Ale Table', 'table.png', 4 * 32, 12 * 32),
        prop(38, 'inn_chair_3', 'Chair', 'chair.png', 3 * 32, 13 * 32),
        prop(39, 'inn_chair_4', 'Chair', 'chair.png', 5 * 32, 13 * 32),
        prop(40, 'inn_table_3', 'Ale Table', 'table.png', 21 * 32, 12 * 32),
        prop(41, 'inn_chair_5', 'Chair', 'chair.png', 20 * 32, 13 * 32),
        prop(42, 'inn_chair_6', 'Chair', 'chair.png', 22 * 32, 13 * 32),

        // ── Barrels, crates, a bed alcove and the failing roof support ─────
        prop(2, 'inn_barrel', 'Barrel', 'prop_barrel.png', 24 * 32, 5 * 32),
        prop(4, 'inn_barrel_2', 'Barrel', 'prop_barrel.png', 24 * 32, 16 * 32),
        prop(3, 'inn_crate', 'Crate', 'crate.png', 3 * 32, 16 * 32),
        prop(43, 'inn_bed', 'Guest Bed', 'bed.png', 3 * 32, 15 * 32),
        prop(44, 'inn_brazier', 'Brazier', 'prop_brazier.png', 16 * 32, 16 * 32),
        prop(45, 'inn_support', 'Rotting Support', 'prop_support.png', 23 * 32, 9 * 32),

        // ── Arrival marker ─────────────────────────────────────────────────
        spawn(6, 'inn_entrance', 14 * 32, 17 * 32),
      ],
    },
    {
      name: 'transitions',
      type: 'objectgroup',
      visible: true,
      objects: [
        transition(1005, 'village', 'from_inn', 60 * 32, 24 * 32, 13 * 32, 19 * 32, 64, 32),
      ],
    },
  ];

  return { map: m, objectLayers };
};

// ---------------------------------------------------------------------------
// Merchant shop — 24×18
// ---------------------------------------------------------------------------

/**
 * Mara's Provisions.
 *
 * Layout: a south doorway and landing, a public aisle the customer can walk end
 * to end, a lateral counter the merchant stands behind, and a rear storage bay
 * of crates and shelving. The repair ledger (`shop_counter_l`) sits on the
 * counter where a customer can actually reach it.
 */
export const buildShop = (): { map: MapData; objectLayers: MapObjectLayer[] } => {
  const W = 24;
  const H = 18;
  const m = makeMap(W, H);
  const rng = makeRng(0x5b0f);

  // South doorway, two tiles wide.
  border(m, { south: [11, 12] });

  // Stone floor across the interior, with flagstone wear.
  for (let r = 2; r < H - 2; r++) {
    for (let c = 2; c <= W - 3; c++) {
      setTile(m, c, r, G.STONE_FLOOR);
    }
  }
  for (const c of [11, 12]) {
    setTile(m, c, H - 2, G.STONE_FLOOR);
  }
  scatter(m, rng, 2, 2, W - 3, H - 3, G.STONE_FLOOR, G.FLAGSTONE, 0.2);

  // Landing inside the door so the entrance is not a pinch point. The south
  // wall-top rim (row H-2) is left intact; only the two door columns are paved
  // through it.
  for (let r = 13; r <= H - 3; r++) {
    for (let c = 10; c <= 13; c++) {
      setTile(m, c, r, G.STONE_FLOOR);
    }
  }
  for (const c of [11, 12]) {
    setTile(m, c, H - 2, G.STONE_FLOOR);
  }

  // The lateral counter run at row 11, broken by a walk-through gate at cols
  // 11-12 so the aisle and the storage bay are both reachable without walking
  // the long way round. The MAP does not block these cells: the counter PROPS
  // carry their own collision, and the engine's content audit requires the map
  // collision layer to match manifest walkability exactly — a walkable floor
  // GID with collision set is a violation.
  for (let c = 4; c <= 19; c++) {
    setTile(m, c, 11, G.STONE_VAR);
  }

  const objectLayers: MapObjectLayer[] = [
    {
      name: 'spawns',
      type: 'objectgroup',
      visible: true,
      objects: [
        npc(1, 'merchant', 'Mara the Merchant', 'merchant_mara_greeting', 12 * 32, 9 * 32, [
          { name: 'isVendor', type: 'bool', value: true },
          {
            name: 'vendorInventory',
            type: 'string',
            value: 'ironSword,steelSword,healthPotion,manaPotion,ironArmor,woodenShield',
          },
        ]),

        // Counter run (the ledger's discoverable prop is the left section).
        prop(2, 'shop_counter_l', 'Counter', 'counter.png', 4 * 32, 11 * 32),
        prop(3, 'shop_counter_r', 'Counter', 'counter.png', 16 * 32, 11 * 32),
        prop(50, 'shop_counter_m', 'Counter', 'counter.png', 10 * 32, 11 * 32),

        // Rear storage bay.
        prop(51, 'shop_shelf', 'Storage Shelf', 'bookshelf.png', 3 * 32, 3 * 32),
        prop(52, 'shop_shelf_2', 'Storage Shelf', 'bookshelf.png', 20 * 32, 3 * 32),
        prop(4, 'shop_crate', 'Crate', 'crate.png', 5 * 32, 3 * 32),
        prop(53, 'shop_crate_2', 'Crate', 'crate.png', 8 * 32, 3 * 32),
        prop(54, 'shop_crate_3', 'Crate', 'crate.png', 18 * 32, 3 * 32),
        prop(55, 'shop_barrel', 'Barrel', 'prop_barrel.png', 21 * 32, 6 * 32),

        // Public aisle clutter, kept off the walking line.
        prop(56, 'shop_chair', 'Chair', 'chair.png', 4 * 32, 8 * 32),
        prop(57, 'shop_barrel_2', 'Barrel', 'prop_barrel.png', 3 * 32, 14 * 32),

        spawn(6, 'shop_entrance', 12 * 32, 15 * 32),
      ],
    },
    {
      name: 'transitions',
      type: 'objectgroup',
      visible: true,
      objects: [
        transition(1005, 'village', 'from_merchant', 3 * 32, 24 * 32, 11 * 32, 17 * 32, 64, 32),
      ],
    },
  ];

  return { map: m, objectLayers };
};
