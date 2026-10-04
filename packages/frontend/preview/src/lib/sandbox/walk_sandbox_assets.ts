// packages/frontend/preview/src/lib/sandbox/walk_sandbox_assets.ts
// Supply the shared catalog seam to both entity and legacy tileset loaders.
import type { GameWorldOptions } from '@aikami/frontend/engine';
import { pathToTag } from '@aikami/frontend/engine/sim';
import type { AssetResolver } from '@aikami/types';

/** Bind nested map image paths to published tags, retaining resolver ownership. */
export const createWalkSandboxAssetBindings = ({
  resolver,
}: {
  resolver: AssetResolver;
}): Pick<GameWorldOptions, 'assetUrlResolver' | 'resolveTag' | 'releaseUrl'> => ({
  assetUrlResolver: (_slot, assetId, _state) => resolver.resolve(assetId),
  resolveTag: (filePath) => {
    const relative = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    const normalized = relative.startsWith('game-data/')
      ? relative.slice('game-data/'.length)
      : relative;
    return resolver.resolve(pathToTag(normalized));
  },
  releaseUrl: (url) => resolver.release(url),
});
