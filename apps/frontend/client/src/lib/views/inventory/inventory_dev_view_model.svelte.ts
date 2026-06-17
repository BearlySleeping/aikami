// apps/frontend/client/src/lib/views/inventory/inventory_dev_view_model.svelte.ts
//
// Dev sandbox override — injects mock inventory state for sandbox testing.
// NEVER import this file from production code or non-(dev) routes.

import { gameStateService } from '$services';
import {
  InventoryViewModel,
  type InventoryViewModelOptions,
} from './inventory_view_model.svelte.ts';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Dev sandbox override for InventoryViewModel.
 *
 * Injects mock inventory data directly into GameStateService.inventory
 * and provides sandbox actions for testing edge cases: full bag, empty inventory.
 */
export class InventoryDevViewModel extends InventoryViewModel {
  // ── Lifecycle ─────────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    // Inject mock items into the game state service inventory
    gameStateService.inventory = [
      { itemId: 'iron-sword', quantity: 1 },
      { itemId: 'health-potion', quantity: 3 },
      { itemId: 'wooden-shield', quantity: 1 },
      { itemId: 'arrow', quantity: 15 },
    ];

    return await super.initialize();
  }

  // ── Dev-only methods ──────────────────────────────────────────────────

  /**
   * Fills the inventory with mock items up to a high capacity.
   */
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

  /**
   * Empties all items.
   */
  clearInventory(): void {
    gameStateService.inventory = [];
  }
}

/**
 * Factory function — returns an InventoryDevViewModel with mock data.
 * Only use in (dev) routes or tests.
 */
export const getInventoryDevViewModel = (
  options: InventoryViewModelOptions,
): InventoryDevViewModel => {
  return new InventoryDevViewModel(options);
};
