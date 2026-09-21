// apps/frontend/hub/src/routes/(public)/lpc-preview/[tag]/+page.server.ts
//
// LPC preview asset: validates the requested LPC tag against the catalog and
// returns every LPC entry (resolver + slot catalog) plus the selected entry,
// so the client opens with that component already applied.
//
// Client-only (ssr: false): PixiJS must never enter the Worker bundle.

import { error } from '@sveltejs/kit';
import {
  CatalogIndexUnavailableError,
  getCategoryEntries,
} from '$lib/server/catalog/catalog_index.ts';
import type { LpcPreviewPageData } from '$types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, setHeaders, depends }) => {
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

  const entry = categoryData.entries.find((candidate) => candidate.tag === params.tag);
  if (!entry) {
    error(404, `LPC asset "${params.tag}" was not found.`);
  }

  setHeaders({ 'cache-control': 'public, max-age=60' });

  return {
    entry,
    lpcEntries: categoryData.entries,
    originUrl: categoryData.originUrl,
  } satisfies LpcPreviewPageData;
};
