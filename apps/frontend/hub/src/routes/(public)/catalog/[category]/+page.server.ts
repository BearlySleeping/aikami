// apps/frontend/hub/src/routes/(public)/catalog/[category]/+page.server.ts
//
// One category's browse page (C-396 AC-2): merged from every C-395 shard
// whose id equals the category or starts with `<category>__`.
//
// I-8 enforcement: this load NEVER touches Postgres in its awaited part.
// The only DB-backed value is `stats`, a streamed promise resolved AFTER
// first paint — and its `.catch(() => null)` is mandatory, so a database
// outage degrades to "no stats", never a broken streamed response.
import { error } from '@sveltejs/kit';
import { catalogCategoryLabel } from '$lib/constants/catalog_labels.ts';
import { loadPackStats } from '$lib/server/api/catalog_stats.ts';
import {
  CatalogIndexUnavailableError,
  getCategoryEntries,
} from '$lib/server/catalog/catalog_index.ts';
import type { CatalogCategoryPageData } from '$types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, setHeaders, depends }) => {
  depends('catalog:pack');

  // Awaited: the static index. Fast, CDN-cached, and the page is
  // meaningless without it. Fetches the root index (to discover split-shard
  // ids) plus ONLY this category's shards — never another category's shards,
  // never the 7 MB client manifest.
  let categoryData: Awaited<ReturnType<typeof getCategoryEntries>>;
  try {
    categoryData = await getCategoryEntries(params.category);
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
  if (!categoryData) {
    error(404, { message: `Category "${params.category}" was not found in the catalog.` });
  }

  // setHeaders MUST be called before returning the streamed promise — once
  // streaming starts the headers are already sent (C-396 AC-4 watch point).
  setHeaders({ 'cache-control': 'public, max-age=60' });

  return {
    category: params.category,
    categoryLabel: catalogCategoryLabel(params.category),
    totalCount: categoryData.entries.length,
    originUrl: categoryData.originUrl,
    entries: categoryData.entries,
    // NOT awaited — streams in after first paint (I-8). The .catch() is
    // mandatory: an unhandled rejection in a streamed promise breaks the
    // response after headers are sent.
    stats: loadPackStats().catch(() => null),
  } satisfies CatalogCategoryPageData;
};
