// apps/frontend/client/src/lib/views/dev/lpc_inventory/lpc_inventory_view_model.svelte.ts
//
// Dev sandbox: live LPC preview + inventory paperdoll side by side.
// Moving equipment items between the bag and the paperdoll updates the
// LPC character render in real time (C-374).
//
// Extends InventoryViewModel (all equip/unequip/use actions) and drives an
// LpcPreviewViewModel whose recipes are rebuilt from the base appearance +
// current equipment whenever the equipment slots change.

import { DEFAULT_LPC_RECIPE } from '@aikami/constants';
import type { LpcLayerRecipe } from '@aikami/frontend/engine/sim';
import type { BaseViewModelOptions } from '@aikami/frontend/services';
import { equipmentService, inventoryService } from '$services';
import {
  getLpcPreviewViewModel,
  type LpcPreviewViewModelInterface,
} from '$views/character/lpc_preview/lpc_preview_view_model.svelte';
import {
  InventoryViewModel,
  type InventoryViewModelInterface,
} from '../../inventory/inventory_view_model.svelte';

/** Empty palette — equipment sprites render with their authored colours. */
const EMPTY_PALETTE = new Uint8Array(1024);

/** Base appearance slots owned by equipment (rendered via gear, not base). */
const EQUIPMENT_OWNED_BASE_SLOTS = new Set(['torso', 'feet']);

/** Sample gear granted to the sandbox bag for live equip testing. */
const SANDBOX_BAG: ReadonlyArray<{ itemId: string; quantity: number }> = [
  { itemId: 'ironSword', quantity: 1 },
  { itemId: 'steelSword', quantity: 1 },
  { itemId: 'shortBow', quantity: 1 },
  { itemId: 'recurveBow', quantity: 1 },
  { itemId: 'greatBow', quantity: 1 },
  { itemId: 'woodenShield', quantity: 1 },
  { itemId: 'ironShield', quantity: 1 },
  { itemId: 'towerShield', quantity: 1 },
  { itemId: 'clothTunic', quantity: 1 },
  { itemId: 'leatherArmor', quantity: 1 },
  { itemId: 'ironArmor', quantity: 1 },
  { itemId: 'plateBoots', quantity: 1 },
  { itemId: 'leatherCap', quantity: 1 },
  { itemId: 'ironHelmet', quantity: 1 },
  { itemId: 'greatHelmet', quantity: 1 },
  { itemId: 'healthPotion', quantity: 2 },
] as const;

/** Base configuration used to create the LPC inventory sandbox ViewModel. */
export type LpcInventoryViewModelOptions = BaseViewModelOptions;

/** Inventory ViewModel contract extended with LPC sandbox controls. */
export type LpcInventoryViewModelInterface = InventoryViewModelInterface & {
  readonly lpcPreview: LpcPreviewViewModelInterface;
};

export class LpcInventoryViewModel
  extends InventoryViewModel
  implements LpcInventoryViewModelInterface
{
  /** Live LPC character preview driven by base + equipment recipes. */
  readonly lpcPreview: LpcPreviewViewModelInterface;

  constructor(options: BaseViewModelOptions) {
    super(options);
    this.lpcPreview = getLpcPreviewViewModel({ className: 'LpcInventoryPreviewViewModel' });
  }

  override async initialize(): Promise<void> {
    // Seed a fresh bag + the character's base outfit (chainmail + boots).
    inventoryService.reset();
    equipmentService.reset();
    equipmentService.seedBaseOutfit({ ...DEFAULT_LPC_RECIPE });
    inventoryService.inventory = SANDBOX_BAG.map((entry) => ({ ...entry }));

    // Rebuild the preview recipes whenever equipment slots change.
    this.registerEffectRoot(() => {
      $effect(() => {
        void equipmentService.slots;
        this._refreshPreview();
      });
    });

    await super.initialize();
  }

  /**
   * Rebuilds the preview character from the base appearance + equipped gear.
   *
   * Mirrors the in-game merge: base layers (body, hair, legs, head) plus
   * equipment layers; body/feet equipment replace the base torso/feet
   * layers, and hat/weapon/shield are appended on top.
   */
  private _refreshPreview(): void {
    const recipes: LpcLayerRecipe[] = [];

    for (const [slot, assetId] of Object.entries(DEFAULT_LPC_RECIPE)) {
      if (EQUIPMENT_OWNED_BASE_SLOTS.has(slot)) {
        continue; // provided by equipment
      }
      if (assetId) {
        recipes.push({ slot, assetId, hexPalette: EMPTY_PALETTE });
      }
    }

    for (const equipmentRecipe of equipmentService.buildLpcRecipes()) {
      const overlapIndex = recipes.findIndex((r) => r.slot === equipmentRecipe.slot);
      if (overlapIndex >= 0) {
        recipes[overlapIndex] = equipmentRecipe;
      } else {
        recipes.push(equipmentRecipe);
      }
    }

    this.lpcPreview.setRecipes(recipes);
    // E2E hook (C-417 AC-1): expose the composed recipes so the spec can
    // assert the preview output actually swaps the torso layer (chainmail →
    // Iron Armour plate) on equip and reverts on unequip — mirrors the
    // existing __PIXI_LPC_PREVIEW_LOADED__ window hook pattern.
    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__LPC_PREVIEW_RECIPES__ = recipes.map(
        (recipe) => ({ slot: recipe.slot, assetId: recipe.assetId }),
      );
    }
  }
}

export const getLpcInventoryViewModel = (options: BaseViewModelOptions): LpcInventoryViewModel =>
  LpcInventoryViewModel.create(options) as LpcInventoryViewModel;
