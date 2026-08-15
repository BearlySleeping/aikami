// scripts/src/lib/catalog/catalog_entries.ts
//
// Loads the catalog entry list from the scan outputs (C-395 AC-1/AC-2/AC-4):
//
//   manifest.json       → tags, categories, subcategories, paths, extensions
//   asset_hashes.json   → tag → sha256 + sizeBytes (C-373 sidecar)
//   asset_credits.json  → tag → licenses/authors/sourceUrls (C-395 sidecar,
//                         merged from lpc_credits.json + supplement +
//                         project_licenses.json by scan_assets.ts)
//
// The catalog publishes exactly what scan_assets emits (music/sfx/ambient/
// sprites/backgrounds/lpc); `maps/` and `sprites/tilesets/` are dev-only
// sandbox files and stay out (contract Edge Cases) — this exclusion lives
// here, NOT in scan_assets (changing scan_assets would alter the client's
// boot manifest, which this contract must not do).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AssetHashesFile, AssetManifest } from '@aikami/types';
import { GAME_DATA_DIR } from './config.ts';
import { isCatalogAssetPath } from './preflight.ts';

/** One catalog asset — the union of manifest + hash + credit. */
export type CatalogEntry = {
  tag: string;
  hash: string;
  sizeBytes: number;
  category: string;
  subcategory?: string;
  ext: string;
  path: string;
  licenses: readonly string[];
  authors: readonly string[];
  sourceUrls: readonly string[];
  licenseNote?: string;
};

/** Merged attribution shape from asset_credits.json. */
type AssetCreditsFile = {
  credits: Record<
    string,
    {
      licenses?: string[];
      authors?: string[];
      sourceUrls?: string[];
      licenseNote?: string;
      source?: string;
    }
  >;
};

/** Parse a JSON file; throws with a readable message when missing/broken. */
const readJson = <T>(filePath: string, label: string): T => {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read ${label} at ${filePath}: ${message}`);
  }
};

/**
 * Load the catalog entry list from the scan outputs in game-data.
 *
 * @param options.gameDataDir - Override for tests.
 */
export const loadCatalogEntries = (options?: { gameDataDir?: string }): CatalogEntry[] => {
  const gameDataDir = options?.gameDataDir ?? GAME_DATA_DIR;

  const manifest = readJson<AssetManifest>(join(gameDataDir, 'manifest.json'), 'manifest.json');
  const hashes = readJson<AssetHashesFile>(
    join(gameDataDir, 'asset_hashes.json'),
    'asset_hashes.json',
  );
  const credits = readJson<AssetCreditsFile>(
    join(gameDataDir, 'asset_credits.json'),
    'asset_credits.json',
  );

  const entries: CatalogEntry[] = [];
  for (const asset of Object.values(manifest.assets)) {
    if (!isCatalogAssetPath(asset.path)) {
      continue;
    }
    const hashEntry = hashes.hashes[asset.tag];
    if (!hashEntry) {
      throw new Error(
        `Catalog entry ${asset.tag} has no hash in asset_hashes.json — run scan_assets first`,
      );
    }
    const credit = credits.credits[asset.tag] ?? {};
    entries.push({
      tag: asset.tag,
      hash: hashEntry.hash,
      sizeBytes: hashEntry.sizeBytes,
      category: asset.category,
      subcategory: asset.subcategory || undefined,
      ext: asset.ext,
      path: asset.path,
      licenses: credit.licenses ?? [],
      authors: credit.authors ?? [],
      sourceUrls: credit.sourceUrls ?? [],
      licenseNote: credit.licenseNote,
    });
  }

  entries.sort((a, b) => a.tag.localeCompare(b.tag));
  return entries;
};
