// apps/frontend/client/src/lib/utils/inventory_utils.ts
//
// Inventory catalog helpers — item lookup and LPC asset resolution.
// Extracted from inventory_service.svelte.ts so the service only exports
// its singleton instance (guard S9).

import type { ItemDefinition } from '@aikami/types';

// ---------------------------------------------------------------------------
// Item catalog — maps itemId strings to stat bonuses and metadata.
// Contract: C-153 Character Dashboard & Equipment
// Contract: C-331 — the content pack is the runtime source of truth; this
// hardcoded catalog is the fallback for packless contexts (dev sandboxes).
// ---------------------------------------------------------------------------

/**
 * Hardcoded fallback item catalog for packless contexts (dev sandboxes).
 *
 * Production `/game` boots hydrate the active catalog from the content pack
 * via {@link setActiveCatalog}; this map keeps dev sandboxes and tests
 * functional without a pack.
 *
 * C-374: items carry `lpcSlot` / `lpcAssetId` so equipped items render on
 * the LPC character. Every equipment item maps to a real spritesheet asset
 * under static/game-data/lpc/.
 */
const ITEM_CATALOG: Record<string, ItemDefinition> = {
  // ── Swords (right hand → LPC weapon layer) ──
  rustySword: {
    label: 'Rusty Sword',
    itemType: 'weapon',
    attackBonus: 3,
    defenseBonus: 0,
    equippable: true,
    slot: 'rightHand',
    basePrice: 15,
    lpcSlot: 'weapon',
    lpcAssetId: 'weapon/sword/dagger',
  },
  ironSword: {
    label: 'Iron Sword',
    itemType: 'weapon',
    attackBonus: 5,
    defenseBonus: 0,
    equippable: true,
    slot: 'rightHand',
    basePrice: 50,
    lpcSlot: 'weapon',
    lpcAssetId: 'weapon/sword/longsword',
  },
  steelSword: {
    label: 'Steel Sword',
    itemType: 'weapon',
    attackBonus: 8,
    defenseBonus: 0,
    equippable: true,
    slot: 'rightHand',
    basePrice: 150,
    lpcSlot: 'weapon',
    lpcAssetId: 'weapon/sword/saber',
  },
  // ── Bows (right hand → LPC weapon layer) ──
  shortBow: {
    label: 'Short Bow',
    itemType: 'weapon',
    attackBonus: 4,
    defenseBonus: 0,
    equippable: true,
    slot: 'rightHand',
    basePrice: 40,
    lpcSlot: 'weapon',
    lpcAssetId: 'weapon/ranged/bow/normal',
  },
  recurveBow: {
    label: 'Recurve Bow',
    itemType: 'weapon',
    attackBonus: 6,
    defenseBonus: 0,
    equippable: true,
    slot: 'rightHand',
    basePrice: 90,
    lpcSlot: 'weapon',
    lpcAssetId: 'weapon/ranged/bow/recurve',
  },
  greatBow: {
    label: 'Great Bow',
    itemType: 'weapon',
    attackBonus: 9,
    defenseBonus: 0,
    equippable: true,
    slot: 'rightHand',
    basePrice: 180,
    lpcSlot: 'weapon',
    lpcAssetId: 'weapon/ranged/bow/great',
  },
  // ── Shields (left hand → LPC shield layer) ──
  woodenShield: {
    label: 'Wooden Shield',
    itemType: 'armor',
    attackBonus: 0,
    defenseBonus: 2,
    equippable: true,
    slot: 'leftHand',
    basePrice: 20,
    lpcSlot: 'shield',
    lpcAssetId: 'shield/heater/original/wood_fg',
  },
  ironShield: {
    label: 'Iron Shield',
    itemType: 'armor',
    attackBonus: 0,
    defenseBonus: 4,
    equippable: true,
    slot: 'leftHand',
    basePrice: 80,
    lpcSlot: 'shield',
    lpcAssetId: 'shield/kite_male',
  },
  towerShield: {
    label: 'Tower Shield',
    itemType: 'armor',
    attackBonus: 0,
    defenseBonus: 6,
    equippable: true,
    slot: 'leftHand',
    basePrice: 160,
    lpcSlot: 'shield',
    lpcAssetId: 'shield/scutum_trim_fg',
  },
  // ── Body armour (torso → LPC torso layer) ──
  clothTunic: {
    label: 'Cloth Tunic',
    itemType: 'armor',
    attackBonus: 0,
    defenseBonus: 1,
    equippable: true,
    slot: 'body',
    basePrice: 10,
    lpcSlot: 'torso',
    lpcAssetId: 'torso/clothes/shortsleeve/shortsleeve_male',
  },
  leatherArmor: {
    label: 'Leather Armor',
    itemType: 'armor',
    attackBonus: 0,
    defenseBonus: 3,
    equippable: true,
    slot: 'body',
    basePrice: 45,
    lpcSlot: 'torso',
    lpcAssetId: 'torso/armour/leather_male',
  },
  chainmailArmor: {
    label: 'Chainmail',
    itemType: 'armor',
    attackBonus: 0,
    defenseBonus: 4,
    equippable: true,
    slot: 'body',
    basePrice: 90,
    lpcSlot: 'torso',
    lpcAssetId: 'torso/chainmail_male',
  },
  ironArmor: {
    label: 'Iron Armor',
    itemType: 'armor',
    attackBonus: 0,
    defenseBonus: 5,
    equippable: true,
    slot: 'body',
    basePrice: 120,
    lpcSlot: 'torso',
    lpcAssetId: 'torso/armour/plate_male',
  },
  // ── Boots (feet → LPC feet layer) ──
  leatherBoots: {
    label: 'Leather Boots',
    itemType: 'armor',
    attackBonus: 0,
    defenseBonus: 1,
    equippable: true,
    slot: 'feet',
    basePrice: 15,
    lpcSlot: 'feet',
    lpcAssetId: 'feet/boots/basic_male',
  },
  plateBoots: {
    label: 'Plate Boots',
    itemType: 'armor',
    attackBonus: 0,
    defenseBonus: 2,
    equippable: true,
    slot: 'feet',
    basePrice: 60,
    lpcSlot: 'feet',
    lpcAssetId: 'feet/armour/plate_male',
  },
  // ── Helmets (head → LPC hat layer) ──
  leatherCap: {
    label: 'Leather Cap',
    itemType: 'armor',
    attackBonus: 0,
    defenseBonus: 1,
    equippable: true,
    slot: 'head',
    basePrice: 12,
    lpcSlot: 'hat',
    lpcAssetId: 'hat/cloth/leather_cap_adult',
  },
  ironHelmet: {
    label: 'Iron Helmet',
    itemType: 'armor',
    attackBonus: 0,
    defenseBonus: 2,
    equippable: true,
    slot: 'head',
    basePrice: 55,
    lpcSlot: 'hat',
    lpcAssetId: 'hat/helmet/nasal_adult',
  },
  greatHelmet: {
    label: 'Great Helm',
    itemType: 'armor',
    attackBonus: 0,
    defenseBonus: 3,
    equippable: true,
    slot: 'head',
    basePrice: 100,
    lpcSlot: 'hat',
    lpcAssetId: 'hat/helmet/greathelm_male',
  },
  // ── Consumables ──
  healthPotion: {
    label: 'Health Potion',
    itemType: 'consumable',
    attackBonus: 0,
    defenseBonus: 0,
    equippable: false,
    slot: undefined,
    basePrice: 10,
    effect: { kind: 'heal', amount: 30 },
  },
  manaPotion: {
    label: 'Mana Potion',
    itemType: 'consumable',
    attackBonus: 0,
    defenseBonus: 0,
    equippable: false,
    slot: undefined,
    basePrice: 15,
    effect: { kind: 'heal', amount: 30 },
  },
  goldCoin: {
    label: 'Gold Coin',
    itemType: 'misc',
    attackBonus: 0,
    defenseBonus: 0,
    equippable: false,
    slot: undefined,
    basePrice: 0,
  },
  // C-316: Emberwatch adventure items
  wardWand: {
    label: 'Ward Wand',
    itemType: 'key',
    attackBonus: 0,
    defenseBonus: 0,
    equippable: false,
    slot: undefined,
    basePrice: 0,
  },
  wardShard: {
    label: 'Ward Shard',
    itemType: 'misc',
    attackBonus: 0,
    defenseBonus: 0,
    equippable: false,
    slot: undefined,
    basePrice: 30,
  },
} as const satisfies Record<string, ItemDefinition>;

