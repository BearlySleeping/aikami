// packages/shared/types/src/lib/database/item.ts
//
// Static types derived from ItemDefinitionSchema.
import type { Type } from 'typebox';
import type {
  EquipmentSlotSchema,
  InventoryItemSchema,
  ItemDefinitionSchema,
} from '@aikami/schemas';

export type EquipmentSlot = Type.Static<typeof EquipmentSlotSchema>;
export type ItemDefinition = Type.Static<typeof ItemDefinitionSchema>;
export type InventoryItem = Type.Static<typeof InventoryItemSchema>;
