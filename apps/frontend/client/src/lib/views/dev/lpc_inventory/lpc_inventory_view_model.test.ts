// apps/frontend/client/src/lib/views/dev/lpc_inventory/lpc_inventory_view_model.test.ts
//
// LpcInventoryViewModel — sandbox reset/seed wiring and preview composition
// through explicit capability fixtures.
//
// Contract: C-374 paperdoll + live LPC preview

import { describe, expect, mock, test } from 'bun:test';
import { DEFAULT_LPC_RECIPE } from '@aikami/constants';
import type { LpcLayerRecipe } from '@aikami/frontend/engine/sim';
import type { EquipmentSlot } from '@aikami/types';
import type { LpcPreviewViewModelInterface } from '$views/character/lpc_preview/lpc_preview_view_model.svelte';
import {
  createLpcInventoryViewModel,
  type LpcCatalogCapabilities,
  type LpcEquipmentCapabilities,
} from './lpc_inventory_view_model.svelte.ts';

const createHarness = () => {
  const resetInventory = mock(() => {});
  const inventory = {
    inventory: [] as Array<{ itemId: string; quantity: number }>,
    feedbackMessage: undefined,
    useConsumable: mock((_options: { itemId: string }) => 'ok' as const),
    reset: resetInventory,
  };

  const equipment = {
    getEquippedItemId: mock((_slot: EquipmentSlot) => undefined as string | undefined),
    totalAttack: 0,
    totalDefense: 0,
    equipItem: mock((_options: { itemId: string }) => false),
    unequipItem: mock((_options: { slot: EquipmentSlot }) => false),
  };

  const setRecipes = mock((_recipes: readonly LpcLayerRecipe[]) => {});
  const lpcPreview = { setRecipes } as LpcPreviewViewModelInterface;

  const resetEquipment = mock(() => {});
  const configureAppearanceContext = mock(
    (_options: {
      bodyAssetId: string | undefined;
      catalogAssetIdsBySlot: Readonly<Record<string, readonly string[]>>;
    }) => {},
  );
  const buildLpcRecipes = mock((): readonly LpcLayerRecipe[] => []);
  const lpcEquipment = {
    slots: {},
    reset: resetEquipment,
    configureAppearanceContext,
    buildLpcRecipes,
  } satisfies LpcEquipmentCapabilities;

  const lpcCatalog = { assetIdsBySlot: {} } satisfies LpcCatalogCapabilities;

  const viewModel = createLpcInventoryViewModel({
    className: 'LpcInventoryViewModel',
    inventory,
    equipment,
    overlays: { closeInventory: mock(() => {}) },
    sfx: { playSfxByName: mock((_name: string) => {}) },
    lpcPreview,
    lpcEquipment,
    lpcInventory: inventory,
    lpcCatalog,
  });

  return {
    viewModel,
    inventory,
    resetInventory,
    resetEquipment,
    configureAppearanceContext,
    setRecipes,
  };
};

describe('LpcInventoryViewModel — sandbox wiring', () => {
  test('initialize resets inventory + equipment and seeds the sandbox bag', async () => {
    const { viewModel, inventory, resetInventory, resetEquipment } = createHarness();

    await viewModel.initialize();

    expect(resetInventory).toHaveBeenCalledTimes(1);
    expect(resetEquipment).toHaveBeenCalledTimes(1);
    expect(inventory.inventory.length).toBe(16);
    expect(viewModel.items.length).toBe(16);
  });

  test('initialize configures the appearance context with the default body', async () => {
    const { viewModel, configureAppearanceContext } = createHarness();

    await viewModel.initialize();

    expect(configureAppearanceContext).toHaveBeenCalledTimes(1);
    expect(configureAppearanceContext.mock.calls[0]?.[0].bodyAssetId).toBe(DEFAULT_LPC_RECIPE.body);
  });

  test('rebuilds the preview recipes from base + equipment', async () => {
    const { viewModel, setRecipes } = createHarness();

    await viewModel.initialize();

    expect(setRecipes).toHaveBeenCalled();
    const recipes = setRecipes.mock.calls[0]?.[0] ?? [];
    expect(recipes.length).toBeGreaterThan(0);
  });
});
