// apps/frontend/client/src/lib/views/dev/lpc_inventory/lpc_inventory_view_model.svelte.ts
//
// Dev sandbox: live LPC preview + inventory paperdoll side by side.
// Moving equipment items between the bag and the paperdoll updates the
// LPC character render in real time (C-374).
//
// Extends InventoryViewModel (all equip/unequip/use actions) and drives an
// LpcPreviewViewModel whose recipes are rebuilt from the base appearance +
// current equipment whenever the equipment slots change.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures. Production wiring lives in
// ./lpc_inventory_composition.ts.

import { DEFAULT_LPC_RECIPE } from '@aikami/constants';

import type { LpcLayerRecipe } from '@aikami/frontend/engine/sim';
import type { EquipmentServiceInterface, InventoryServiceInterface } from '$services';
import type { LpcPreviewViewModelInterface } from '$views/character/lpc_preview/lpc_preview_view_model.svelte';
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

// ── Capability contracts ────────────────────────────────────────────────

/** The equipment sandbox operations the LPC preview rebuild depends on. */
export type LpcEquipmentCapabilities = Pick<
  EquipmentServiceInterface,
  'slots' | 'reset' | 'configureAppearanceContext' | 'buildLpcRecipes'
>;

/** The inventory reset/seed operations the sandbox performs. */
export type LpcInventoryCapabilities = Pick<InventoryServiceInterface, 'inventory' | 'reset'>;

/** The LPC catalog snapshot (slot → asset IDs) the wearer context is built from. */
export type LpcCatalogCapabilities = {
  readonly assetIdsBySlot: Readonly<Record<string, readonly string[]>>;
};

/** Base configuration used to create the LPC inventory sandbox ViewModel. */
export type LpcInventoryViewModelOptions = InventoryViewModelOptions & {
  /** Live LPC preview instance the sandbox drives. */
  lpcPreview: LpcPreviewViewModelInterface;
  /** Equipment sandbox operations. */
  lpcEquipment: LpcEquipmentCapabilities;
  /** Inventory sandbox reset/seed operations. */
  lpcInventory: LpcInventoryCapabilities;
  /** LPC catalog snapshot. */
  lpcCatalog: LpcCatalogCapabilities;
};

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

  private readonly _lpcEquipment: LpcEquipmentCapabilities;
  private readonly _lpcInventory: LpcInventoryCapabilities;
  private readonly _lpcCatalog: LpcCatalogCapabilities;

  constructor(options: InventoryViewModelOptions) {
    super(options);
    const lpcOptions = options as LpcInventoryViewModelOptions;
    this.lpcPreview = lpcOptions.lpcPreview;
    this._lpcEquipment = lpcOptions.lpcEquipment;
    this._lpcInventory = lpcOptions.lpcInventory;
    this._lpcCatalog = lpcOptions.lpcCatalog;
  }

  override async initialize(): Promise<void> {
    // Fresh bag + wearer context. The base appearance renders the full
    // DEFAULT_LPC_RECIPE (including torso/feet); equipped gear overlays it,
    // so unequip reveals the base outfit instead of a bare body.
    this._lpcInventory.reset();
    this._lpcEquipment.reset();
    this._lpcEquipment.configureAppearanceContext({
      bodyAssetId: DEFAULT_LPC_RECIPE.body,
      catalogAssetIdsBySlot: this._lpcCatalog.assetIdsBySlot,
    });
    this._lpcInventory.inventory = SANDBOX_BAG.map((entry) => ({ ...entry }));

    // Rebuild the preview recipes whenever equipment slots change.
    this.registerEffectRoot(() => {
      $effect(() => {
        void this._lpcEquipment.slots;
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

    for (const equipmentRecipe of this._lpcEquipment.buildLpcRecipes()) {
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

/**
 * Builds the LPC inventory sandbox ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getLpcInventoryViewModel` in
 * ./lpc_inventory_composition.ts.
 */
const asInventoryOptions = (options: LpcInventoryViewModelOptions): InventoryViewModelOptions =>
  options;

export const createLpcInventoryViewModel = (
  options: LpcInventoryViewModelOptions,
): LpcInventoryViewModel => LpcInventoryViewModel.create(asInventoryOptions(options));
