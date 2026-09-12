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

import { tagToAssetPath } from '@aikami/constants';
import type { CatalogAssetEntry } from '@aikami/schemas';
import type { AssetResolver } from '@aikami/types';

/** Strip trailing slashes from a base URL. */
const stripTrailingSlash = (baseUrl: string): string => baseUrl.replace(/\/+$/, '');

/**
 * Normalizes a game-data-relative image reference for path lookup.
 *
 * Manifests (Tiled JSON / JTON) reference tileset images by their
 * game-data-relative path (e.g. `/game-data/sprites/tilesets/atlas.webp`),
 * while catalog entries are keyed by tag. This normalizes leading slashes
 * and the optional `game-data/` prefix so a path can be matched against
 * `tagToAssetPath` output.
 */
export const normalizeGameDataPath = (path: string): string => {
  let normalized = path.replace(/^\/+/, '');
  if (normalized === 'game-data/') {
    return '';
  }
  normalized = normalized.replace(/^game-data\//, '');
  return normalized;
};

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
 * @param options.resolveGameDataPaths - When true, `resolve` also accepts
 *   game-data-relative paths (e.g. `/game-data/sprites/tilesets/atlas.webp`)
 *   by matching them against each entry's `tagToAssetPath` derivation. Tag
 *   lookups keep priority. Default false preserves the original behavior.
 * @returns An AssetResolver that resolves tags to CDN URLs.
 */
export const createCdnAssetResolver = (options: {
  originUrl: string;
  entries: readonly CatalogAssetEntry[];
  resolveGameDataPaths?: boolean;
}): AssetResolver => {
  const { originUrl, entries } = options;

  /** Build a tag → entry lookup once. */
  const entryByTag = new Map<string, CatalogAssetEntry>();
  for (const entry of entries) {
    entryByTag.set(entry.tag, entry);
  }

  /** Build a game-data path → entry lookup once (optional). */
  const entryByPath = new Map<string, CatalogAssetEntry>();
  if (options.resolveGameDataPaths) {
    for (const entry of entries) {
      entryByPath.set(tagToAssetPath({ tag: entry.tag, ext: entry.ext }), entry);
    }
  }

  return {
    kind: 'cdn' as const,

    resolve: (tag: string): string | null => {
      const entry = entryByTag.get(tag) ?? entryByPath.get(normalizeGameDataPath(tag));
      if (!entry) {
        return null;
      }
      return assetUrl(originUrl, entry);
    },

    resolveLicenses: (tag: string): readonly string[] | undefined => entryByTag.get(tag)?.licenses,

    release: (_url: string): void => {
      // No-op — CDN URLs are not refcounted.
    },
  };
};
