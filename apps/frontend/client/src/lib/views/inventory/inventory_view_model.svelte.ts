// apps/frontend/client/src/lib/views/inventory/inventory_view_model.svelte.ts
//
// Inventory ViewModel. Reads inventory + equipment from GameStateService,
// exposes equip/unequip actions, and looks up item definitions for stat
// bonus display.
//
// Contract: C-153 Character Dashboard & Equipment
// Contract: C-163 Visceral Feedback Juice (equip SFX + appearance sync)

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { audioService, gameStateService, getItemDefinition, type ItemDefinition } from '$services';

// ── Re-exports for view convenience ────────────────────────────────────
export type { ItemDefinition };

export type InventoryViewModelOptions = BaseViewModelOptions & {
  /** Callback when the player closes the inventory overlay. */
  onClose: () => void;
};

export type InventoryViewModelInterface = BaseViewModelInterface & {
  /** The current inventory items from the game state. */
  readonly items: Array<{ itemId: string; quantity: number }>;

  /** Currently equipped weapon definition, or undefined. */
  readonly equippedWeaponDef: ItemDefinition | undefined;
  /** Currently equipped armor definition, or undefined. */
  readonly equippedArmorDef: ItemDefinition | undefined;

  /** Checks whether an item is equippable. */
  isEquippable(itemId: string): boolean;
  /** Equips an item from inventory into its designated slot. */
  equipItem(itemId: string): void;
  /** Unequips the item in the given slot back to inventory. */
  unequipItem(slot: 'weapon' | 'armor'): void;

  /** Closes the inventory overlay (delegates to parent callback). */
  closeInventory(): void;
};

class InventoryViewModel
  extends BaseViewModel<InventoryViewModelOptions>
  implements InventoryViewModelInterface
{
  private readonly _onClose: () => void;

  constructor(options: InventoryViewModelOptions) {
    super(options);
    this._onClose = options.onClose;
  }

  /** @inheritdoc */
  get items(): Array<{ itemId: string; quantity: number }> {
    return gameStateService.inventory;
  }

  /** @inheritdoc */
  get equippedWeaponDef(): ItemDefinition | undefined {
    const weaponId = gameStateService.equippedWeapon;
    if (!weaponId) {
      return undefined;
    }
    return getItemDefinition(weaponId);
  }

  /** @inheritdoc */
  get equippedArmorDef(): ItemDefinition | undefined {
    const armorId = gameStateService.equippedArmor;
    if (!armorId) {
      return undefined;
    }
    return getItemDefinition(armorId);
  }

  /** @inheritdoc */
  isEquippable(itemId: string): boolean {
    return getItemDefinition(itemId).equippable;
  }

  /** @inheritdoc */
  equipItem(itemId: string): void {
    gameStateService.equipItem({ itemId });
    void this._onEquipChange();
  }

  /** @inheritdoc */
  unequipItem(slot: 'weapon' | 'armor'): void {
    gameStateService.unequipItem({ slot });
    void this._onEquipChange();
  }

  /**
   * Plays the equip SFX and syncs equipment state to the ECS Appearance
   * component so the LPC sprite updates instantly.
   *
   * Contract: C-163 Visceral Feedback Juice
   */
  private async _onEquipChange(): Promise<void> {
    // Play equip sound effect
    try {
      await audioService.playSfx('/assets/audio/sfx/sfx_pickup.wav');
    } catch (error) {
      this.debug('_onEquipChange:sfx-failed', { error: String(error) });
    }

    // Send appearance update to the engine so the LPC sprite reflects
    // the new equipment state.
    try {
      const { createEngineBridge } = await import('@aikami/frontend/engine');
      const bridge = createEngineBridge();
      bridge.send({
        type: 'UPDATE_PLAYER_APPEARANCE' as never,
        weapon: gameStateService.equippedWeapon,
        armor: gameStateService.equippedArmor,
      } as never);
    } catch (error) {
      this.debug('_onEquipChange:bridge-failed', { error: String(error) });
    }
  }

  /** @inheritdoc */
  closeInventory(): void {
    this._onClose();
  }
}

export { InventoryViewModel };
