// apps/frontend/client/src/lib/services/game/inventory_service.svelte.ts
//
// Inventory domain service (C-314) — owns inventory data, gold, item catalog,
// visibility state, and ECS inventory event listener.
//
// Extracted from game_state_service (C-314 service split) and merged with
// the existing visibility-toggle InventoryService.

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { ItemDefinition } from '@aikami/types';

// ---------------------------------------------------------------------------
// Item catalog — maps itemId strings to stat bonuses and metadata.
// Contract: C-153 Character Dashboard & Equipment
// ---------------------------------------------------------------------------

/**
 * Hardcoded item catalog for MVP equipment system.
 *
 * When items are picked up in the game, this catalog is consulted to
 * determine if they can be equipped and what stat bonuses they provide.
 * Unknown item IDs default to non-equippable generic items.
 */
const ITEM_CATALOG: Record<string, ItemDefinition> = {
  rustySword: {
    label: 'Rusty Sword',
    attackBonus: 3,
    defenseBonus: 0,
    equippable: true,
    slot: 'weapon',
  },
  ironSword: {
    label: 'Iron Sword',
    attackBonus: 5,
    defenseBonus: 0,
    equippable: true,
    slot: 'weapon',
  },
  steelSword: {
    label: 'Steel Sword',
    attackBonus: 8,
    defenseBonus: 0,
    equippable: true,
    slot: 'weapon',
  },
  woodenShield: {
    label: 'Wooden Shield',
    attackBonus: 0,
    defenseBonus: 2,
    equippable: true,
    slot: 'armor',
  },
  leatherArmor: {
    label: 'Leather Armor',
    attackBonus: 0,
    defenseBonus: 3,
    equippable: true,
    slot: 'armor',
  },
  ironArmor: {
    label: 'Iron Armor',
    attackBonus: 0,
    defenseBonus: 5,
    equippable: true,
    slot: 'armor',
  },
  healthPotion: {
    label: 'Health Potion',
    attackBonus: 0,
    defenseBonus: 0,
    equippable: false,
    slot: undefined,
  },
  manaPotion: {
    label: 'Mana Potion',
    attackBonus: 0,
    defenseBonus: 0,
    equippable: false,
    slot: undefined,
  },
  goldCoin: {
    label: 'Gold Coin',
    attackBonus: 0,
    defenseBonus: 0,
    equippable: false,
    slot: undefined,
  },
  // C-316: Emberwatch adventure items
  wardPendant: {
    label: 'Ward Pendant',
    attackBonus: 0,
    defenseBonus: 0,
    equippable: false,
    slot: undefined,
  },
  wardAmulet: {
    label: 'Ward Amulet',
    attackBonus: 0,
    defenseBonus: 3,
    equippable: true,
    slot: 'armor',
  },
  wardShard: {
    label: 'Ward Shard',
    attackBonus: 0,
    defenseBonus: 0,
    equippable: false,
    slot: undefined,
  },
} as const satisfies Record<string, ItemDefinition>;

/** Default definition for unknown item IDs. */
const DEFAULT_ITEM_DEFINITION: ItemDefinition = {
  label: 'Unknown Item',
  attackBonus: 0,
  defenseBonus: 0,
  equippable: false,
  slot: undefined,
};

/**
 * Looks up the {@link ItemDefinition} for a given item ID.
 * Falls back to {@link DEFAULT_ITEM_DEFINITION} for unknown IDs.
 */
export const getItemDefinition = (itemId: string): ItemDefinition => {
  return ITEM_CATALOG[itemId] ?? { ...DEFAULT_ITEM_DEFINITION, label: itemId };
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InventoryServiceInterface = BaseFrontendClassInterface & {
  inventory: Array<{ itemId: string; quantity: number }>;
  readonly gold: number;
  readonly isOpen: boolean;

  addGold(options: { amount: number }): void;
  removeGold(options: { amount: number }): void;

  open(): void;
  close(): void;
  toggle(): void;

  /** Starts ECS bridge listener for INVENTORY_UPDATED events. Idempotent. */
  startListening(): Promise<void>;

  reset(): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class InventoryService
  extends BaseFrontendClass<BaseFrontendClassOptions>
  implements InventoryServiceInterface
{
  inventory = $state<Array<{ itemId: string; quantity: number }>>([]);
  gold = $state<number>(100);

  private _isOpen = $state(false);
  private _listening = false;

  get isOpen(): boolean {
    return this._isOpen;
  }

  open(): void {
    this._isOpen = true;
  }

  close(): void {
    this._isOpen = false;
  }

  toggle(): void {
    this._isOpen = !this._isOpen;
  }

  /** @inheritdoc */
  addGold(options: { amount: number }): void {
    const { amount } = options;
    if (amount <= 0) {
      this.debug('addGold:non-positive', { amount });
      return;
    }
    this.gold += amount;
    this.debug('addGold', { amount, newBalance: this.gold });
  }

  /** @inheritdoc */
  removeGold(options: { amount: number }): void {
    const { amount } = options;
    if (amount <= 0) {
      this.debug('removeGold:non-positive', { amount });
      return;
    }
    if (this.gold < amount) {
      throw new Error(`Insufficient gold: have ${this.gold}, need ${amount}`);
    }
    this.gold -= amount;
    this.debug('removeGold', { amount, newBalance: this.gold });
  }

  /** @inheritdoc */
  reset(): void {
    this.inventory = [];
    this.gold = 100;
    this.debug('reset:cleared');
  }

  /**
   * Starts listening for INVENTORY_UPDATED events from the ECS via the EngineBridge.
   * Idempotent — only starts once per lifecycle.
   */
  async startListening(): Promise<void> {
    if (this._listening) {
      return;
    }
    this._listening = true;

    try {
      const { createEngineBridge } = await import('@aikami/frontend/engine');
      const bridge = createEngineBridge();

      bridge.on('INVENTORY_UPDATED', (event) => {
        this.inventory = event.inventory;
      });
    } catch (error) {
      this.debug('startListening:failed', { error: String(error) });
    }
  }
}

export const inventoryService: InventoryServiceInterface = InventoryService.create({
  className: 'InventoryService',
});
