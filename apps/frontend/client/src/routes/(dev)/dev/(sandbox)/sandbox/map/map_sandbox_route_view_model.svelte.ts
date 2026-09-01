// apps/frontend/client/src/routes/(dev)/dev/sandbox/map/map_sandbox_route_view_model.svelte.ts
//
// ViewModel for the Map sandbox route — handles resolver creation, manifest
// loading, and catalog fetch before the WalkSandbox component is rendered.

import {
  BaseDevViewModel,
  type BaseDevViewModelInterface,
  type BaseDevViewModelOptions,
} from '@aikami/frontend/services';
import type { AssetResolver } from '@aikami/types';

export type MapSandboxRouteViewModelOptions = BaseDevViewModelOptions;

export type MapSandboxRouteViewModelInterface = BaseDevViewModelInterface & {
  readonly resolver: AssetResolver | undefined;
  readonly loading: boolean;
};

class MapSandboxRouteViewModel
  extends BaseDevViewModel<BaseDevViewModelOptions>
  implements MapSandboxRouteViewModelInterface
{
  resolver = $state<AssetResolver | undefined>(undefined);
  loading = $state(true);

  override async initialize(): Promise<void> {
    try {
      const { createRegistryAssetResolver } = await import(
        '$lib/services/assets/registry_asset_resolver'
      );
      this.resolver = createRegistryAssetResolver();

      // Fetch asset catalog before creating/rendering WalkSandbox
      const { assetStore } = await import('$lib/services/assets/asset_store.svelte');
      await assetStore.fetchManifest();
    } catch (err) {
      this.error('mapSandboxRoute.resolverFailed', { error: String(err) });
    } finally {
      this.loading = false;
    }
    return await super.initialize();
  }

  override async dispose(): Promise<void> {
    this.resolver = undefined;
    return await super.dispose();
  }
}

export const getMapSandboxRouteViewModel = (
  options: BaseDevViewModelOptions,
): MapSandboxRouteViewModelInterface => MapSandboxRouteViewModel.create(options);
