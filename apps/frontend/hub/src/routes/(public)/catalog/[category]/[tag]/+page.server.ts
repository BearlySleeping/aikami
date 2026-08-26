// apps/frontend/hub/src/routes/(public)/catalog/[category]/[tag]/+page.server.ts
//
// Asset detail page (C-396 AC-3): preview, license, attribution.
//
// Fetches the full category shard server-side, selects the one matching entry,
// and passes the full entries list to the client so the preview resolver can
// resolve tags without a second index fetch (C-446).
//
// For map and pack detail pages, also fetches the tilesets shard (C-446 AC-4):
// maps reference tilesets by tag, and the tileset entries are typically in a
// different shard. This is the one narrow exception to the "only this category's
// shards" rule.
//
// Preview URLs come from the pipeline-generated thumbnail (`thumbnailHash`);
// entries that predate the thumbnail republish get `previewUrl: undefined`
// and the view says the preview is unavailable (never the raw multi-frame sheet).
import { error } from '@sveltejs/kit';
import { catalogCategoryLabel } from '$lib/constants/catalog_labels.ts';
import { loadPackStats } from '$lib/server/api/catalog_stats.ts';
import {
  CatalogIndexUnavailableError,
  getCategoryEntries,
  resolveThumbnailUrl,
} from '$lib/server/catalog/catalog_index.ts';
import type { CatalogAssetPageData } from '$types';
import type { PageServerLoad } from './$types';

/** Categories whose detail pages need the tilesets shard for preview resolution. */
const CATEGORIES_NEEDING_TILESETS = new Set(['maps', 'contentPacks']);

export const load: PageServerLoad = async ({ params, setHeaders, depends }) => {
  depends('catalog:pack');

  let categoryData: Awaited<ReturnType<typeof getCategoryEntries>>;
  try {
    categoryData = await getCategoryEntries(params.category);
  } catch (cause) {
    if (cause instanceof CatalogIndexUnavailableError) {
      // Index outage → an explicit 503 with a fixed user-facing message,
      // never a 500 and never internal URL details (Quality Requirements:
      // "Neither is a 500").
      throw error(503, 'The catalog index is unavailable. Please try again in a moment.');
    }
    throw cause;
  }
  if (!categoryData) {
    error(404, `Category "${params.category}" was not found.`);
  }

  const found = categoryData.entries.find((candidate) => candidate.tag === params.tag);
  if (!found) {
    error(404, `Asset "${params.tag}" was not found in category "${params.category}".`);
  }

  // C-446 AC-4: For map and pack pages, also fetch the tilesets shard so the
  // map preview can resolve tileset references. This is the one documented
  // exception to the "only this category's shards" rule.
  let allEntries = [...categoryData.entries];
  if (CATEGORIES_NEEDING_TILESETS.has(params.category)) {
    try {
      const tilesetsData = await getCategoryEntries('tilesets');
      if (tilesetsData) {
        allEntries = [...allEntries, ...tilesetsData.entries];
      }
    } catch {
      // Tilesets shard is optional for map/pack previews — if it fails,
      // the preview may show missing tiles but the page still renders.
    }
  }

  setHeaders({ 'cache-control': 'public, max-age=60' });

  return {
    category: params.category,
    categoryLabel: catalogCategoryLabel(params.category),
    entry: found,
    entries: allEntries,
    originUrl: categoryData.originUrl,
    previewUrl: resolveThumbnailUrl(categoryData.originUrl, found),
    stats: loadPackStats().catch(() => null),
  } satisfies CatalogAssetPageData;
};
