// apps/frontend/hub/src/routes/(public)/lpc-preview/+page.server.ts
//
// LPC preview index: loads the LPC catalog entries the client-side resolver
// and slot catalog are built from. No specific asset is preselected — the
// preview boots a default character.
//
// Client-only (ssr: false): PixiJS must never enter the Worker bundle.

import { error } from '@sveltejs/kit';
import {
  CatalogIndexUnavailableError,
  getCategoryEntries,
} from '$lib/server/catalog/catalog_index.ts';
import type { LpcPreviewPageData } from '$types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ setHeaders, depends }) => {
  depends('catalog:lpc-preview');

  let categoryData: Awaited<ReturnType<typeof getCategoryEntries>>;
  try {
    categoryData = await getCategoryEntries('lpc');
  } catch (cause) {
    if (cause instanceof CatalogIndexUnavailableError) {
      throw error(503, 'The catalog index is unavailable. Please try again in a moment.');
    }
    throw cause;
  }
  if (!categoryData) {
    error(404, 'No LPC assets were found in the catalog.');
  }

  setHeaders({ 'cache-control': 'public, max-age=60' });

  return {
    entry: undefined,
    lpcEntries: categoryData.entries,
    originUrl: categoryData.originUrl,
  } satisfies LpcPreviewPageData;
};
