// apps/frontend/client/src/lib/views/asset-browser/asset_browser_composition.ts
//
// Production wiring for the Asset Browser feature. This is the only module in
// the feature that imports the `$services` singleton; the ViewModel receives it
// as a typed capability.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { assetStore } from '$services';
import {
  type AssetBrowserViewModelInterface,
  createAssetBrowserViewModel,
} from './asset_browser_view_model.svelte';

/**
 * Builds the asset-browser ViewModel wired to the production asset store.
 */
export const getAssetBrowserViewModel = (
  options: BaseViewModelOptions,
): AssetBrowserViewModelInterface =>
  createAssetBrowserViewModel({
    ...options,
    store: assetStore,
  });
