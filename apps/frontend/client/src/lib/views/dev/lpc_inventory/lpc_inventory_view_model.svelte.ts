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
import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { getLpcCatalog } from '$lib/data/lpc_asset_catalog';
import { equipmentService, gameOverlayService, inventoryService, playSfxByName } from '$services';
import {
  getLpcPreviewViewModel,
  type LpcPreviewViewModelInterface,
} from '$views/character/lpc_preview/lpc_preview_view_model.svelte';
import {
  InventoryViewModel,
  type InventoryViewModelInterface,
  type InventoryViewModelOptions,
} from '../../inventory/inventory_view_model.svelte';

/** Empty palette — equipment sprites render with their authored colours. */
const EMPTY_PALETTE = new Uint8Array(1024);

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
export type LpcInventoryViewModelOptions = InventoryViewModelOptions;

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

  constructor(options: LpcInventoryViewModelOptions) {
    super(options);
    this.lpcPreview = getLpcPreviewViewModel({ className: 'LpcInventoryPreviewViewModel' });
  }

  override async initialize(): Promise<void> {
    // Fresh bag + wearer context. The base appearance renders the full
    // DEFAULT_LPC_RECIPE (including torso/feet); equipped gear overlays it,
    // so unequip reveals the base outfit instead of a bare body.
    inventoryService.reset();
    equipmentService.reset();
    equipmentService.configureAppearanceContext({
      bodyAssetId: DEFAULT_LPC_RECIPE.body,
      catalogAssetIdsBySlot: getLpcCatalog().assetIdsBySlot,
    });
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
   * Mirrors the in-game merge: the full base recipe renders first, then
   * equipment layers replace overlapping base slots (torso/feet) and append
   * the non-base layers (hat/weapon/shield).
   */
  private _refreshPreview(): void {
    const recipes: LpcLayerRecipe[] = [];

    for (const [slot, assetId] of Object.entries(DEFAULT_LPC_RECIPE)) {
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
      // guard-ignore lint/type-safety/casting: custom window property for e2e hooks
      (window as unknown as Record<string, unknown>).__LPC_PREVIEW_RECIPES__ = recipes.map(
        (recipe) => ({ slot: recipe.slot, assetId: recipe.assetId }),
      );
    }
  }
}

const _lpcInventoryOptions = (options: BaseViewModelOptions): InventoryViewModelOptions => ({
  ...options,
  inventory: inventoryService,
  equipment: equipmentService,
  overlays: gameOverlayService,
  sfx: { playSfxByName },
});

export const getLpcInventoryViewModel = (options: BaseViewModelOptions): LpcInventoryViewModel =>
  LpcInventoryViewModel.create(_lpcInventoryOptions(options));
