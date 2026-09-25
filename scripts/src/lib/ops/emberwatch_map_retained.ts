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

import { cell, placeNpc, placeProp, placeSpawn, placeTransition } from './emberwatch_authoring.ts';
import {
  border,
  type MapData,
  type MapObjectLayer,
  makeMap,
  makeRng,
  scatter,
  setTile,
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

  // South entrance, three tiles wide — the companion-safe corridor width.
  border(m, { south: [13, 14, 15] });

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
      setTile(m, c, r, G.STONE_VAR);
    }
  }
  for (const c of [13, 14, 15]) {
    setTile(m, c, H - 2, G.STONE_VAR);
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
        // Rollo sits at the east table cluster, not alone in a corner.
        placeNpc(1, 'rollo_grasper', 'Rollo the Grasper', 'rollo_greeting', 19, 10),
        placeNpc(20, 'innkeeper_sella', 'Sella the Innkeeper', 'sella_greeting', 11, 3),

        // ── Service counter and its evidence ───────────────────────────────
        placeProp(30, 'inn_counter', 'Service Counter', 'prop_counter.png', 10, 4),
        placeProp(31, 'inn_counter_2', 'Service Counter', 'prop_counter.png', 12, 4),
        placeProp(21, 'sella_receipt', "Sella's Custody Receipt", 'prop_receipt.png', 14, 5),

        // ── Hearth and storage along the north wall ────────────────────────
        placeProp(32, 'inn_hearth', 'Hearth', 'prop_hearth.png', 4, 2),
        placeProp(33, 'inn_shelf', 'Storage Shelf', 'prop_bookshelf.png', 24, 3),

        // ── Tables and chairs (common room, clear of the combat footprint) ──
        // Two west clusters and one east cluster, deliberately uneven.
        placeProp(34, 'inn_table', 'Ale Table', 'prop_table.png', 4, 7),
        placeProp(35, 'inn_chair', 'Chair', 'chair.png', 3, 8),
        placeProp(36, 'inn_chair_2', 'Chair', 'chair.png', 5, 8),
        placeProp(37, 'inn_table_2', 'Ale Table', 'prop_table.png', 4, 13),
        placeProp(38, 'inn_chair_3', 'Chair', 'chair.png', 3, 14),
        placeProp(39, 'inn_chair_4', 'Chair', 'chair.png', 5, 14),
        placeProp(40, 'inn_table_3', 'Ale Table', 'prop_table.png', 21, 9),
        placeProp(41, 'inn_chair_5', 'Chair', 'chair.png', 20, 10),
        placeProp(42, 'inn_chair_6', 'Chair', 'chair.png', 22, 10),

        // ── Barrels, crates, a bed alcove and the failing roof support ─────
        placeProp(2, 'inn_barrel', 'Barrel', 'prop_barrel.png', 24, 5),
        placeProp(4, 'inn_barrel_2', 'Barrel', 'prop_barrel.png', 5, 16),
        placeProp(3, 'inn_crate', 'Crate', 'prop_crate.png', 3, 16),
        placeProp(43, 'inn_bed', 'Guest Bed', 'prop_bed.png', 3, 15),
        placeProp(44, 'inn_brazier', 'Brazier', 'prop_brazier.png', 16, 16),
        placeProp(45, 'inn_support', 'Rotting Support', 'prop_support.png', 23, 9),

        // ── Arrival marker ─────────────────────────────────────────────────
        placeSpawn(6, 'inn_entrance', 14, 17),
      ],
    },
    {
      name: 'transitions',
      type: 'objectgroup',
      visible: true,
      objects: [
        placeTransition({
          id: 1005,
          targetMap: 'village',
          targetSpawnId: 'from_inn',
          target: { x: cell(51), y: cell(23) },
          at: { c: 13, r: 19, width: 3, height: 1 },
        }),
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

  // South doorway, three tiles wide — the companion-safe corridor width.
  border(m, { south: [11, 12, 13] });

  // Restrained indoor flagstone. GID 6 is reserved for outdoor cobble, while
  // GID 34 is the dedicated interior floor variant.
  for (let r = 2; r < H - 2; r++) {
    for (let c = 2; c <= W - 3; c++) {
      setTile(m, c, r, G.STONE_VAR);
    }
  }
  for (const c of [11, 12, 13]) {
    setTile(m, c, H - 2, G.STONE_VAR);
  }

  // Landing inside the door so the entrance is not a pinch point. The south
  // wall-top rim (row H-2) is left intact; only the door columns are paved
  // through it.
  for (let r = 13; r <= H - 3; r++) {
    for (let c = 10; c <= 13; c++) {
      setTile(m, c, r, G.STONE_VAR);
    }
  }
  for (const c of [11, 12, 13]) {
    setTile(m, c, H - 2, G.STONE_VAR);
  }

  // The counter run divides the room: a solid `counter` tile along row 11,
  // broken by a four-cell walk-through at cols 10-13 so the customer aisle
  // (south) and the storage bay (north) are both reachable. The run carries
  // matching collision, exactly like the inn's service counter — a solid tile
  // with collision set is consistent with the content audit.
  for (const c of [3, 4, 5, 6, 7, 8, 9, 14, 15, 16, 17, 18, 19, 20]) {
    setTile(m, c, 11, G.COUNTER);
    m.collision[11 * W + c] = 1;
  }

  const objectLayers: MapObjectLayer[] = [
    {
      name: 'spawns',
      type: 'objectgroup',
      visible: true,
      objects: [
        // Mara stands behind the counter, on the merchant side of the gap.
        placeNpc(1, 'merchant', 'Mara the Merchant', 'merchant_mara_greeting', 12, 10, [
          { name: 'isVendor', type: 'bool', value: true },
          {
            name: 'vendorInventory',
            type: 'string',
            value: 'ironSword,steelSword,healthPotion,manaPotion,ironArmor,woodenShield',
          },
        ]),

        // Counter run (the ledger's discoverable prop is the left section).
        placeProp(2, 'shop_counter_l', 'Counter', 'prop_counter.png', 4, 11),
        placeProp(3, 'shop_counter_r', 'Counter', 'prop_counter.png', 17, 11),
        placeProp(50, 'shop_counter_m', 'Counter', 'prop_counter.png', 8, 11),

        // Rear storage bay: merchandise clustered where it belongs.
        placeProp(51, 'shop_shelf', 'Storage Shelf', 'prop_bookshelf.png', 3, 3),
        placeProp(52, 'shop_shelf_2', 'Storage Shelf', 'prop_bookshelf.png', 20, 3),
        placeProp(4, 'shop_crate', 'Crate', 'prop_crate.png', 4, 3),
        placeProp(53, 'shop_crate_2', 'Crate', 'prop_crate.png', 6, 4),
        placeProp(54, 'shop_crate_3', 'Crate', 'prop_crate.png', 5, 14),
        placeProp(55, 'shop_barrel', 'Barrel', 'prop_barrel.png', 21, 6),

        // Merchant-side stool and a customer-side display barrel.
        placeProp(56, 'shop_chair', 'Chair', 'chair.png', 4, 8),
        placeProp(57, 'shop_barrel_2', 'Barrel', 'prop_barrel.png', 3, 14),

        placeSpawn(6, 'shop_entrance', 12, 15),
      ],
    },
    {
      name: 'transitions',
      type: 'objectgroup',
      visible: true,
      objects: [
        placeTransition({
          id: 1005,
          targetMap: 'village',
          targetSpawnId: 'from_merchant',
          target: { x: cell(51), y: cell(36) },
          at: { c: 11, r: 17, width: 3, height: 1 },
        }),
      ],
    },
  ];

  return { map: m, objectLayers };
};
