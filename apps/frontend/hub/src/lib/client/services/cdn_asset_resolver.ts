// apps/frontend/hub/src/lib/client/services/cdn_asset_resolver.ts
//
// Stateless CDN AssetResolver for the hub.
//
// Built once per page from the entries the server load function already
// fetched — never fetches on its own. Resolution is a synchronous string
// concatenation (O(1) after an O(n) entry-map build once per page).
//
// The hub resolver must never receive an R2 write credential — it only
// builds public GET URLs (invariant I-7).

import { r2AssetUrl } from '@aikami/constants';
import type { CatalogAssetEntry } from '@aikami/schemas';
import type { AssetResolver } from '@aikami/types';
import { logger } from '$logger';

/**
 * Creates a stateless CDN-backed AssetResolver for the hub.
 *
 * @param options.originUrl - Base URL of the CDN origin (trailing slash optional).
 * @param options.entries - Catalog index entries to build the tag→URL map from.
 * @returns An AssetResolver with kind 'cdn'.
 */
export const createCdnAssetResolver = (options: {
  originUrl: string;
  entries: readonly CatalogAssetEntry[];
}): AssetResolver => {
  const { originUrl, entries } = options;

  const tagMap = new Map<string, CatalogAssetEntry>();
  for (const entry of entries) {
    tagMap.set(entry.tag, entry);
  }

  logger.debug('cdnResolver:created', { entryCount: entries.length });

  const resolve = (tag: string): string | null => {
    const entry = tagMap.get(tag);
    if (!entry) {
      logger.debug('cdnResolver:miss', { tag });
      return null;
    }
    const url = r2AssetUrl({ baseUrl: originUrl, hash: entry.hash, ext: entry.ext });
    logger.debug('cdnResolver:resolve', { tag, url });
    return url;
  };

  const release = (_url: string): void => {
    // No-op — the hub resolver holds no refcounts or blob URLs.
  };

  return {
    resolve,
    release,
    kind: 'cdn' as const,
  };
};
