// apps/frontend/hub/src/lib/client/services/cdn_asset_resolver.ts
//
// Stateless CDN asset resolver (C-444). Built once per page from the entries
// the server load function already fetched — never fetches on its own.
//
// Resolution strategy:
//   - Looks up the tag in the provided entries map.
//   - Returns a content-addressed CDN URL: `${originUrl}/assets/${hash[0..2]}/${hash}${ext}`
//   - `release` is a no-op — no refcounts, no blob URLs.
//   - Returns `null` for unknown tags (never throws).

import type { CatalogAssetEntry } from '@aikami/schemas';
import type { AssetResolver } from '@aikami/types';

/** Strip trailing slashes from a base URL. */
const stripTrailingSlash = (baseUrl: string): string => baseUrl.replace(/\/+$/, '');

/**
 * Build a content-addressed CDN URL for a catalog entry.
 */
const assetUrl = (originUrl: string, entry: CatalogAssetEntry): string =>
  `${stripTrailingSlash(originUrl)}/assets/${entry.hash.slice(0, 2)}/${entry.hash}${entry.ext}`;

/**
 * Create a stateless CDN resolver from server-fetched entries.
 *
 * @param options.originUrl - CDN origin base URL.
 * @param options.entries - Catalog entries to resolve against (already fetched by the server load).
 * @returns An AssetResolver that resolves tags to CDN URLs.
 */
export const createCdnAssetResolver = (options: {
  originUrl: string;
  entries: readonly CatalogAssetEntry[];
}): AssetResolver => {
  const { originUrl, entries } = options;

  /** Build a tag → entry lookup once. */
  const entryByTag = new Map<string, CatalogAssetEntry>();
  for (const entry of entries) {
    entryByTag.set(entry.tag, entry);
  }

  return {
    kind: 'cdn' as const,

    resolve: (tag: string): string | null => {
      const entry = entryByTag.get(tag);
      if (!entry) {
        return null;
      }
      return assetUrl(originUrl, entry);
    },

    release: (_url: string): void => {
      // No-op — CDN URLs are not refcounted.
    },
  };
};
