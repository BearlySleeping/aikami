// apps/frontend/client/src/lib/services/game/inventory_service.svelte.ts
//
// Inventory domain service (C-314) — owns inventory data, gold, item catalog,
// visibility state, and ECS pickup-delta listener.
//
// Extracted from game_state_service (C-314 service split) and merged with
// the existing visibility-toggle InventoryService.
//
// Contract C-331: content-pack-driven catalog, capacity/stack rules,
// removeItem/useConsumable, additive ITEM_PICKED_UP deltas (replacing the
// lossy INVENTORY_UPDATED full-array listener), and save/load persistence.

import { MAX_INVENTORY_SLOTS } from '@aikami/constants';
import type { GameCommand } from '@aikami/frontend/engine';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { InventorySnapshot, ItemDefinition } from '@aikami/types';
import { playerStateService } from './player_state_service.svelte';
import { registerSerializable, type SerializableService } from './serializable_service';

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
 * via {@link InventoryServiceInterface.configureCatalog}; this map keeps
 * dev sandboxes and tests functional without a pack.
 */
const ITEM_CATALOG: Record<string, ItemDefinition> = {
  rustySword: {
    label: 'Rusty Sword',
    itemType: 'weapon',
    attackBonus: 3,
    defenseBonus: 0,
    equippable: true,
    slot: 'weapon',
    basePrice: 15,
  },
  ironSword: {
    label: 'Iron Sword',
    itemType: 'weapon',
    attackBonus: 5,
    defenseBonus: 0,
    equippable: true,
    slot: 'weapon',
    basePrice: 50,
  },
  steelSword: {
    label: 'Steel Sword',
    itemType: 'weapon',
    attackBonus: 8,
    defenseBonus: 0,
    equippable: true,
    slot: 'weapon',
    basePrice: 150,
  },
  woodenShield: {
    label: 'Wooden Shield',
    itemType: 'armor',
    attackBonus: 0,
    defenseBonus: 2,
    equippable: true,
    slot: 'armor',
    basePrice: 20,
  },
  leatherArmor: {
    label: 'Leather Armor',
    itemType: 'armor',
    attackBonus: 0,
    defenseBonus: 3,
    equippable: true,
    slot: 'armor',
    basePrice: 45,
  },
  ironArmor: {
    label: 'Iron Armor',
    itemType: 'armor',
    attackBonus: 0,
    defenseBonus: 5,
    equippable: true,
    slot: 'armor',
    basePrice: 120,
  },
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
  wardPendant: {
    label: 'Ward Pendant',
    itemType: 'key',
    attackBonus: 0,
    defenseBonus: 0,
    equippable: false,
    slot: undefined,
    basePrice: 0,
  },
  wardAmulet: {
    label: 'Ward Amulet',
    itemType: 'armor',
    attackBonus: 0,
    defenseBonus: 3,
    equippable: true,
    slot: 'armor',
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InventoryServiceInterface = BaseFrontendClassInterface & {
  inventory: Array<{ itemId: string; quantity: number }>;
  readonly gold: number;
  readonly isOpen: boolean;
  /** Transient feedback for rejected transactions (inventory full, etc.). */
  readonly feedbackMessage: string | undefined;

  /**
   * Replaces the active item catalog with content-pack definitions.
   * Called by the composition root after the pack loads (C-331 AC-1).
   */
  configureCatalog(options: { items: Record<string, ItemDefinition> }): void;

  /**
   * Wires world-state integration for pickup suppression + SFX.
   * Called by the composition root; optional in dev sandboxes.
   */
  configureWorldIntegration(options: {
    isPickupCollected(spawnId: string): boolean;
    recordPickup(spawnId: string): void;
    onItemCountChange?(totalCount: number): void;
  }): void;

  /** Wires the engine command sender (HEAL_PLAYER). Optional in sandboxes. */
  configureCommandSender(options: { sendCommand(command: GameCommand): void }): void;

  /**
   * Adds an item to the player's inventory (stack-aware).
   *
   * @returns `true` when added; `false` when rejected (capacity).
   * Capacity (24 distinct stacks) is enforced only when `enforceCapacity`
   * is set — quest/loot rewards intentionally bypass the cap (C-331).
   */
  addItem(options: { itemId: string; quantity?: number; enforceCapacity?: boolean }): boolean;

  /**
   * Removes a quantity of an item from the inventory.
   *
   * @returns `true` when removed; `false` when not owned in sufficient quantity.
   */
  removeItem(options: { itemId: string; quantity?: number }): boolean;

  /**
   * Uses a consumable item out of combat (heal effect).
   * Decrements the stack and heals via the engine bridge path.
   */
  useConsumable(options: { itemId: string }): 'ok' | 'not-owned' | 'not-consumable' | 'full-hp';

  addGold(options: { amount: number }): void;
  removeGold(options: { amount: number }): void;

  open(): void;
  close(): void;
  toggle(): void;

  /** Starts ECS bridge listeners for ITEM_PICKED_UP / INVENTORY_FULL deltas. Idempotent. */
  startListening(): Promise<void>;

  /** Serializes inventory + gold for the save envelope (C-331 AC-2). */
  serialize(): InventorySnapshot;

  /** Restores inventory + gold from a save envelope snapshot. */
  hydrate(data: InventorySnapshot): void;

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
  feedbackMessage = $state<string | undefined>(undefined);

  private _isOpen = $state(false);
  private _listening = false;
  private _feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  private _isPickupCollected: ((spawnId: string) => boolean) | undefined;
  private _recordPickup: ((spawnId: string) => void) | undefined;
  private _onItemCountChange: ((totalCount: number) => void) | undefined;
  private _sendCommand: ((command: GameCommand) => void) | undefined;

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
  configureCatalog(options: { items: Record<string, ItemDefinition> }): void {
    _activeCatalog = options.items;
    this.debug('configureCatalog', { itemCount: Object.keys(options.items).length });
  }

  /** @inheritdoc */
  configureWorldIntegration(options: {
    isPickupCollected(spawnId: string): boolean;
    recordPickup(spawnId: string): void;
    onItemCountChange?(totalCount: number): void;
  }): void {
    this._isPickupCollected = (spawnId) => options.isPickupCollected(spawnId);
    this._recordPickup = (spawnId) => options.recordPickup(spawnId);
    this._onItemCountChange = options.onItemCountChange
      ? (totalCount) => options.onItemCountChange?.(totalCount)
      : undefined;
  }

  /** @inheritdoc */
  configureCommandSender(options: { sendCommand(command: GameCommand): void }): void {
    this._sendCommand = (command) => options.sendCommand(command);
  }

  /** @inheritdoc */
  addItem(options: { itemId: string; quantity?: number; enforceCapacity?: boolean }): boolean {
    const { itemId, quantity = 1, enforceCapacity = false } = options;
    if (quantity <= 0) {
      return false;
    }
    const existing = this.inventory.find((entry) => entry.itemId === itemId);
    if (existing) {
      existing.quantity += quantity;
      return true;
    }
    if (enforceCapacity && this.inventory.length >= MAX_INVENTORY_SLOTS) {
      this.debug('addItem:inventory-full', { itemId, slots: this.inventory.length });
      this._showFeedback('Inventory full!');
      return false;
    }
    this.inventory = [...this.inventory, { itemId, quantity }];
    return true;
  }

  /** @inheritdoc */
  removeItem(options: { itemId: string; quantity?: number }): boolean {
    const { itemId, quantity = 1 } = options;
    if (quantity <= 0) {
      return false;
    }
    const index = this.inventory.findIndex((entry) => entry.itemId === itemId);
    if (index < 0) {
      this.debug('removeItem:not-owned', { itemId });
      return false;
    }
    const entry = this.inventory[index];
    if (entry.quantity < quantity) {
      this.debug('removeItem:insufficient-quantity', {
        itemId,
        have: entry.quantity,
        need: quantity,
      });
      return false;
    }
    if (entry.quantity > quantity) {
      this.inventory[index] = { itemId, quantity: entry.quantity - quantity };
    } else {
      this.inventory.splice(index, 1);
    }
    return true;
  }

  /** @inheritdoc */
  useConsumable(options: { itemId: string }): 'ok' | 'not-owned' | 'not-consumable' | 'full-hp' {
    const { itemId } = options;
    const owned = this.inventory.find((entry) => entry.itemId === itemId);
    if (!owned || owned.quantity <= 0) {
      this.debug('useConsumable:not-owned', { itemId });
      return 'not-owned';
    }

    const definition = getItemDefinition(itemId);
    if (definition.itemType !== 'consumable' || definition.effect?.kind !== 'heal') {
      this.debug('useConsumable:not-consumable', { itemId });
      return 'not-consumable';
    }

    if (playerStateService.playerHp >= playerStateService.playerMaxHp) {
      this.debug('useConsumable:full-hp', { itemId });
      this._showFeedback('Already at full HP');
      return 'full-hp';
    }

    this.removeItem({ itemId, quantity: 1 });

    // Mirror-first heal (clamped) so the UI updates in the same frame;
    // the engine echoes the authoritative value via COMBAT_STATE_UPDATE.
    playerStateService.heal({ amount: definition.effect.amount });

    if (this._sendCommand) {
      try {
        this._sendCommand({ type: 'HEAL_PLAYER', amount: definition.effect.amount });
      } catch (error) {
        this.debug('useConsumable:engine-sync-failed', { error: String(error) });
      }
    }

    return 'ok';
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
  serialize(): InventorySnapshot {
    return {
      items: this.inventory.map((entry) => ({ ...entry })),
      gold: this.gold,
    };
  }

  /** @inheritdoc */
  hydrate(data: InventorySnapshot): void {
    if (!data) {
      return;
    }
    this.inventory = (data.items ?? []).map((entry) => ({ ...entry }));
    this.gold = typeof data.gold === 'number' ? data.gold : 100;
    this.debug('hydrate', { itemCount: this.inventory.length, gold: this.gold });
  }

  /** @inheritdoc */
  reset(): void {
    this.inventory = [];
    this.gold = 100;
    this.feedbackMessage = undefined;
    this.debug('reset:cleared');
  }

  /**
   * Starts listening for ITEM_PICKED_UP / INVENTORY_FULL delta events from
   * the ECS via the EngineBridge (C-331 — additive semantics; the legacy
   * INVENTORY_UPDATED replace-array listener was removed).
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

      bridge.on('ITEM_PICKED_UP', (event) => {
        this._handlePickupDelta({
          itemId: event.itemId,
          quantity: event.quantity ?? 1,
          spawnId: event.spawnId,
        });
      });

      bridge.on('INVENTORY_FULL', (event) => {
        this.debug('pickup:inventory-full', { itemId: event.itemId });
        this._showFeedback('Inventory full!');
      });
    } catch (error) {
      this.debug('startListening:failed', { error: String(error) });
    }
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Applies a single pickup delta from the engine.
   *
   * - Suppresses duplicate deltas for already-collected spawn IDs.
   * - Converts `goldCoin` pickups into gold balance (no slot occupied).
   * - Records collected spawn IDs for respawn suppression (C-331 AC-2).
   */
  private _handlePickupDelta(options: {
    itemId: string;
    quantity: number;
    spawnId?: string;
  }): void {
    const { itemId, quantity, spawnId } = options;

    if (spawnId && this._isPickupCollected?.(spawnId)) {
      this.debug('_handlePickupDelta:duplicate-spawn', { itemId, spawnId });
      return;
    }

    // goldCoin pickups convert to gold balance instead of occupying a slot
    if (itemId === 'goldCoin') {
      this.addGold({ amount: Math.max(1, quantity) });
    } else {
      const added = this.addItem({ itemId, quantity, enforceCapacity: true });
      if (!added) {
        return;
      }
    }

    if (spawnId) {
      this._recordPickup?.(spawnId);
    }

    const totalCount = this.inventory.reduce((sum, entry) => sum + entry.quantity, 0);
    this._onItemCountChange?.(totalCount);
  }

  /** Shows a transient rejection/feedback message (auto-clears after 3s). */
  private _showFeedback(message: string): void {
    if (this._feedbackTimer) {
      clearTimeout(this._feedbackTimer);
    }
    this.feedbackMessage = message;
    this._feedbackTimer = setTimeout(() => {
      this.feedbackMessage = undefined;
    }, 3000);
  }
}

export const inventoryService: InventoryServiceInterface = InventoryService.create({
  className: 'InventoryService',
});

// Register for save/load persistence (C-331 AC-2)
registerSerializable('inventory', inventoryService as unknown as SerializableService<unknown>);
