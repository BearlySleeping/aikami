// apps/frontend/hub/src/lib/utils/catalog.ts
//
// Hub-local catalog display helpers (C-396). Client-safe — no server
// imports; these are pure functions over index data.
import { CATALOG_THUMBNAIL_EXT } from '@aikami/constants';
import type { CatalogAssetEntry } from '@aikami/schemas';

/** Normalise a base URL: strip trailing slashes once. */
const stripTrailingSlash = (baseUrl: string): string => baseUrl.replace(/\/+$/, '');

/**
 * Resolve the pipeline-generated single-frame thumbnail URL for an entry
 * (C-396 AC-5). Returns `undefined` when the entry predates the thumbnail
 * republish — the UI must render a placeholder, never the raw sheet.
 */
export const resolveThumbnailUrl = (
  originUrl: string,
  entry: CatalogAssetEntry,
): string | undefined => {
  const hash = entry.thumbnailHash;
  if (!hash) {
    return undefined;
  }
  return `${stripTrailingSlash(originUrl)}/thumbnails/${hash.slice(0, 2)}/${hash}${CATALOG_THUMBNAIL_EXT}`;
};

/** Resolve the raw content-addressed asset URL (downloads / credits links). */
export const resolveAssetUrl = (originUrl: string, entry: CatalogAssetEntry): string =>
  `${stripTrailingSlash(originUrl)}/assets/${entry.hash.slice(0, 2)}/${entry.hash}${entry.ext}`;

/** A readable display name for an asset entry, derived from its tag.
 *
 * Tags are colon-separated logical ids: `lpc:hat:magic:celestial_adult:thrust`
 * or `sprites:combat:enemy_portrait`. The category and subcategory prefixes
 * are stripped, the remainder is joined with a middle dot. Falls back to the
 * raw tag when nothing can be stripped.
 */
export const assetDisplayName = (entry: CatalogAssetEntry): string => {
  const tag = entry.tag;
  const categoryPrefix = entry.category ? `${entry.category}:` : '';
  const subcategoryPrefix = entry.subcategory ? `${entry.subcategory.split('/').join(':')}:` : '';

  let rest = tag.startsWith(categoryPrefix) ? tag.slice(categoryPrefix.length) : tag;
  if (rest.startsWith(subcategoryPrefix)) {
    rest = rest.slice(subcategoryPrefix.length);
  }
  const remainder = rest.split(':').filter(Boolean).join(' · ');
  return remainder || tag;
};

/** License string that should be rendered as "Unknown" rather than hidden. */
export const isUnknownLicense = (license: string): boolean =>
  license.trim().toLowerCase() === 'unknown';

/** True when the entry has no usable license information. */
export const hasNoLicense = (entry: CatalogAssetEntry): boolean =>
  entry.licenses.length === 0 || entry.licenses.every((license) => isUnknownLicense(license));

/** Human-readable byte size, e.g. "4.8 KB". */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index++) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
};

/**
 * Client-side filter over a loaded category shard (C-396 In Scope: "client
 * —side filter/search within a loaded shard"). Matches the display name, tag,
 * subcategory, authors and licenses. Never queries the server (server-side
 * search across the whole catalog is out of scope).
 */
export const matchesCatalogQuery = (entry: CatalogAssetEntry, query: string): boolean => {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  const haystack = [
    entry.tag,
    entry.subcategory ?? '',
    assetDisplayName(entry),
    ...entry.authors,
    ...entry.licenses,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
};
