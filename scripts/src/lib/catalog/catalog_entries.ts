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
// C-433: widened to support multiple scan roots (game-data + content-packs).
// The isCatalogAssetPath exclusion for maps/ and sprites/tilesets/ has been
// removed — these are now first-class catalog categories.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AssetHashesFile, AssetManifest } from '@aikami/types';
import { CONTENT_PACKS_DIR, GAME_DATA_DIR } from './config.ts';

/** One catalog asset — the union of manifest + hash + credit. */
export type CatalogEntry = {
  tag: string;
  hash: string;
  sizeBytes: number;
  category: string;
  subcategory?: string;
  ext: string;
  path: string;
  /** Scan root directory for resolving the local file path (C-433 multi-root). */
  rootDir: string;
  licenses: readonly string[];
  authors: readonly string[];
  sourceUrls: readonly string[];
  licenseNote?: string;
  /** sha256 of the generated single-frame preview (C-396 AC-5). */
  thumbnailHash?: string;
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
 * Load the catalog entry list from the scan outputs.
 * Supports multiple scan roots (C-433): reads manifest/hashes/credits from
 * each root and merges the entries. The game-data root is always loaded;
 * content-packs root is loaded when its manifest exists.
 *
 * @param options.gameDataDir - Override for tests (game-data root).
 * @param options.contentPacksDir - Override for tests (content-packs root).
 */
export const loadCatalogEntries = (options?: {
  gameDataDir?: string;
  contentPacksDir?: string;
}): CatalogEntry[] => {
  const gameDataDir = options?.gameDataDir ?? GAME_DATA_DIR;
  const contentPacksDir = options?.contentPacksDir ?? CONTENT_PACKS_DIR;

  const entries: CatalogEntry[] = [];

  // Load from game-data root.
  const loadFromRoot = (rootDir: string, rootLabel: string): void => {
    let manifest: AssetManifest;
    try {
      manifest = readJson<AssetManifest>(
        join(rootDir, 'manifest.json'),
        `${rootLabel} manifest.json`,
      );
    } catch (error) {
      // Only skip content-packs root when manifest is missing (before first scan).
      // Rethrow all game-data manifest errors and non-missing-manifest failures.
      if (rootLabel === 'game-data') {
        throw error;
      }
      const isMissingFile =
        error instanceof Error &&
        (error.message.includes('ENOENT') || error.message.includes('no such file'));
      if (!isMissingFile) {
        throw error;
      }
      return;
    }
    const hashes = readJson<AssetHashesFile>(
      join(rootDir, 'asset_hashes.json'),
      `${rootLabel} asset_hashes.json`,
    );
    const credits = readJson<AssetCreditsFile>(
      join(rootDir, 'asset_credits.json'),
      `${rootLabel} asset_credits.json`,
    );

    for (const asset of Object.values(manifest.assets)) {
      const hashEntry = hashes.hashes[asset.tag];
      if (!hashEntry) {
        throw new Error(
          `Catalog entry ${asset.tag} has no hash in ${rootLabel} asset_hashes.json — run scan_assets first`,
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
        rootDir,
        licenses: credit.licenses ?? [],
        authors: credit.authors ?? [],
        sourceUrls: credit.sourceUrls ?? [],
        licenseNote: credit.licenseNote,
      });
    }
  };

  loadFromRoot(gameDataDir, 'game-data');
  loadFromRoot(contentPacksDir, 'content-packs');

  entries.sort((a, b) => a.tag.localeCompare(b.tag));
  return entries;
};
