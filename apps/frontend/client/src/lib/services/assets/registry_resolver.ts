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
import { assetPrefetchService } from './asset_prefetch_service.svelte.ts';
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
 * Waits until the tag resolver may be trusted: the catalog has loaded AND the
 * AssetManager has finished rehydrating the device cache.
 *
 * This is the HANDSHAKE every consumer of {@link createAssetTagResolver} must
 * pass through first, and it exists because `assetStore.resolveUrl` is
 * synchronous and has an honest-looking but wrong answer during startup:
 *
 *   1. the catalog row may be present (restored from the device snapshot);
 *   2. `assetManager.acquireUrl` returns null until rehydration binds blobs;
 *   3. so the resolver falls through to `_originUrl(row)` — a NETWORK url.
 *
 * A content-pack load that starts inside that window therefore fetches the
 * publish origin for bytes the device already holds, and with no network it
 * aborts with `ContentPackLoader: failed to fetch manifest` even though the
 * cache was complete. Awaiting here removes the race instead of retrying it.
 *
 * Both halves are LOCAL work — the catalog load is cache-first on a warmed
 * device, and rehydration reads the OPFS / Tauri FS cache — so this adds no
 * cloud dependency to boot. The pipeline is memoized, so every caller shares
 * one attempt and repeat calls are free.
 */
export const awaitRegistryReady = async (): Promise<void> => {
  // The catalog first: rehydration is keyed on `assetStore.coreTags`, so it
  // needs the catalog, and a resolver with no rows resolves nothing.
  await assetStore.fetchManifest();
  try {
    // Opens the device database, seeds the registry and runs rehydration.
    await assetPrefetchService.ensureRegistryReady();
  } catch (error) {
    // Not fatal here: the boot pipeline treats registry init as a degradable
    // stage, and killing the caller would be a NEW failure mode. The pack load
    // reports the real problem if the cache truly is unusable.
    logger.warn('registryResolver:cache-not-ready', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Singleton registry-backed tag resolver. Created once and reused across
 * all loadContentPack and GameWorld calls.
 */
export const assetTagResolver: AssetTagResolver = createAssetTagResolver();
