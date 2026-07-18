// apps/frontend/client/src/lib/services/game/equipment_service.svelte.ts
//
// Equipment service (C-314) — owns equipment slots, equip/unequip logic,
// and computed attack/defense bonuses from equipped items.
//
// Extracted from game_state_service (C-314 service split).
//
// Contract C-331: single equip path (ViewModels must delegate here), sends
// UPDATE_PLAYER_APPEARANCE over the bridge after each successful change,
// and participates in save/load via the serializable registry.

import type { GameCommand } from '@aikami/frontend/engine';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { EquipmentSlot, EquipmentSnapshot } from '@aikami/types';
import type { InventoryServiceInterface } from './inventory_service.svelte';
import { getItemDefinition, inventoryService } from './inventory_service.svelte';
import type { PlayerStateServiceInterface } from './player_state_service.svelte';
import { playerStateService } from './player_state_service.svelte';
import { registerSerializable, type SerializableService } from './serializable_service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EquipmentServiceOptions = BaseFrontendClassOptions & {
  /** Reference to PlayerStateService for base stat access. */
  playerStateService: PlayerStateServiceInterface;
  /** Reference to InventoryService for inventory manipulation. */
  inventoryService: InventoryServiceInterface;
};

export type EquipmentServiceInterface = BaseFrontendClassInterface & {
  readonly equippedWeapon: string | undefined;
  readonly equippedArmor: string | undefined;
  readonly totalAttack: number;
  readonly totalDefense: number;

  /** Wires the engine command sender for UPDATE_PLAYER_APPEARANCE (C-331 AC-4). */
  configureCommandSender(options: { sendCommand(command: GameCommand): void }): void;

  /**
   * Equips an item from inventory into its slot.
   * @returns `true` when equipped; `false` when rejected.
   */
  equipItem(options: { itemId: string }): boolean;

  /**
   * Unequips the item in the given slot back to inventory.
   * @returns `true` when unequipped; `false` when the slot was empty.
   */
  unequipItem(options: { slot: EquipmentSlot }): boolean;

  /** Serializes equipped slot item IDs for the save envelope (C-331 AC-2). */
  serialize(): EquipmentSnapshot;

  /** Restores equipped slots from a save envelope snapshot. */
  hydrate(data: EquipmentSnapshot): void;

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
  private _sendCommand: ((command: GameCommand) => void) | undefined;

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
  configureCommandSender(options: { sendCommand(command: GameCommand): void }): void {
    this._sendCommand = (command) => options.sendCommand(command);
  }

  /** @inheritdoc */
  equipItem(options: { itemId: string }): boolean {
    const { itemId } = options;
    const definition = getItemDefinition(itemId);

    if (!definition.equippable || !definition.slot) {
      this.debug('equipItem:not-equippable', { itemId });
      return false;
    }

    if (!this._inventoryService) {
      this.debug('equipItem:inventory-not-wired', { itemId });
      return false;
    }

    // Find the item in inventory
    const index = this._inventoryService.inventory.findIndex((item) => item.itemId === itemId);
    if (index < 0) {
      this.debug('equipItem:not-in-inventory', { itemId });
      return false;
    }

    const slot = definition.slot;

    // If there's already an item in this slot, unequip it first
    if (slot === 'weapon' && this.equippedWeapon) {
      this._unequipCurrent(slot);
    } else if (slot === 'armor' && this.equippedArmor) {
      this._unequipCurrent(slot);
    }

    // Remove from inventory (reduce quantity or remove entirely).
    // Re-resolve the index — the unequip above may have mutated the array.
    const inventory = this._inventoryService.inventory;
    const currentIndex = inventory.findIndex((item) => item.itemId === itemId);
    if (currentIndex < 0) {
      this.debug('equipItem:vanished-from-inventory', { itemId });
      return false;
    }
    const item = inventory[currentIndex];
    if (item.quantity > 1) {
      // Mutate in-place — inventory is a $state array on InventoryService
      inventory[currentIndex] = { itemId, quantity: item.quantity - 1 };
    } else {
      inventory.splice(currentIndex, 1);
    }

    // Equip into slot
    if (slot === 'weapon') {
      this.equippedWeapon = itemId;
    } else {
      this.equippedArmor = itemId;
    }

    this.debug('equipItem:equipped', { itemId, slot });
    this._emitAppearanceUpdate();
    return true;
  }

  /** @inheritdoc */
  unequipItem(options: { slot: EquipmentSlot }): boolean {
    const { slot } = options;
    const unequipped = this._unequipCurrent(slot);
    if (unequipped) {
      this._emitAppearanceUpdate();
    }
    return unequipped;
  }

  /**
   * Moves the currently equipped item in the given slot back to inventory.
   *
   * @returns `true` when an item was unequipped, `false` when the slot was empty.
   */
  private _unequipCurrent(slot: EquipmentSlot): boolean {
    const itemId = slot === 'weapon' ? this.equippedWeapon : this.equippedArmor;
    if (!itemId) {
      return false;
    }

    if (!this._inventoryService) {
      this.debug('_unequipCurrent:inventory-not-wired', { itemId, slot });
      return false;
    }

    // Return to inventory (stack if existing, otherwise new entry).
    // Unequip never drops the item — capacity is intentionally bypassed.
    this._inventoryService.addItem({ itemId, quantity: 1 });

    // Clear the slot
    if (slot === 'weapon') {
      this.equippedWeapon = undefined;
    } else {
      this.equippedArmor = undefined;
    }

    this.debug('_unequipCurrent', { itemId, slot });
    return true;
  }

  /**
   * Sends UPDATE_PLAYER_APPEARANCE with the current slot state over the
   * bridge so the player sprite reflects equipment (C-163 command, C-331
   * finally wired). Best-effort — missing sender (dev sandboxes) is a no-op.
   */
  private _emitAppearanceUpdate(): void {
    if (!this._sendCommand) {
      return;
    }
    try {
      this._sendCommand({
        type: 'UPDATE_PLAYER_APPEARANCE',
        weapon: this.equippedWeapon,
        armor: this.equippedArmor,
      });
    } catch (error) {
      this.debug('_emitAppearanceUpdate:failed', { error: String(error) });
    }
  }

  /** @inheritdoc */
  serialize(): EquipmentSnapshot {
    return {
      equippedWeapon: this.equippedWeapon,
      equippedArmor: this.equippedArmor,
    };
  }

  /** @inheritdoc */
  hydrate(data: EquipmentSnapshot): void {
    if (!data) {
      return;
    }
    this.equippedWeapon = data.equippedWeapon;
    this.equippedArmor = data.equippedArmor;
    this.debug('hydrate', { weapon: this.equippedWeapon, armor: this.equippedArmor });
    this._emitAppearanceUpdate();
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
  playerStateService,
  inventoryService,
});

// Register for save/load persistence (C-331 AC-2)
registerSerializable('equipment', equipmentService as unknown as SerializableService<unknown>);