/** Default definition for unknown item IDs. */
const DEFAULT_ITEM_DEFINITION: ItemDefinition = {
  label: 'Unknown Item',
  itemType: 'misc',
  attackBonus: 0,
  defenseBonus: 0,
  equippable: false,
  slot: undefined,
  basePrice: 0,
};

/**
 * Content-pack-hydrated catalog. When set (composition root Phase 5c),
 * it takes precedence over the hardcoded fallback for every lookup.
 */
let _activeCatalog: Record<string, ItemDefinition> | undefined;

/**
 * Replaces the active item catalog with content-pack definitions.
 * Called by the composition root after the pack loads (C-331 AC-1).
 */
export const setActiveCatalog = (items: Record<string, ItemDefinition>): void => {
  _activeCatalog = items;
};

/**
 * Looks up the {@link ItemDefinition} for a given item ID.
 *
 * Resolution order (C-331): configured content-pack catalog → hardcoded
 * fallback catalog → safe default definition labelled with the raw ID.
 */
export const getItemDefinition = (itemId: string): ItemDefinition => {
  const fromPack = _activeCatalog?.[itemId];
  if (fromPack) {
    return fromPack;
  }
  return ITEM_CATALOG[itemId] ?? { ...DEFAULT_ITEM_DEFINITION, label: itemId };
};

/**
 * Finds an item whose LPC render asset matches the given asset ID.
 *
 * Used to map a character's base appearance layer (e.g. the default
 * chainmail torso) to an equippable item so the paperdoll reflects the
 * base outfit (C-374). Returns `undefined` when no item renders that asset
 * (e.g. AI-generated appearance layers without a catalog item).
 */
export const findItemIdByLpcAsset = (assetId: string): string | undefined => {
  const catalog = _activeCatalog ?? ITEM_CATALOG;
  for (const [itemId, definition] of Object.entries(catalog)) {
    if (definition.lpcAssetId === assetId) {
      return itemId;
    }
  }
  return undefined;
};
