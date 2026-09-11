// apps/frontend/client/src/lib/views/vendor/vendor_composition.ts
//
// Production wiring for the vendor overlay. This is the only module in the
// feature that imports the `$services` singleton; the ViewModel receives them
// as typed capabilities, so unit tests never touch the global service registry.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { gameModeService, gameOverlayService, vendorService } from '$services';
import type { VendorSessionOptions } from './vendor_view_model.svelte';
import { createVendorViewModel, type VendorViewModelInterface } from './vendor_view_model.svelte';

/**
 * Builds the vendor ViewModel wired to the production vendor, game-mode, and
 * overlay singletons.
 */
export const getVendorViewModel = (
  options: BaseViewModelOptions & VendorSessionOptions,
): VendorViewModelInterface =>
  createVendorViewModel({
    ...options,
    vendor: vendorService,
    mode: gameModeService,
    overlays: gameOverlayService,
  });
