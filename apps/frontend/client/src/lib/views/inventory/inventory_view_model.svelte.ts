// apps/frontend/client/src/lib/views/inventory/inventory_view_model.svelte.ts
//
// Inventory ViewModel. Reads inventory + equipment state from the domain
// services and exposes equip/unequip/use actions for the 6-slot paperdoll
// (leftHand, rightHand, head, torso, arms, feet).
//
// Contract: C-153 Character Dashboard & Equipment
// Contract: C-163 Visceral Feedback Juice (equip SFX + appearance sync)
// Contract: C-331 — single equip path through equipmentService, stat-compare
// data, and consumable use.
// Contract: C-374 — full paperdoll slots + summed stats.

import {
  EQUIPMENT_SLOT_ICONS,
  EQUIPMENT_SLOT_LABELS,
  EQUIPMENT_SLOT_ORDER,
} from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { EquipmentSlot, ItemDefinition } from '@aikami/types';
import {
  equipmentService,
  gameOverlayService,
  getItemDefinition,
  inventoryService,
  playSfxByName,
} from '$services';

export type EquippedItemView = {
  slot: EquipmentSlot;
  itemId: string;
  definition: ItemDefinition;
};

export type InventoryViewModelOptions = BaseViewModelOptions;

export type InventoryViewModelInterface = BaseViewModelInterface & {
  readonly items: Array<{ itemId: string; quantity: number }>;
  /** Canonical paperdoll slot order for the view grid. */
  readonly slotOrder: readonly EquipmentSlot[];
  /** Slot-ordered list of currently equipped items with definitions. */
  readonly equippedItems: ReadonlyArray<EquippedItemView>;
  readonly totalAttack: number;
  readonly totalDefense: number;
  /** Transient feedback (inventory full, full HP, etc.) — C-331 AC-2/AC-4. */
  readonly feedbackMessage: string | undefined;

  getItemLabel(itemId: string): string;
  getSlotLabel(slot: EquipmentSlot): string;
  getSlotIcon(slot: EquipmentSlot): string;
  /** Returns the equipped entry for a paperdoll slot (undefined = empty). */
  getEquippedItem(slot: EquipmentSlot): EquippedItemView | undefined;
  isEquippable(itemId: string): boolean;
  isConsumable(itemId: string): boolean;
  /**
   * Attack/defense delta of a candidate item vs the currently equipped item
   * in the same slot, formatted for display (C-331 AC-4 stat compare).
   */
  getCompareLabel(itemId: string): string | undefined;
  equipItem(itemId: string): void;
  unequipItem(slot: EquipmentSlot): void;
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

  get slotOrder(): readonly EquipmentSlot[] {
    return EQUIPMENT_SLOT_ORDER;
  }

  /** Slot-ordered equipped items with resolved definitions. */
  get equippedItems(): ReadonlyArray<EquippedItemView> {
    const views: EquippedItemView[] = [];
    for (const slot of EQUIPMENT_SLOT_ORDER) {
      const itemId = equipmentService.getEquippedItemId(slot);
      if (!itemId) {
        continue;
      }
      views.push({ slot, itemId, definition: getItemDefinition(itemId) });
    }
    return views;
  }

  get totalAttack(): number {
    return equipmentService.totalAttack;
  }

  get totalDefense(): number {
    return equipmentService.totalDefense;
  }

  get feedbackMessage(): string | undefined {
    return this.actionMessage ?? inventoryService.feedbackMessage;
  }

  getItemLabel(itemId: string): string {
    return getItemDefinition(itemId).label;
  }

  getSlotLabel(slot: EquipmentSlot): string {
    return EQUIPMENT_SLOT_LABELS[slot];
  }

  getSlotIcon(slot: EquipmentSlot): string {
    return EQUIPMENT_SLOT_ICONS[slot];
  }

  getEquippedItem(slot: EquipmentSlot): EquippedItemView | undefined {
    const itemId = equipmentService.getEquippedItemId(slot);
    if (!itemId) {
      return undefined;
    }
    return { slot, itemId, definition: getItemDefinition(itemId) };
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
    const equipped = this.getEquippedItem(candidate.slot);

    const attackDelta = candidate.attackBonus - (equipped?.definition.attackBonus ?? 0);
    const defenseDelta = candidate.defenseBonus - (equipped?.definition.defenseBonus ?? 0);

    const parts: string[] = [];
    if (attackDelta !== 0) {
      parts.push(`${attackDelta > 0 ? '+' : ''}${attackDelta} ATK`);
    }
    if (defenseDelta !== 0) {
      parts.push(`${defenseDelta > 0 ? '+' : ''}${defenseDelta} DEF`);
    }
    return parts.length > 0 ? parts.join(' ') : undefined;
  }

  equipItem(itemId: string): void {
    const equipped = equipmentService.equipItem({ itemId });
    if (equipped) {
      void playSfxByName('sfx_equip');
    }
  }

  unequipItem(slot: EquipmentSlot): void {
    equipmentService.unequipItem({ slot });
  }

  /** @inheritdoc */
  useItem(itemId: string): void {
    const result = inventoryService.useConsumable({ itemId });
    if (result === 'ok') {
      void playSfxByName('sfx_pickup');
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
