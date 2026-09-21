// apps/frontend/client/src/lib/views/dev/lpc_inventory/lpc_inventory_composition.ts
//
// Production wiring for the LPC inventory dev sandbox. This is the only module
// in the feature that imports the `$services` barrel; the ViewModel receives
// its dependencies as typed capabilities, so unit tests never touch the global
// service registry.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { getLpcCatalog } from '$lib/data/lpc_asset_catalog';
import { equipmentService, gameOverlayService, inventoryService, playSfxByName } from '$services';
import { getLpcPreviewViewModel } from '$views/character/lpc_preview/lpc_preview_view_model.svelte';
import {
  createLpcInventoryViewModel,
  type LpcInventoryViewModel,
  type LpcInventoryViewModelOptions,
} from './lpc_inventory_view_model.svelte';

/**
 * Builds the LPC inventory ViewModel wired to the production inventory,
 * equipment, overlay, audio, and LPC catalog singletons.
 */
export const getLpcInventoryViewModel = (options: BaseViewModelOptions): LpcInventoryViewModel => {
  const opts: LpcInventoryViewModelOptions = {
    ...options,
    inventory: inventoryService,
    equipment: equipmentService,
    overlays: gameOverlayService,
    sfx: { playSfxByName },
    lpcPreview: getLpcPreviewViewModel({ className: 'LpcInventoryPreviewViewModel' }),
    lpcEquipment: equipmentService,
    lpcInventory: inventoryService,
    lpcCatalog: getLpcCatalog(),
  };
  return createLpcInventoryViewModel(opts);
};
