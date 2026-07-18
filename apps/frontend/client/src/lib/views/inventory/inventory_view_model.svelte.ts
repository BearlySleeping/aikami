// apps/frontend/client/src/lib/views/inventory/inventory_view_model.svelte.ts
//
// Inventory ViewModel. Reads inventory + equipment state from the domain
// services and exposes equip/unequip/use actions.
//
// Contract: C-153 Character Dashboard & Equipment
// Contract: C-163 Visceral Feedback Juice (equip SFX + appearance sync)
// Contract: C-331 — single equip path through equipmentService (the mutable
// cast hack is gone), stat-compare data, and consumable use.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { ItemDefinition } from '@aikami/types';
import {
  audioService,
  equipmentService,
  gameOverlayService,
  getItemDefinition,
  inventoryService,
} from '$services';

export type InventoryViewModelInterface = BaseViewModelInterface & {
  readonly items: Array<{ itemId: string; quantity: number }>;
  readonly equippedWeaponDef: ItemDefinition | undefined;
  readonly equippedArmorDef: ItemDefinition | undefined;
  /** Transient feedback (inventory full, full HP, etc.) — C-331 AC-2/AC-4. */
  readonly feedbackMessage: string | undefined;

  getItemLabel(itemId: string): string;
  isEquippable(itemId: string): boolean;
  isConsumable(itemId: string): boolean;
  /**
   * Attack/defense delta of a candidate item vs the currently equipped item
   * in the same slot, formatted for display (C-331 AC-4 stat compare).
   */
  getCompareLabel(itemId: string): string | undefined;
  equipItem(itemId: string): void;
  unequipItem(slot: 'weapon' | 'armor'): void;
  useItem(itemId: string): void;
  closeInventory(): void;
};

export class InventoryViewModel
  extends BaseViewModel<BaseViewModelOptions>
  implements InventoryViewModelInterface
{
  /** Local action feedback (use/equip results). */
  actionMessage = $state<string | undefined>(undefined);

  private _actionMessageTimer: ReturnType<typeof setTimeout> | undefined;

  get items(): Array<{ itemId: string; quantity: number }> {
    return inventoryService.inventory;
  }

  get equippedWeaponDef(): ItemDefinition | undefined {
    return equipmentService.equippedWeapon
      ? getItemDefinition(equipmentService.equippedWeapon)
      : undefined;
  }

  get equippedArmorDef(): ItemDefinition | undefined {
    return equipmentService.equippedArmor
      ? getItemDefinition(equipmentService.equippedArmor)
      : undefined;
  }

  get feedbackMessage(): string | undefined {
    return this.actionMessage ?? inventoryService.feedbackMessage;
  }

  getItemLabel(itemId: string): string {
    return getItemDefinition(itemId).label;
  }

  isEquippable(itemId: string): boolean {
    return getItemDefinition(itemId).equippable;
  }

  isConsumable(itemId: string): boolean {
    const definition = getItemDefinition(itemId);
    return definition.itemType === 'consumable' && definition.effect !== undefined;
  }

  /** @inheritdoc */
  getCompareLabel(itemId: string): string | undefined {
    const candidate = getItemDefinition(itemId);
    if (!candidate.equippable || !candidate.slot) {
      return undefined;
    }
    const equippedId =
      candidate.slot === 'weapon'
        ? equipmentService.equippedWeapon
        : equipmentService.equippedArmor;
    const equipped = equippedId ? getItemDefinition(equippedId) : undefined;

    const attackDelta = candidate.attackBonus - (equipped?.attackBonus ?? 0);
    const defenseDelta = candidate.defenseBonus - (equipped?.defenseBonus ?? 0);

    const parts: string[] = [];
    if (candidate.slot === 'weapon' || attackDelta !== 0) {
      parts.push(`${attackDelta >= 0 ? '+' : ''}${attackDelta} ATK`);
    }
    if (candidate.slot === 'armor' || defenseDelta !== 0) {
      parts.push(`${defenseDelta >= 0 ? '+' : ''}${defenseDelta} DEF`);
    }
    return parts.join(' ');
  }

  equipItem(itemId: string): void {
    const equipped = equipmentService.equipItem({ itemId });
    if (equipped) {
      void audioService.playSfx('/assets/audio/sfx/sfx_equip.wav');
    }
  }

  unequipItem(slot: 'weapon' | 'armor'): void {
    equipmentService.unequipItem({ slot });
  }

  /** @inheritdoc */
  useItem(itemId: string): void {
    const result = inventoryService.useConsumable({ itemId });
    if (result === 'ok') {
      void audioService.playSfx('/assets/audio/sfx/sfx_pickup.wav');
      this._showActionMessage(`Used ${getItemDefinition(itemId).label}`);
      return;
    }
    if (result === 'full-hp') {
      this._showActionMessage('Already at full HP');
    }
  }

  closeInventory(): void {
    gameOverlayService.closeInventory();
  }

  /** Shows a transient action message (auto-clears after 2.5s). */
  private _showActionMessage(message: string): void {
    if (this._actionMessageTimer) {
      clearTimeout(this._actionMessageTimer);
    }
    this.actionMessage = message;
    this._actionMessageTimer = setTimeout(() => {
      this.actionMessage = undefined;
    }, 2500);
  }
}

export const getInventoryViewModel = (options: BaseViewModelOptions): InventoryViewModelInterface =>
  InventoryViewModel.create(options);
