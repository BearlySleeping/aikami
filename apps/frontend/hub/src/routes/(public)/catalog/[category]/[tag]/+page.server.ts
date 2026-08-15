// apps/frontend/hub/src/routes/(public)/catalog/[category]/[tag]/+page.server.ts
//
// Asset detail page (C-396 AC-3): preview, license, attribution.
//
// Only the single requested entry is shipped to the client — the shard is
// fetched server-side and the one matching entry selected. Preview URLs come
// from the pipeline-generated thumbnail (`thumbnailHash`); entries that
// predate the thumbnail republish get `previewUrl: undefined` and the view
// says the preview is unavailable (never the raw multi-frame sheet).
import { error } from '@sveltejs/kit';
import { catalogCategoryLabel } from '$lib/constants/catalog_labels.ts';
import { loadPackStats } from '$lib/server/api/catalog_stats.ts';
import {
  CatalogIndexUnavailableError,
  getAssetEntry,
  resolveThumbnailUrl,
} from '$lib/server/catalog/catalog_index.ts';
import type { CatalogAssetPageData } from '$types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, setHeaders, depends }) => {
  depends('catalog:pack');

  let found: Awaited<ReturnType<typeof getAssetEntry>>;
  try {
    found = await getAssetEntry(params.category, params.tag);
  } catch (cause) {
    if (cause instanceof CatalogIndexUnavailableError) {
      // Index outage → an explicit 503 with a fixed user-facing message,
      // never a 500 and never internal URL details (Quality Requirements:
      // "Neither is a 500").
      throw error(503, {
        message: 'The catalog index is unavailable. Please try again in a moment.',
      });
    }
    throw cause;
  }
  if (!found) {
    error(404, {
      message: `Asset "${params.tag}" was not found in category "${params.category}".`,
    });
  }

  setHeaders({ 'cache-control': 'public, max-age=60' });

  return {
    category: params.category,
    categoryLabel: catalogCategoryLabel(params.category),
    entry: found.entry,
    previewUrl: resolveThumbnailUrl(found.originUrl, found.entry),
    stats: loadPackStats().catch(() => null),
  } satisfies CatalogAssetPageData;
};
