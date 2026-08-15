// apps/frontend/hub/src/routes/(public)/+page.server.ts
//
// Catalog landing (C-396 AC-1/AC-2): category summaries ONLY, never the full
// asset list. C-395's root index emits one `{ id, count }` row PER SHARD, and
// a large category (LPC) is split into several shards — this load groups rows
// by category: `id` is the six-value category id, `count` is the SUM of that
// category's shard counts, and `label` comes from the hub-local constant map.
//
// Degraded mode: when the static index is unreachable the page returns an
// explicit error state (never a 500, never a blank list).

import { catalogCategoryLabel } from '$lib/constants/catalog_labels.ts';
import { CatalogIndexUnavailableError, fetchRootIndex } from '$lib/server/catalog/catalog_index.ts';
import type { CatalogLandingPageData } from '$types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ setHeaders, depends }) => {
  depends('catalog:root');
  setHeaders({ 'cache-control': 'public, max-age=60' });

  try {
    const root = await fetchRootIndex();

    const countByCategory = new Map<string, number>();
    for (const row of root.categories) {
      // Split-shard ids look like `lpc__hat-magic`; the category is the part
      // before the first `__`. Single-shard categories match exactly.
      const categoryId = row.id.split('__')[0];
      countByCategory.set(categoryId, (countByCategory.get(categoryId) ?? 0) + row.count);
    }

    const categories = [...countByCategory.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, count]) => ({ id, label: catalogCategoryLabel(id), count }));

    return {
      status: 'ready',
      categories,
      publishedAt: root.publishedAt,
    } satisfies CatalogLandingPageData;
  } catch (cause) {
    if (cause instanceof CatalogIndexUnavailableError) {
      return {
        status: 'error',
        message: cause.message,
      } satisfies CatalogLandingPageData;
    }
    throw cause;
  }
};
