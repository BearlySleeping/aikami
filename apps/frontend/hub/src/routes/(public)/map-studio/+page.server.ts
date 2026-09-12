// apps/frontend/hub/src/routes/(public)/map-studio/+page.server.ts
//
// Map studio page: supplies the catalog entries the client-side CDN resolver
// needs (tilesets + published maps), the pack terrain definitions/atlas for
// real corner16 preview, and the CDN origin.
//
// The route is client-only (ssr: false in the page) — this load only gathers
// data; manifest parsing, validation and rendering all happen in the browser
// through the engine's unified scene loader.

import type { CatalogAssetEntry, ContentPackTerrain } from '@aikami/schemas';
import { error } from '@sveltejs/kit';
import {
  CatalogIndexUnavailableError,
  getCategoryEntries,
} from '$lib/server/catalog/catalog_index.ts';
import type { MapStudioAtlasDescriptor, MapStudioPageData } from '$types';
import { resolveAssetUrl } from '$utils/catalog.ts';
import type { PageServerLoad } from './$types';

/**
 * Best-effort fetch of the Emberwatch pack manifest for terrain/atlas context.
 * A miss (no contentPacks shard, unreachable object) degrades to an empty
 * terrain list — the studio still opens with the sample/baked preview.
 */
const loadPackContext = async (): Promise<{
  terrains: readonly ContentPackTerrain[];
  atlas: MapStudioAtlasDescriptor | undefined;
}> => {
  try {
    const packs = await getCategoryEntries('contentPacks');
    const manifestEntry = packs?.entries.find((entry) => entry.tag.endsWith(':manifest'));
    if (!packs || !manifestEntry) {
      return { terrains: [], atlas: undefined };
    }
    const response = await fetch(resolveAssetUrl(packs.originUrl, manifestEntry));
    if (!response.ok) {
      return { terrains: [], atlas: undefined };
    }
    const manifest = (await response.json()) as {
      terrains?: unknown;
      atlas?: { textureUrl?: unknown; spritesheetUrl?: unknown };
    };
    const terrains = Array.isArray(manifest.terrains)
      ? (manifest.terrains as ContentPackTerrain[])
      : [];
    const textureUrl = manifest.atlas?.textureUrl;
    const spritesheetUrl = manifest.atlas?.spritesheetUrl;
    const atlas: MapStudioAtlasDescriptor | undefined =
      typeof textureUrl === 'string'
        ? {
            textureUrl,
            ...(typeof spritesheetUrl === 'string' ? { spritesheetUrl } : {}),
          }
        : undefined;
    return { terrains, atlas };
  } catch {
    return { terrains: [], atlas: undefined };
  }
};

/**
 * Load function for the map studio page.
 *
 * Tilesets are required (nothing renders without them); published maps and
 * pack terrain context are optional and degrade gracefully.
 *
 * @returns {MapStudioPageData} Tileset entries, map entries, terrain/atlas
 *   context and the CDN origin.
 * @throws {SvelteKitError} 503 when the tileset catalog index is unreachable.
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

  const packContext = await loadPackContext();

  setHeaders({ 'cache-control': 'public, max-age=60' });

  return {
    tilesetEntries: tilesetsData.entries,
    mapEntries,
    originUrl: tilesetsData.originUrl,
    terrains: packContext.terrains,
    atlas: packContext.atlas,
  } satisfies MapStudioPageData;
};
