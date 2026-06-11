// apps/frontend/client/src/lib/views/inventory/inventory_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';

// ---------------------------------------------------------------------------
// Item type
// ---------------------------------------------------------------------------

/** Lightweight mock Item type for the inventory sandbox. */
export type InventoryItem = {
  readonly id: string;
  readonly name: string;
  quantity: number;
};

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type InventoryViewModelOptions = BaseViewModelOptions;

export type InventoryViewModelInterface = BaseViewModelInterface & {
  readonly items: InventoryItem[];
  readonly gold: number;
  readonly maxCapacity: number;

  /** Number of occupied slots. */
  readonly usedSlots: number;

  /** Percentage of capacity used (0-100). */
  readonly capacityPercent: number;

  /** Whether the inventory is completely empty. */
  readonly isEmpty: boolean;

  /** Whether the inventory is at or over capacity. */
  readonly isFull: boolean;

  /** Remove an item by ID. */
  dropItem(id: string): void;

  /** Use/consume one quantity of an item by ID. */
  useItem(id: string): void;
};

// ---------------------------------------------------------------------------
// ViewModel
// ---------------------------------------------------------------------------

/**
 * ViewModel for the inventory UI route.
 *
 * Follows the Svelte 5 ViewModel pattern: all reactive state lives here
 * via `$state` runes. The View (.svelte) is a thin wrapper.
 */
export class InventoryViewModel
  extends BaseViewModel<InventoryViewModelOptions>
  implements InventoryViewModelInterface
{
  items: InventoryItem[] = $state([]);

  gold = $state(0);

  maxCapacity = $state(30);

  // ── Derived ──────────────────────────────────────────────────────────

  get usedSlots(): number {
    return this.items.reduce((sum, item) => sum + item.quantity, 0);
  }

  get capacityPercent(): number {
    if (this.maxCapacity <= 0) {
      return 100;
    }
    return Math.min(100, Math.round((this.usedSlots / this.maxCapacity) * 100));
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  get isFull(): boolean {
    return this.usedSlots >= this.maxCapacity;
  }

  // ── Methods ──────────────────────────────────────────────────────────

  dropItem(id: string): void {
    this.debug('dropItem', { id });
    this.items = this.items.filter((item) => item.id !== id);
  }

  useItem(id: string): void {
    this.debug('useItem', { id });
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) {
      return;
    }

    const item = this.items[index];
    if (!item) {
      return;
    }
    if (item.quantity <= 1) {
      // Remove completely
      this.items = this.items.filter((_, i) => i !== index);
    } else {
      // Decrement quantity
      this.items[index] = { ...item, quantity: item.quantity - 1 };
    }
  }
}

/**
 * Factory function for creating InventoryViewModel instances.
 */
export const getInventoryViewModel = (options: InventoryViewModelOptions): InventoryViewModel => {
  return new InventoryViewModel(options);
};
