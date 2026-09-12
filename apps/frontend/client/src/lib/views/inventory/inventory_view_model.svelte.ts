// apps/frontend/client/src/lib/views/inventory/inventory_view_model.svelte.ts
//
// Inventory ViewModel. Reads inventory + equipment state from injected
// domain capabilities and exposes equip/unequip/use actions for the 6-slot
// paperdoll (leftHand, rightHand, head, torso, arms, feet).
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures. Production wiring lives in
// ./inventory_composition.ts.
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
} from '@aikami/frontend/services/base';
import type { EquipmentSlot, ItemDefinition } from '@aikami/types';
import { getItemDefinition } from '$utils/inventory_utils';

// ── Capability contracts ────────────────────────────────────────────────

/** The inventory data and operations the paperdoll consumes. */
export type InventoryCapabilities = {
  inventory: Array<{ itemId: string; quantity: number }>;
  readonly feedbackMessage: string | undefined;
  useConsumable(options: { itemId: string }): 'ok' | 'not-owned' | 'not-consumable' | 'full-hp';
};

/** The equipment state and operations the paperdoll consumes. */
export type EquipmentCapabilities = {
  getEquippedItemId(slot: EquipmentSlot): string | undefined;
  readonly totalAttack: number;
  readonly totalDefense: number;
  equipItem(options: { itemId: string }): boolean;
  unequipItem(options: { slot: EquipmentSlot }): boolean;
};

/** The overlay-navigation capability the inventory overlay invokes on close. */
export type InventoryOverlayCapabilities = {
  closeInventory(): void;
};

/** The sound-effect capability for equip/use feedback. */
export type InventorySfxCapabilities = {
  playSfxByName(name: string): void;
};

// ── Types ───────────────────────────────────────────────────────────────

export type EquippedItemView = {
  slot: EquipmentSlot;
  itemId: string;
  definition: ItemDefinition;
};

/** Bag ordering options. `acquired` preserves pickup order — the default. */
export type InventorySortMode = 'acquired' | 'name' | 'quantity';

/** Base configuration used to create the inventory ViewModel. */
export type InventoryViewModelOptions = BaseViewModelOptions & {
  /** Inventory data and operations. */
  inventory: InventoryCapabilities;
  /** Equipment state and operations. */
  equipment: EquipmentCapabilities;
  /** Overlay navigation. */
  overlays: InventoryOverlayCapabilities;
  /** Sound-effect playback. */
  sfx: InventorySfxCapabilities;
};

export type InventoryViewModelInterface = BaseViewModelInterface & {
  readonly items: Array<{ itemId: string; quantity: number }>;
  /** Whether the bag has any items at all. */
  readonly hasItems: boolean;
  /** Bag after the active search and sort are applied. */
  readonly visibleItems: Array<{ itemId: string; quantity: number }>;
  readonly searchQuery: string;
  readonly hasSearchQuery: boolean;
  readonly sortMode: InventorySortMode;
  setSearchQuery(query: string): void;
  setSortMode(mode: InventorySortMode): void;
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

// ── Implementation ──────────────────────────────────────────────────────

export class InventoryViewModel
  extends BaseViewModel<InventoryViewModelOptions>
  implements InventoryViewModelInterface
{
  private readonly _inventory: InventoryCapabilities;
  private readonly _equipment: EquipmentCapabilities;
  private readonly _overlays: InventoryOverlayCapabilities;
  private readonly _sfx: InventorySfxCapabilities;

  /** Local action feedback (use/equip results). */
  actionMessage = $state<string | undefined>(undefined);

  /** Local bag search + sort (presentation-only; never mutates the inventory). */
  searchQuery = $state('');
  sortMode = $state<InventorySortMode>('acquired');

  private _actionMessageTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: InventoryViewModelOptions) {
    super(options);
    this._inventory = options.inventory;
    this._equipment = options.equipment;
    this._overlays = options.overlays;
    this._sfx = options.sfx;
  }

  get items(): Array<{ itemId: string; quantity: number }> {
    return this._inventory.inventory;
  }

  get hasItems(): boolean {
    return this.items.length > 0;
  }

  get hasSearchQuery(): boolean {
    return this.searchQuery.trim().length > 0;
  }

  setSearchQuery(query: string): void {
    this.searchQuery = query;
  }

  setSortMode(mode: InventorySortMode): void {
    this.sortMode = mode;
  }

  /** Bag after the active search + sort, copied so the source is never mutated. */
  get visibleItems(): Array<{ itemId: string; quantity: number }> {
    const query = this.searchQuery.trim().toLowerCase();
    const filtered = query
      ? this.items.filter((item) => this.getItemLabel(item.itemId).toLowerCase().includes(query))
      : [...this.items];

    if (this.sortMode === 'name') {
      filtered.sort((a, b) =>
        this.getItemLabel(a.itemId).localeCompare(this.getItemLabel(b.itemId)),
      );
    } else if (this.sortMode === 'quantity') {
      filtered.sort((a, b) => b.quantity - a.quantity);
    }
    return filtered;
  }

  get slotOrder(): readonly EquipmentSlot[] {
    return EQUIPMENT_SLOT_ORDER;
  }

  /** Slot-ordered equipped items with resolved definitions. */
  get equippedItems(): ReadonlyArray<EquippedItemView> {
    const views: EquippedItemView[] = [];
    for (const slot of EQUIPMENT_SLOT_ORDER) {
      const itemId = this._equipment.getEquippedItemId(slot);
      if (!itemId) {
        continue;
      }
      views.push({ slot, itemId, definition: getItemDefinition(itemId) });
    }
    return views;
  }

  get totalAttack(): number {
    return this._equipment.totalAttack;
  }

  get totalDefense(): number {
    return this._equipment.totalDefense;
  }

  get feedbackMessage(): string | undefined {
    return this.actionMessage ?? this._inventory.feedbackMessage;
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
    const itemId = this._equipment.getEquippedItemId(slot);
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
    const equipped = this._equipment.equipItem({ itemId });
    if (equipped) {
      void this._sfx.playSfxByName('sfx_equip');
    }
  }

  unequipItem(slot: EquipmentSlot): void {
    this._equipment.unequipItem({ slot });
  }

  /** @inheritdoc */
  useItem(itemId: string): void {
    const result = this._inventory.useConsumable({ itemId });
    if (result === 'ok') {
      void this._sfx.playSfxByName('sfx_pickup');
      this._showActionMessage(`Used ${getItemDefinition(itemId).label}`);
      return;
    }
    if (result === 'full-hp') {
      this._showActionMessage('Already at full HP');
    }
  }

  closeInventory(): void {
    this._overlays.closeInventory();
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

/**
 * Builds an inventory ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getInventoryViewModel` in ./inventory_composition.ts.
 */
export const createInventoryViewModel = (
  options: InventoryViewModelOptions,
): InventoryViewModelInterface => InventoryViewModel.create(options);
