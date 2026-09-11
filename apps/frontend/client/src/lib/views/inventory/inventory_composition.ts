// apps/frontend/client/src/lib/views/inventory/inventory_composition.ts
//
// Production wiring for the inventory paperdoll. This is the only module in the
// feature that imports the `$services` singletons; the ViewModel receives them
// as typed capabilities, so unit tests never touch the global service registry.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { equipmentService, gameOverlayService, inventoryService, playSfxByName } from '$services';
import {
  createInventoryViewModel,
  type InventoryViewModelInterface,
} from './inventory_view_model.svelte';

/**
 * Builds the inventory ViewModel wired to the production inventory, equipment,
 * overlay, and audio singletons.
 */
export const getInventoryViewModel = (options: BaseViewModelOptions): InventoryViewModelInterface =>
  createInventoryViewModel({
    ...options,
    inventory: inventoryService,
    equipment: equipmentService,
    overlays: gameOverlayService,
    sfx: { playSfxByName },
  });
