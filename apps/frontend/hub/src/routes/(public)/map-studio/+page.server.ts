// apps/frontend/hub/src/routes/(public)/map-studio/+page.server.ts
//
// Map studio page: supplies the catalog entries the client-side CDN resolver
// needs (tilesets + published maps) and the CDN origin.
//
// The route is client-only (ssr: false in the page) — this load only gathers
// data; manifest parsing, validation and rendering all happen in the browser
// through the engine's unified scene loader.

import type { CatalogAssetEntry } from '@aikami/schemas';
import { error } from '@sveltejs/kit';
import {
  CatalogIndexUnavailableError,
  getCategoryEntries,
} from '$lib/server/catalog/catalog_index.ts';
import type { MapStudioPageData } from '$types';
import type { PageServerLoad } from './$types';

/**
 * Load function for the map studio page.
 *
 * Tilesets are required (nothing renders without them); published maps are
 * optional starting points, so a missing maps shard degrades to an empty
 * picker rather than failing the page.
 *
 * @returns {MapStudioPageData} Tileset entries, map entries and the CDN origin.
 * @throws {SvelteKitError} 503 when the catalog index is unreachable.
 */
export const load: PageServerLoad = async ({ setHeaders, depends }) => {
  depends('catalog:map-studio');

  let tilesetsData: Awaited<ReturnType<typeof getCategoryEntries>>;
  try {
    tilesetsData = await getCategoryEntries('tilesets');
  } catch (cause) {
    if (cause instanceof CatalogIndexUnavailableError) {
      throw error(503, 'The catalog index is unavailable. Please try again in a moment.');
    }
    throw cause;
  }
  if (!tilesetsData) {
    throw error(503, 'The tileset catalog is unavailable. Please try again in a moment.');
  }

  let mapEntries: readonly CatalogAssetEntry[] = [];
  try {
    const mapsData = await getCategoryEntries('maps');
    if (mapsData) {
      mapEntries = mapsData.entries;
    }
  } catch {
    // Maps shard is optional — the studio still opens with the sample
    // manifest and any pasted/uploaded text.
  }

  setHeaders({ 'cache-control': 'public, max-age=60' });

  return {
    tilesetEntries: tilesetsData.entries,
    mapEntries,
    originUrl: tilesetsData.originUrl,
  } satisfies MapStudioPageData;
};
