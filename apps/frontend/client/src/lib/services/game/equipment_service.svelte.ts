// apps/frontend/client/src/lib/services/game/equipment_service.svelte.ts
//
// Equipment service (C-374) — owns the 6-slot paperdoll (leftHand,
// rightHand, head, torso, arms, feet), equip/unequip logic, and computed
// attack/defense bonuses summed across all equipped items.
//
// Extracted from game_state_service (C-314 service split). C-374 replaced
// the old weapon/armor dual-slot model with the full paperdoll and rewired
// appearance sync: equip/unequip sends UPDATE_PLAYER_APPEARANCE (a nudge)
// and the main thread merges item → LPC asset recipes on top of the base
// character render (see game_world equipmentRecipeProvider).

import { EQUIPMENT_SLOT_ORDER } from '@aikami/constants';
import type { GameCommand, LpcLayerRecipe } from '@aikami/frontend/engine';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { EquipmentSlot, EquipmentSnapshot } from '@aikami/types';
import type { InventoryServiceInterface } from './inventory_service.svelte';
import {
  findItemIdByLpcAsset,
  getItemDefinition,
  inventoryService,
} from './inventory_service.svelte';
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
  /** Equipped item ID per paperdoll slot (`undefined` = empty). */
  readonly slots: Readonly<Partial<Record<EquipmentSlot, string>>>;
  /** Flat list of filled equipment entries (slot + item ID), slot-ordered. */
  readonly equippedItems: ReadonlyArray<{ slot: EquipmentSlot; itemId: string }>;
  readonly totalAttack: number;
  readonly totalDefense: number;

  /** Wires the engine command sender for UPDATE_PLAYER_APPEARANCE (C-374). */
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

  /** Returns the equipped item ID for a slot (`undefined` = empty). */
  getEquippedItemId(slot: EquipmentSlot): string | undefined;

  /**
   * Seeds the character's base outfit into empty body/feet slots (C-374).
   *
   * The engine's base appearance no longer carries a torso/feet layer —
   * those come from equipment so the paperdoll reflects what the character
   * wears. Given the persona's base LPC recipe (slot → assetId), this maps
   * each body/feet asset to a catalog item and equips it, but only when the
   * slot is empty (never clobbers saved gear).
   *
   * @param baseRecipe - Base appearance recipe (LPC slot → assetId)
   */
  seedBaseOutfit(baseRecipe: Readonly<Record<string, string>>): void;

  /**
   * Builds LPC layer recipes for every equipped item (C-374).
   *
   * Consumed by the engine's `equipmentRecipeProvider` to merge gear onto
   * the player's base character render. Items without a resolvable
   * `lpcAssetId`/`lpcSlot` are skipped.
   */
  buildLpcRecipes(): readonly LpcLayerRecipe[];

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
  slots = $state<Partial<Record<EquipmentSlot, string>>>({});

  private readonly _playerStateService: PlayerStateServiceInterface;
  private readonly _inventoryService: InventoryServiceInterface;
  private _sendCommand: ((command: GameCommand) => void) | undefined;

  constructor(options: EquipmentServiceOptions) {
    super(options);
    this._playerStateService = options.playerStateService;
    this._inventoryService = options.inventoryService;
  }

  /** Flat, slot-ordered list of filled equipment entries. */
  get equippedItems(): ReadonlyArray<{ slot: EquipmentSlot; itemId: string }> {
    const entries: Array<{ slot: EquipmentSlot; itemId: string }> = [];
    for (const slot of EQUIPMENT_SLOT_ORDER) {
      const itemId = this.slots[slot];
      if (itemId) {
        entries.push({ slot, itemId });
      }
    }
    return entries;
  }

  getEquippedItemId(slot: EquipmentSlot): string | undefined {
    return this.slots[slot];
  }

  /** @inheritdoc */
  seedBaseOutfit(baseRecipe: Readonly<Record<string, string>>): void {
    // Base outfit only covers the equipment-owned base layers (body → LPC
    // torso layer, feet → LPC feet layer). Custom appearance assets without
    // a catalog item fall back to the default outfit so the character never
    // renders without clothing.
    const slotToLpc: ReadonlyArray<{ slot: EquipmentSlot; lpcSlot: string; fallback: string }> = [
      { slot: 'body', lpcSlot: 'torso', fallback: 'chainmailArmor' },
      { slot: 'feet', lpcSlot: 'feet', fallback: 'leatherBoots' },
    ];

    for (const { slot, lpcSlot, fallback } of slotToLpc) {
      if (this.slots[slot]) {
        continue; // already equipped — never clobber saved gear
      }
      const assetId = baseRecipe[lpcSlot];
      const itemId = assetId ? findItemIdByLpcAsset(assetId) : undefined;
      const resolvedItemId = itemId ?? fallback;
      this._inventoryService.addItem({ itemId: resolvedItemId, quantity: 1 });
      this.equipItem({ itemId: resolvedItemId });
      this.debug('seedBaseOutfit', { slot, assetId: assetId ?? '(none)', itemId: resolvedItemId });
    }
  }

  /** @inheritdoc */
  buildLpcRecipes(): readonly LpcLayerRecipe[] {
    const recipes: LpcLayerRecipe[] = [];
    for (const { itemId } of this.equippedItems) {
      const definition = getItemDefinition(itemId);
      if (!definition.lpcSlot || !definition.lpcAssetId) {
        continue;
      }
      recipes.push({
        slot: definition.lpcSlot,
        assetId: definition.lpcAssetId,
        hexPalette: new Uint8Array(1024),
      });
    }
    return recipes;
  }

  /** Total attack = base + summed attack bonus of all equipped items. */
  get totalAttack(): number {
    const base = this._playerStateService?.playerBaseAttack ?? 5;
    return base + this._equipmentAttackBonus;
  }

  /** Total defense = base + summed defense bonus of all equipped items. */
  get totalDefense(): number {
    const base = this._playerStateService?.playerBaseDefense ?? 12;
    return base + this._equipmentDefenseBonus;
  }

  /** Sum of attack bonuses across all equipped items. */
  private get _equipmentAttackBonus(): number {
    let total = 0;
    for (const { itemId } of this.equippedItems) {
      total += getItemDefinition(itemId).attackBonus;
    }
    return total;
  }

  /** Sum of defense bonuses across all equipped items. */
  private get _equipmentDefenseBonus(): number {
    let total = 0;
    for (const { itemId } of this.equippedItems) {
      total += getItemDefinition(itemId).defenseBonus;
    }
    return total;
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
    if (this.slots[slot]) {
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
    this.slots = { ...this.slots, [slot]: itemId };

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
    const itemId = this.slots[slot];
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
    const next = { ...this.slots };
    delete next[slot];
    this.slots = next;

    this.debug('_unequipCurrent', { itemId, slot });
    return true;
  }

  /**
   * Sends UPDATE_PLAYER_APPEARANCE with the current slot state over the
   * bridge so the player sprite reflects equipment (C-374). The worker
   * re-emits APPEARANCE_CHANGED; the main thread merges equipment recipes
   * before re-rendering. Best-effort — missing sender is a no-op.
   */
  private _emitAppearanceUpdate(): void {
    if (!this._sendCommand) {
      return;
    }
    try {
      this._sendCommand({
        type: 'UPDATE_PLAYER_APPEARANCE',
        slots: { ...this.slots },
      });
    } catch (error) {
      this.debug('_emitAppearanceUpdate:failed', { error: String(error) });
    }
  }

  /** @inheritdoc */
  serialize(): EquipmentSnapshot {
    return {
      slots: { ...this.slots },
    };
  }

  /** @inheritdoc */
  hydrate(data: EquipmentSnapshot): void {
    if (!data) {
      return;
    }
    // C-374: new `slots` record is the canonical shape; legacy saves carry
    // equippedWeapon / equippedArmor (pre-C-374) which map to rightHand /
    // body respectively.
    const slots: Partial<Record<EquipmentSlot, string>> = {};
    if (data.slots) {
      for (const [slot, itemId] of Object.entries(data.slots)) {
        if (itemId && EQUIPMENT_SLOT_ORDER.includes(slot as EquipmentSlot)) {
          slots[slot as EquipmentSlot] = itemId;
        }
      }
    }
    if (data.equippedWeapon && !slots.rightHand) {
      slots.rightHand = data.equippedWeapon;
    }
    if (data.equippedArmor && !slots.body) {
      slots.body = data.equippedArmor;
    }
    this.slots = slots;
    this.debug('hydrate', { slots: JSON.stringify(slots) });
    this._emitAppearanceUpdate();
  }

  /** @inheritdoc */
  reset(): void {
    this.slots = {};
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
