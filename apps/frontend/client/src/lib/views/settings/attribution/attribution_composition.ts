// apps/frontend/client/src/lib/views/settings/attribution/attribution_composition.ts
//
// Production wiring for the attribution ViewModel. This is the only module in
// the feature that imports the engine, asset resolvers, campaign service, or
// router singleton.

import { routerService } from '@aikami/frontend/services';
import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { campaignService } from '$services';
import {
  type AttributionPackManifest,
  type AttributionViewModelInterface,
  createAttributionViewModel,
} from './attribution_view_model.svelte.ts';

export const getAttributionViewModel = (
  options: BaseViewModelOptions,
): AttributionViewModelInterface =>
  createAttributionViewModel({
    ...options,
    getActiveContentPackId: () => campaignService.activeCampaign?.contentPackId,
    loadPack: async (packId): Promise<AttributionPackManifest> => {
      const { loadContentPack } = await import('@aikami/frontend/engine');
      const { assetTagResolver } = await import('$lib/services/assets/registry_resolver');
      const { assetManager } = await import('$lib/services/assets/asset_manager.svelte');
      const pack = await loadContentPack({
        packId,
        resolveTag: assetTagResolver,
        releaseUrl: (url: string) => assetManager.releaseUrl(url),
      });
      const manifest = pack.manifest;
      return {
        name: manifest.name,
        tiles: manifest.tiles,
        props: manifest.props,
        atlas: manifest.atlas,
      };
    },
    goToHref: (href: string) => {
      void routerService.goToHref(href);
    },
  });
