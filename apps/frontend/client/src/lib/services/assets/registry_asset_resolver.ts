// apps/frontend/client/src/lib/services/assets/registry_asset_resolver.ts
//
// Client registry-backed AssetResolver implementation.
//
// Wraps the existing assetStore.resolveUrl / assetManager.releaseUrl as an
// AssetResolver so the LPC renderer, map loader, and content-pack loader
// can accept it through the shared interface.
//
// This is a shape adapter — it does NOT add a second layer of caching on top
// of the asset store. The asset store already owns the acquire/warm/fallback
// ordering (cached blob URL synchronously → origin URL + background warm →
// null for unknown tags).

import type { AssetResolver } from '@aikami/types';
import { logger } from '$logger';
import { assetManager } from './asset_manager.svelte.ts';
import { assetStore } from './asset_store.svelte.ts';

/**
 * Creates a client registry-backed AssetResolver.
 *
 * The resolver preserves the existing acquire/warm/fallback ordering:
 * - Known tag with cached blob URL → returns blob URL synchronously
 * - Known tag without cached blob URL → returns origin URL, background warm
 * - Unknown tag → returns null
 *
 * @returns An AssetResolver with kind 'registry'.
 */
export const createRegistryAssetResolver = (): AssetResolver => {
  const resolve = (tag: string): string | null => {
    const url = assetStore.resolveUrl(tag);
    if (url) {
      logger.debug('registryResolver:resolve', { tag, url });
    } else {
      logger.debug('registryResolver:miss', { tag });
    }
    return url;
  };

  const release = (url: string): void => {
    assetManager.releaseUrl(url);
  };

  logger.debug('registryResolver:created');

  return {
    resolve,
    release,
    kind: 'registry' as const,
  };
};
