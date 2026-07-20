// packages/shared/schemas/src/lib/database/item.ts
//
// TypeBox schemas for game inventory items, equipment slots, and definitions.
// Source of truth for runtime validation and static type inference.
// Contract C-331: unified runtime item shape (itemType, basePrice, consumable
// effect) shared by the content pack and the client item catalog.
import Type from 'typebox';
import { InteractableStateEntrySchema } from '../game/interactable_state.ts';

// ── Equipment Slot ──────────────────────────────────────────────────────

export const EquipmentSlotSchema = Type.Union([Type.Literal('weapon'), Type.Literal('armor')], {
  description: 'Equipment slot type',
});

export type EquipmentSlotData = Type.Static<typeof EquipmentSlotSchema>;
export type EquipmentSlot = Type.Static<typeof EquipmentSlotSchema>;

// ── Item Type ───────────────────────────────────────────────────────────

export const ItemTypeSchema = Type.Union(
  [
    Type.Literal('weapon'),
    Type.Literal('armor'),
    Type.Literal('consumable'),
    Type.Literal('key'),
    Type.Literal('misc'),
  ],
  { description: 'Item category' },
);

export type ItemType = Type.Static<typeof ItemTypeSchema>;

// ── Consumable Effect ───────────────────────────────────────────────────

export const ConsumableEffectSchema = Type.Object(
  {
    kind: Type.Literal('heal'),
    amount: Type.Number({ minimum: 1, description: 'Effect magnitude (HP restored)' }),
  },
  { description: 'Consumable item effect — present only for itemType "consumable"' },
);

export type ConsumableEffect = Type.Static<typeof ConsumableEffectSchema>;

// ── Item Definition ─────────────────────────────────────────────────────

const BaseItemSchema = Type.Object({
  label: Type.String({ description: 'Display label shown in the UI' }),
  attackBonus: Type.Number({ description: 'Attack bonus when equipped (0 for non-weapons)' }),
  defenseBonus: Type.Number({ description: 'Defense bonus when equipped (0 for non-armor)' }),
  equippable: Type.Boolean({ description: 'Whether the item can be equipped at all' }),
  slot: Type.Optional(EquipmentSlotSchema),
  /** Deterministic vendor base price in gold. 0 = unsellable, or >= 2 to avoid zero-gold sales. */
  basePrice: Type.Union([Type.Literal(0), Type.Number({ minimum: 2 })], {
    description: 'Vendor base price in gold (0 = unsellable, or >= 2)',
  }),
});

const ConsumableItemSchema = Type.Intersect([
  BaseItemSchema,
  Type.Object({
    itemType: Type.Literal('consumable'),
    effect: ConsumableEffectSchema,
  }),
]);

const NonConsumableItemSchema = Type.Intersect([
  BaseItemSchema,
  Type.Object({
    itemType: Type.Union([
      Type.Literal('weapon'),
      Type.Literal('armor'),
      Type.Literal('key'),
      Type.Literal('misc'),
    ]),
  }),
]);

export const ItemDefinitionSchema = Type.Union([ConsumableItemSchema, NonConsumableItemSchema], {
  description: 'Definition for a single item type in the game',
});

export type ItemDefinitionData = Type.Static<typeof ItemDefinitionSchema>;
export type ItemDefinition = Type.Static<typeof ItemDefinitionSchema>;

// ── Inventory Item ──────────────────────────────────────────────────────

export const InventoryItemSchema = Type.Object(
  {
    itemId: Type.String({ description: 'Unique item identifier' }),
    quantity: Type.Integer({ minimum: 1, description: 'Stack quantity' }),
  },
  { description: 'A single inventory item entry' },
);

export type InventoryItemData = Type.Static<typeof InventoryItemSchema>;
export type InventoryItem = Type.Static<typeof InventoryItemSchema>;

// ── Serializable snapshots (C-331 save/load payloads) ───────────────────

export const InventorySnapshotSchema = Type.Object(
  {
    items: Type.Array(InventoryItemSchema, { description: 'Owned item stacks' }),
    gold: Type.Integer({ minimum: 0, description: 'Gold balance' }),
  },
  { description: 'Serialized inventory service state (items + gold)' },
);

export type InventorySnapshot = Type.Static<typeof InventorySnapshotSchema>;

export const EquipmentSnapshotSchema = Type.Object(
  {
    equippedWeapon: Type.Optional(Type.String({ description: 'Equipped weapon item ID' })),
    equippedArmor: Type.Optional(Type.String({ description: 'Equipped armor item ID' })),
  },
  { description: 'Serialized equipment service state (slot item IDs)' },
);

export type EquipmentSnapshot = Type.Static<typeof EquipmentSnapshotSchema>;

export const WorldPickupStateSchema = Type.Object(
  {
    /** Spawn-point IDs of already-collected map items — suppressed on map load. */
    collectedPickups: Type.Array(Type.String(), {
      description: 'Collected map pickup spawn IDs',
    }),
    /** Encounter IDs whose loot was already granted — duplicate-loot guard. */
    lootGrantedEncounters: Type.Array(Type.String(), {
      description: 'Encounter IDs with loot already granted',
    }),
    /** Per-spawnId interactable state for persistence across map revisits (C-342). */
    interactableStates: Type.Optional(
      Type.Record(Type.String(), InteractableStateEntrySchema, {
        description: 'Interactable state keyed by spawn ID',
      }),
    ),
  },
  { description: 'World pickup/loot persistence state (C-331, C-342)' },
);

export type WorldPickupState = Type.Static<typeof WorldPickupStateSchema>;
