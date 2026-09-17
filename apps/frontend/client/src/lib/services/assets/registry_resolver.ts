// apps/frontend/client/src/lib/services/assets/registry_resolver.ts
//
// Registry-backed asset tag resolver (C-434).
// Converts file paths to published tags via pathToTag, then resolves them
// through the AssetStore (cache → R2 → bundled static path).
//
// The engine stays library-pure — the client supplies the resolver at the
// composition root, exactly as it already supplies assetUrlResolver and
// propFrameResolver to GameWorld.

import type { AssetTagResolver } from '@aikami/frontend/engine/sim';
import { pathToTag } from '@aikami/frontend/engine/sim';
import { logger } from '$logger';
import { assetStore } from './asset_store.svelte.ts';

/**
 * Creates an AssetTagResolver that resolves file paths through the asset
 * registry (AssetStore → AssetManager).
 *
 * The resolver converts the file path to a published tag via pathToTag,
 * then resolves it through assetStore.resolveUrl. When the tag is unknown
 * or the registry is unavailable, it returns null so the caller falls back
 * to the bundled static path.
 *
 * @returns An AssetTagResolver function.
 */
export const createAssetTagResolver = (): AssetTagResolver => {
  return (filePath: string): string | null => {
    try {
      // Strip leading slash so absolute paths like "/content-packs/..."
      // produce the same tag as their relative counterpart (no leading colon).
      const withoutLeadingSlash = filePath.startsWith('/') ? filePath.slice(1) : filePath;
      // "game-data/" is a URL-only root alias, not a real path segment —
      // scan_assets.ts tags game-data-rooted assets relative to that
      // directory (no "game-data:" prefix), so it must be stripped here too
      // or every game-data asset's tag would carry a segment the catalog
      // never produced.
      const normalized = withoutLeadingSlash.startsWith('game-data/')
        ? withoutLeadingSlash.slice('game-data/'.length)
        : withoutLeadingSlash;
      // Convert the file path to a published tag (e.g. "maps/sandbox.json"
      // → "maps:sandbox").
      const tag = pathToTag(normalized);

      // Resolve through the asset store — cache blob URL, origin URL, or null.
      const resolved = assetStore.resolveUrl(tag);

      if (resolved) {
        logger.debug('registryResolver:resolved', { filePath, tag, resolved });
        return resolved;
      }

      logger.debug('registryResolver:unresolved', { filePath, tag });
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('registryResolver:error', { filePath, message });
      return null;
    }
  };
};

/**
 * Waits until the boot-seed manifest has loaded.
 *
 * Call this before the first resolution on any route that builds a world.
 * `assetStore.resolveUrl` is synchronous and reads the manifest, so a route that
 * resolves tags before the catalog has landed gets `null` for every tag and
 * silently falls back to a bundled static path — which a de-bundled client
 * (C-435) does not ship, so the route dies on a 404 instead of rendering.
 *
 * Living here rather than at each call site means the precondition sits with
 * the resolver that depends on it, and every consumer gets it for free. The
 * underlying fetch is memoized, so repeat calls are cheap.
 */
export const awaitRegistryReady = async (): Promise<void> => {
  await assetStore.fetchManifest();
};

/**
 * Singleton registry-backed tag resolver. Created once and reused across
 * all loadContentPack and GameWorld calls.
 */
export const assetTagResolver: AssetTagResolver = createAssetTagResolver();
