// apps/frontend/client/src/lib/views/community/community_composition.ts
//
// C-513 AC-4: production wiring for the community browse/import surface.
// The only module in this feature that imports the `$services` barrel — the
// ViewModel receives resolved capabilities as a typed option.
//
// Contract: C-513

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { hubApiBase } from '$lib/services/api/hub_api_client';
import { assetManager, assetPrefetchService } from '$services';
import {
  type CommunityViewModelInterface,
  createCommunityViewModel,
} from './community_view_model.svelte';

/**
 * Opens everything the import path reads before it reads it.
 *
 * `/studio/community` is deep-linkable and can load before the game boot
 * pipeline has opened the registry — the import writes a registry row and a
 * cache entry, so both must exist first.
 */
const ensureReady = async (): Promise<void> => {
  await assetPrefetchService.ensureRegistryReady();
};

/**
 * Builds the community ViewModel wired to the hub transport and the local
 * registry.
 */
export const getCommunityViewModel = (options: BaseViewModelOptions): CommunityViewModelInterface =>
  createCommunityViewModel({
    ...options,
    capabilities: {
      ready: ensureReady,
      list: () => assetManager.listCommunityAssets(),
      import: (asset, importOptions) => assetManager.importCommunityAsset(asset, importOptions),
      // C-513 AC-10: the on-device half. Registry-only and cache-first, so it
      // renders after a reload while the hub is unreachable.
      listLibrary: () => assetManager.listImportedAssets(),
      resolvePreview: (tag) => assetManager.resolve(tag),
      // The hub URL is always configured (mode-aware); a failed call surfaces
      // as an error on the row rather than a broken button.
      hubAvailable: () => hubApiBase().length > 0,
    },
  });
