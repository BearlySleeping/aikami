// apps/frontend/client/src/lib/views/inventory/inventory_view_model.dev.svelte.ts
//
// Dev sandbox override — injects mock inventory state for sandbox testing.
// NEVER import this file from production code or non-(dev) routes.

import type { BaseViewModelOptions } from '@aikami/frontend/services';
import { gameStateService } from '$services';
import { InventoryViewModel } from './inventory_view_model.svelte';

const MOCK_ITEM_IDS = [
  'rusty-sword',
  'old-boot',
  'torn-cloak',
  'cracked-shield',
  'broken-arrow',
  'faded-scroll',
  'empty-vial',
  'bent-spoon',
  'tattered-map',
  'dull-knife',
  'rotten-apple',
  'wooden-figurine',
] as const;

class InventoryDevViewModel extends InventoryViewModel {
  override async initialize(): Promise<void> {
    gameStateService.inventory = [
      { itemId: 'ironSword', quantity: 1 },
      { itemId: 'healthPotion', quantity: 3 },
      { itemId: 'woodenShield', quantity: 1 },
      { itemId: 'rustySword', quantity: 1 },
      { itemId: 'leatherArmor', quantity: 1 },
    ];
    return await super.initialize();
  }

  fillWithJunk(): void {
    const junkItems: Array<{ itemId: string; quantity: number }> = [];
    let totalQuantity = 0;
    let nameIndex = 0;
    const maxCapacity = 30;
    while (totalQuantity < maxCapacity) {
      const itemId = MOCK_ITEM_IDS[nameIndex % MOCK_ITEM_IDS.length] ?? 'junk';
      const remainingSpace = maxCapacity - totalQuantity;
      const quantity = Math.min(Math.floor(Math.random() * 5) + 1, remainingSpace);
      junkItems.push({ itemId, quantity });
      totalQuantity += quantity;
      nameIndex++;
    }
    gameStateService.inventory = junkItems;
  }

  clearInventory(): void {
    gameStateService.inventory = [];
  }
}

export const getInventoryDevViewModel = (options: BaseViewModelOptions): InventoryDevViewModel => {
  return InventoryDevViewModel.create(options) as InventoryDevViewModel;
};
