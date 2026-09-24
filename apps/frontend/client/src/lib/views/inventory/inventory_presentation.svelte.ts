// apps/frontend/client/src/lib/views/inventory/inventory_presentation.svelte.ts
//
// Inventory selection and role projections for the production task surface
// (C-551). Domain inventory/equipment operations remain in the ViewModel.

import type { EquipmentSlot, ItemDefinition } from '@aikami/types';
import { getItemDefinition } from '$utils/inventory_utils';

/** Minimal ViewModel data the selected-item projection reads. */
export type InventoryPresentationSource = {
  readonly items: ReadonlyArray<{ readonly itemId: string; readonly quantity: number }>;
  getCompareLabel(itemId: string): string | undefined;
};

/** Readable facts for the selected bag item. */
export type InventorySelectedItem = {
  readonly itemId: string;
  readonly quantity: number;
  readonly label: string;
  readonly definition: ItemDefinition;
  readonly compareLabel: string | undefined;
  readonly isEquippable: boolean;
  readonly isConsumable: boolean;
};

/** Per-wrapper inventory selection state. */
export type InventoryPresentationState = {
  readonly selectedItemId: string | undefined;
  readonly selectedItem: InventorySelectedItem | undefined;
  selectItem(itemId: string): void;
  isSelected(itemId: string): boolean;
  itemClass(itemId: string): string;
  slotClass(slot: EquipmentSlot, filled: boolean): string;
};

const SLOT_POSITION_CLASS: Readonly<Record<EquipmentSlot, string>> = {
  head: 'col-start-2 row-start-1',
  leftHand: 'col-start-1 row-start-2',
  body: 'col-start-2 row-start-2',
  rightHand: 'col-start-3 row-start-2',
  feet: 'col-start-2 row-start-3',
};

/** Grid placement plus the brass selection/empty role for one paperdoll slot. */
export const inventorySlotClass = (slot: EquipmentSlot, filled: boolean): string =>
  `${SLOT_POSITION_CLASS[slot]} ${filled ? 'game-inventory__slot--filled' : 'game-inventory__slot--empty'}`;

/** Creates selection state; a populated bag defaults to its first real item. */
export const createInventoryPresentationState = (
  source: InventoryPresentationSource,
): InventoryPresentationState => {
  const state = $state<{ selectedItemId: string | undefined }>({ selectedItemId: undefined });

  const selectedEntry = (): { itemId: string; quantity: number } | undefined => {
    const selected = source.items.find((item) => item.itemId === state.selectedItemId);
    return selected ?? source.items[0];
  };

  return {
    get selectedItemId(): string | undefined {
      return selectedEntry()?.itemId;
    },
    get selectedItem(): InventorySelectedItem | undefined {
      const entry = selectedEntry();
      if (!entry) {
        return undefined;
      }
      const definition = getItemDefinition(entry.itemId);
      return {
        itemId: entry.itemId,
        quantity: entry.quantity,
        label: definition.label,
        definition,
        compareLabel: source.getCompareLabel(entry.itemId),
        isEquippable: definition.equippable,
        isConsumable: definition.itemType === 'consumable' && definition.effect !== undefined,
      };
    },
    selectItem(itemId: string): void {
      if (source.items.some((item) => item.itemId === itemId)) {
        state.selectedItemId = itemId;
      }
    },
    isSelected(itemId: string): boolean {
      return selectedEntry()?.itemId === itemId;
    },
    itemClass(itemId: string): string {
      return selectedEntry()?.itemId === itemId ? 'game-inventory__item--selected' : '';
    },
    slotClass(slot: EquipmentSlot, filled: boolean): string {
      return inventorySlotClass(slot, filled);
    },
  };
};
