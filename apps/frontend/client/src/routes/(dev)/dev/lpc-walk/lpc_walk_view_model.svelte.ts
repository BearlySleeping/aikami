// apps/frontend/client/src/routes/(dev)/dev/lpc-walk/lpc_walk_view_model.svelte.ts
//
// ViewModel for the LPC Walk sandbox route — handles resolver creation and
// manifest loading before the WalkSandbox component is rendered.

import {
  BaseDevViewModel,
  type BaseDevViewModelInterface,
  type BaseDevViewModelOptions,
} from '@aikami/frontend/services';
import type { AssetResolver } from '@aikami/types';

export type LpcWalkViewModelOptions = BaseDevViewModelOptions;

export type LpcWalkViewModelInterface = BaseDevViewModelInterface & {
  readonly resolver: AssetResolver | undefined;
  readonly loading: boolean;
};

class LpcWalkViewModel
  extends BaseDevViewModel<BaseDevViewModelOptions>
  implements LpcWalkViewModelInterface
{
  resolver = $state<AssetResolver | undefined>(undefined);
  loading = $state(true);

  override async initialize(): Promise<void> {
    try {
      const { createRegistryAssetResolver } = await import(
        '$lib/services/assets/registry_asset_resolver'
      );
      this.resolver = createRegistryAssetResolver();
    } catch (err) {
      this.error('lpcWalk.resolverFailed', { error: String(err) });
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

export const getLpcWalkViewModel = (options: BaseDevViewModelOptions): LpcWalkViewModelInterface =>
  LpcWalkViewModel.create(options);
