// packages/shared/schemas/src/lib/database/item.ts
//
// TypeBox schemas for game inventory items, equipment slots, and definitions.
// Source of truth for runtime validation and static type inference.
import Type from 'typebox';

// ── Equipment Slot ──────────────────────────────────────────────────────

export const EquipmentSlotSchema = Type.Union([Type.Literal('weapon'), Type.Literal('armor')], {
  description: 'Equipment slot type',
});

export type EquipmentSlotData = Type.Static<typeof EquipmentSlotSchema>;

// ── Item Definition ─────────────────────────────────────────────────────

export const ItemDefinitionSchema = Type.Object(
  {
    label: Type.String({ description: 'Display label shown in the UI' }),
    attackBonus: Type.Number({ description: 'Attack bonus when equipped (0 for non-weapons)' }),
    defenseBonus: Type.Number({ description: 'Defense bonus when equipped (0 for non-armor)' }),
    equippable: Type.Boolean({ description: 'Whether the item can be equipped at all' }),
    slot: Type.Optional(EquipmentSlotSchema),
  },
  { description: 'Definition for a single item type in the game' },
);

export type ItemDefinitionData = Type.Static<typeof ItemDefinitionSchema>;

// ── Inventory Item ──────────────────────────────────────────────────────

export const InventoryItemSchema = Type.Object(
  {
    itemId: Type.String({ description: 'Unique item identifier' }),
    quantity: Type.Integer({ description: 'Stack quantity' }),
  },
  { description: 'A single inventory item entry' },
);

export type InventoryItemData = Type.Static<typeof InventoryItemSchema>;
