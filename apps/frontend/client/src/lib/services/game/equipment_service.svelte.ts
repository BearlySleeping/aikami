// apps/frontend/client/src/lib/services/game/equipment_service.svelte.ts
//
// Equipment service (C-314) — owns equipment slots, equip/unequip logic,
// and computed attack/defense bonuses from equipped items.
//
// Extracted from game_state_service (C-314 service split).

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { EquipmentSlot } from '@aikami/types';
import type { InventoryServiceInterface } from './inventory_service.svelte';
import { getItemDefinition } from './inventory_service.svelte';
import type { PlayerStateServiceInterface } from './player_state_service.svelte';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EquipmentServiceOptions = BaseFrontendClassOptions & {
  /** Reference to PlayerStateService for base stat access (set by composition root). */
  playerStateService: PlayerStateServiceInterface;
  /** Reference to InventoryService for inventory manipulation. */
  inventoryService: InventoryServiceInterface;
};

export type EquipmentServiceInterface = BaseFrontendClassInterface & {
  readonly equippedWeapon: string | undefined;
  readonly equippedArmor: string | undefined;
  readonly totalAttack: number;
  readonly totalDefense: number;

  equipItem(options: { itemId: string }): void;
  unequipItem(options: { slot: EquipmentSlot }): void;
  reset(): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class EquipmentService
  extends BaseFrontendClass<EquipmentServiceOptions>
  implements EquipmentServiceInterface
{
  equippedWeapon = $state<string | undefined>(undefined);
  equippedArmor = $state<string | undefined>(undefined);

  private readonly _playerStateService: PlayerStateServiceInterface;
  private readonly _inventoryService: InventoryServiceInterface;

  constructor(options: EquipmentServiceOptions) {
    super(options);
    this._playerStateService = options.playerStateService;
    this._inventoryService = options.inventoryService;
  }

  /** Total attack = base + weapon bonus. Falls back to safe defaults when dependencies are not yet wired. */
  get totalAttack(): number {
    const base = this._playerStateService?.playerBaseAttack ?? 5;
    return base + this._equipmentAttackBonus;
  }

  /** Total defense = base + armor bonus. Falls back to safe defaults when dependencies are not yet wired. */
  get totalDefense(): number {
    const base = this._playerStateService?.playerBaseDefense ?? 12;
    return base + this._equipmentDefenseBonus;
  }

  /** Attack bonus from currently equipped weapon. */
  private get _equipmentAttackBonus(): number {
    if (!this.equippedWeapon) {
      return 0;
    }
    return getItemDefinition(this.equippedWeapon).attackBonus;
  }

  /** Defense bonus from currently equipped armor. */
  private get _equipmentDefenseBonus(): number {
    if (!this.equippedArmor) {
      return 0;
    }
    return getItemDefinition(this.equippedArmor).defenseBonus;
  }

  /** @inheritdoc */
  equipItem(options: { itemId: string }): void {
    const { itemId } = options;
    const definition = getItemDefinition(itemId);

    if (!definition.equippable || !definition.slot) {
      this.debug('equipItem:not-equippable', { itemId });
      return;
    }

    if (!this._inventoryService) {
      this.debug('equipItem:inventory-not-wired', { itemId });
      return;
    }

    // Find the item in inventory
    const index = this._inventoryService.inventory.findIndex((item) => item.itemId === itemId);
    if (index < 0) {
      this.debug('equipItem:not-in-inventory', { itemId });
      return;
    }

    const slot = definition.slot;

    // If there's already an item in this slot, unequip it first
    if (slot === 'weapon' && this.equippedWeapon) {
      this._unequipCurrent(slot);
    } else if (slot === 'armor' && this.equippedArmor) {
      this._unequipCurrent(slot);
    }

    // Remove from inventory (reduce quantity or remove entirely)
    const inventory = this._inventoryService.inventory;
    const item = inventory[index];
    if (item.quantity > 1) {
      // Mutate in-place — inventory is a $state array on InventoryService
      inventory[index] = { itemId, quantity: item.quantity - 1 };
    } else {
      inventory.splice(index, 1);
    }

    // Equip into slot
    if (slot === 'weapon') {
      this.equippedWeapon = itemId;
    } else {
      this.equippedArmor = itemId;
    }

    this.debug('equipItem:equipped', { itemId, slot });
  }

  /** @inheritdoc */
  unequipItem(options: { slot: EquipmentSlot }): void {
    const { slot } = options;
    this._unequipCurrent(slot);
  }

  /**
   * Moves the currently equipped item in the given slot back to inventory.
   */
  private _unequipCurrent(slot: EquipmentSlot): void {
    const itemId = slot === 'weapon' ? this.equippedWeapon : this.equippedArmor;
    if (!itemId) {
      return;
    }

    if (!this._inventoryService) {
      this.debug('_unequipCurrent:inventory-not-wired', { itemId, slot });
      return;
    }

    // Return to inventory (stack if existing, otherwise new entry)
    const inventory = this._inventoryService.inventory;
    const existingIndex = inventory.findIndex((item) => item.itemId === itemId);
    if (existingIndex >= 0) {
      inventory[existingIndex] = {
        itemId,
        quantity: inventory[existingIndex].quantity + 1,
      };
    } else {
      inventory.push({ itemId, quantity: 1 });
    }

    // Clear the slot
    if (slot === 'weapon') {
      this.equippedWeapon = undefined;
    } else {
      this.equippedArmor = undefined;
    }

    this.debug('_unequipCurrent', { itemId, slot });
  }

  /** @inheritdoc */
  reset(): void {
    this.equippedWeapon = undefined;
    this.equippedArmor = undefined;
    this.debug('reset:cleared');
  }
}

export const equipmentService: EquipmentServiceInterface = EquipmentService.create({
  className: 'EquipmentService',
  playerStateService: undefined as unknown as PlayerStateServiceInterface,
  inventoryService: undefined as unknown as InventoryServiceInterface,
});
