// apps/frontend/client/src/lib/views/inventory/inventory_view_model.svelte.ts
//
// Inventory ViewModel. Reads inventory + equipment from GameStateService,
// exposes equip/unequip actions.
//
// Contract: C-153 Character Dashboard & Equipment
// Contract: C-163 Visceral Feedback Juice (equip SFX + appearance sync)

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { ItemDefinition } from '@aikami/types';
import { audioService, gameStateService, getItemDefinition, inventoryService } from '$services';

/** Mutable access to GameStateService for equip/unequip. */
const _game = gameStateService as unknown as {
  equippedWeapon: string | undefined;
  equippedArmor: string | undefined;
};

export type InventoryViewModelInterface = BaseViewModelInterface & {
  readonly items: Array<{ itemId: string; quantity: number }>;
  readonly equippedWeaponDef: ItemDefinition | undefined;
  readonly equippedArmorDef: ItemDefinition | undefined;

  isEquippable(itemId: string): boolean;
  equipItem(itemId: string): void;
  unequipItem(slot: 'weapon' | 'armor'): void;
  closeInventory(): void;
};

export class InventoryViewModel
  extends BaseViewModel<BaseViewModelOptions>
  implements InventoryViewModelInterface
{
  get items(): Array<{ itemId: string; quantity: number }> {
    return gameStateService.inventory;
  }

  get equippedWeaponDef(): ItemDefinition | undefined {
    return this.items.find((i) => i.itemId === _game.equippedWeapon)
      ? getItemDefinition(_game.equippedWeapon ?? '')
      : undefined;
  }

  get equippedArmorDef(): ItemDefinition | undefined {
    return this.items.find((i) => i.itemId === _game.equippedArmor)
      ? getItemDefinition(_game.equippedArmor ?? '')
      : undefined;
  }

  isEquippable(itemId: string): boolean {
    return getItemDefinition(itemId).equippable;
  }

  equipItem(itemId: string): void {
    const def = getItemDefinition(itemId);
    if (!def.equippable || !def.slot) {
      return;
    }
    if (def.slot === 'weapon') {
      _game.equippedWeapon = itemId;
    } else {
      _game.equippedArmor = itemId;
    }
    void audioService.playSfx('/assets/audio/sfx/sfx_equip.wav');
  }

  unequipItem(slot: 'weapon' | 'armor'): void {
    if (slot === 'weapon') {
      _game.equippedWeapon = undefined;
    } else {
      _game.equippedArmor = undefined;
    }
  }

  closeInventory(): void {
    inventoryService.close();
  }
}

export const getInventoryViewModel = (options: BaseViewModelOptions): InventoryViewModelInterface =>
  InventoryViewModel.create(options);
