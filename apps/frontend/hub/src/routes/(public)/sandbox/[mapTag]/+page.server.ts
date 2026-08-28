// apps/frontend/hub/src/routes/(public)/sandbox/[mapTag]/+page.server.ts
//
// Walk sandbox page (C-447): validates the map tag against the catalog index
// and 404s on miss. Fetches the maps shard and the tilesets shard so the
// client-side CDN resolver can resolve tileset references.
//
// This route is client-only (ssr: false in the page) — the load function
// only validates the tag and provides data; rendering is entirely client-side.

import type { CatalogAssetEntry } from '@aikami/schemas';
import { error } from '@sveltejs/kit';
import {
  CatalogIndexUnavailableError,
  getCategoryEntries,
} from '$lib/server/catalog/catalog_index.ts';
import type { SandboxPageData } from '$types';
import type { PageServerLoad } from './$types';

/**
 * Load function for the walk sandbox page.
 *
 * Validates the map tag against the catalog index and fetches the tilesets
 * shard so the client-side resolver can resolve tileset references.
 *
 * @returns {SandboxPageData} Page data with entry, tileset entries, originUrl.
 * @throws {SvelteKitError} 503 when the catalog index is unreachable.
 * @throws {SvelteKitError} 404 when the map tag is not found.
 */
export const load: PageServerLoad = async ({ params, setHeaders, depends }) => {
  depends('catalog:sandbox');

  // Fetch the maps category shard
  let categoryData: Awaited<ReturnType<typeof getCategoryEntries>>;
  try {
    categoryData = await getCategoryEntries('maps');
  } catch (cause) {
    if (cause instanceof CatalogIndexUnavailableError) {
      throw error(503, 'The catalog index is unavailable. Please try again in a moment.');
    }
    throw cause;
  }
  if (!categoryData) {
    error(404, 'No maps found in the catalog.');
  }

  // Find the requested map tag
  const entry = categoryData.entries.find((candidate) => candidate.tag === params.mapTag);
  if (!entry) {
    error(404, `Map "${params.mapTag}" was not found.`);
  }

  // Fetch tilesets shard so the resolver can resolve tileset references
  // Use the same originUrl as the maps category to ensure consistency
  let tilesetEntries: readonly CatalogAssetEntry[] = [];
  try {
    const tilesetsData = await getCategoryEntries('tilesets');
    if (tilesetsData) {
      // Verify that the tilesets origin matches the maps origin
      if (tilesetsData.originUrl !== categoryData.originUrl) {
        // Origins differ — this is unexpected but we log and continue with the map's origin
        // biome-ignore lint/suspicious/noConsole: intentional diagnostic warning, no logger wired into this loader
        console.warn(
          `Tileset origin (${tilesetsData.originUrl}) differs from map origin (${categoryData.originUrl})`,
        );
      }
      tilesetEntries = tilesetsData.entries;
    }
  } catch {
    // Tilesets shard is optional — if it fails, the map may show missing
    // tiles but the sandbox still renders.
  }

  setHeaders({ 'cache-control': 'public, max-age=60' });

  return {
    entry,
    tilesetEntries,
    originUrl: categoryData.originUrl,
  } satisfies SandboxPageData;
};
