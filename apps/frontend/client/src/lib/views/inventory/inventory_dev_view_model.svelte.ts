// apps/frontend/client/src/lib/views/inventory/inventory_dev_view_model.svelte.ts
//
// Dev sandbox override — injects mock inventory state for sandbox testing.
// NEVER import this file from production code or non-(dev) routes.

import {
  type InventoryItem,
  InventoryViewModel,
  type InventoryViewModelOptions,
} from './inventory_view_model.svelte.ts';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const JUNK_NAMES = [
  'Rusty Sword',
  'Old Boot',
  'Torn Cloak',
  'Cracked Shield',
  'Broken Arrow',
  'Faded Scroll',
  'Empty Vial',
  'Bent Spoon',
  'Tattered Map',
  'Dull Knife',
  'Rotten Apple',
  'Wooden Figurine',
] as const;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Dev sandbox override for InventoryViewModel.
 *
 * Injects mock inventory data and provides sandbox actions for
 * testing edge cases: max gold, full bag, empty inventory.
 */
export class InventoryDevViewModel extends InventoryViewModel {
  // ── Lifecycle ─────────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    // Start with some initial mock items
    this.gold = 150;
    this.items = [
      { id: 'mock-sword', name: 'Iron Sword', quantity: 1 },
      { id: 'mock-potion', name: 'Health Potion', quantity: 3 },
      { id: 'mock-shield', name: 'Wooden Shield', quantity: 1 },
      { id: 'mock-arrow', name: 'Arrow', quantity: 15 },
    ];

    return await super.initialize();
  }

  // ── Dev-only methods ──────────────────────────────────────────────────

  /**
   * Sets gold to 999,999 to test the high-wealth UI state.
   */
  giveMaxGold(): void {
    this.debug('giveMaxGold');
    this.gold = 999_999;
  }

  /**
   * Fills the inventory with mock "Junk" items up to max capacity (30 slots).
   */
  fillWithJunk(): void {
    this.debug('fillWithJunk');
    const junkItems: InventoryItem[] = [];

    let totalQuantity = 0;
    let nameIndex = 0;

    while (totalQuantity < this.maxCapacity) {
      const name = JUNK_NAMES[nameIndex % JUNK_NAMES.length] ?? 'Junk';
      const remainingSpace = this.maxCapacity - totalQuantity;
      // Random quantity 1-5, but cap at remaining space
      const quantity = Math.min(Math.floor(Math.random() * 5) + 1, remainingSpace);

      junkItems.push({ id: `junk-${nameIndex}`, name, quantity });

      totalQuantity += quantity;
      nameIndex++;
    }

    this.items = junkItems;
  }

  /**
   * Empties all items and sets gold to 0.
   */
  clearInventory(): void {
    this.debug('clearInventory');
    this.items = [];
    this.gold = 0;
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
