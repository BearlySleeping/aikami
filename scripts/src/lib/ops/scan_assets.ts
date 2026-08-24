// scripts/src/lib/ops/scan_assets.ts
//
// CLI entry point: scans static/game-data/ and static/content-packs/,
// generates manifest.json + asset_hashes.json + asset_credits.json
// for each root, and ensures the default directory structure exists.
//
// C-433: widened to multiple scan roots (game-data + content-packs) and
// directory-based category assignment for tilesets (sprites/tilesets/ → tilesets).
//
// Usage: bun run scripts/src/lib/ops/scan_assets.ts
//
// Contract: C-243, C-433

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { ASSET_CATEGORIES, splitStateSegments } from '@aikami/constants';
import type { AssetEntry, AssetHashesFile, AssetManifest } from '@aikami/types';
import { CONTENT_PACKS_DIR, GAME_DATA_DIR } from '../catalog/config.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pathToTag = (relPath: string, options?: { includeExt?: boolean }): string => {
  if (options?.includeExt) {
    // Include the extension in the tag to disambiguate same-name files
    // with different extensions (e.g. tilesets atlas.webp vs atlas.json).
    const ext = relPath.match(/\.[^.]+$/)?.[0] ?? '';
    const withoutExt = relPath.slice(0, -ext.length);
    return `${withoutExt.replace(/\//g, ':')}${ext}`;
  }
  const withoutExt = relPath.replace(/\.[^.]+$/, '');
  return withoutExt.replace(/\//g, ':');
};

/**
 * Determine the asset category from a relative path.
 * Uses the first path segment by default, but overrides for special cases
 * like `sprites/tilesets/` which should map to the `tilesets` category
 * (C-433: directory-based category assignment).
 */
const categoryForPath = (relPath: string): string | undefined => {
  // Check for tilesets override: sprites/tilesets/ → tilesets
  if (relPath.startsWith('sprites/tilesets/')) {
    return 'tilesets';
  }
  const pathSegments = relPath.split('/');
  const categoryName = pathSegments[0];
  return ASSET_CATEGORIES[categoryName] ? categoryName : undefined;
};

const scanDir = async (
  scanRootDir: string,
  options?: { categoryOverride?: string },
): Promise<{
  manifest: AssetManifest;
  hashes: AssetHashesFile['hashes'];
}> => {
  const categoryOverride = options?.categoryOverride;
  const assets: AssetManifest['assets'] = {};
  const byCategory: AssetManifest['byCategory'] = {};
  // C-373: content-hash provenance — tag → { hash, sizeBytes } sidecar.
  const hashes: AssetHashesFile['hashes'] = {};

  for (const catName of Object.keys(ASSET_CATEGORIES)) {
    byCategory[catName] = [];
  }

  const walk = async (dirPath: string): Promise<void> => {
    let entryNames: string[];
    try {
      entryNames = await readdir(dirPath);
    } catch {
      return;
    }

    for (const entryName of entryNames) {
      if (entryName.startsWith('.')) {
        continue;
      }

      const entryPath = join(dirPath, entryName);

      let entryStat: { isDirectory: () => boolean };
      try {
        entryStat = await stat(entryPath);
      } catch {
        continue;
      }

      if (entryStat.isDirectory()) {
        await walk(entryPath);
        continue;
      }

      const relPath = entryPath.replace(`${scanRootDir}/`, '');

      // Skip root-level manifest.json, asset_hashes.json, and asset_credits.json
      // (these are scan output files, not catalog assets). Preserve scanning of
      // files with those names in nested directories.
      const isRootLevelMetaFile =
        !relPath.includes('/') &&
        (entryName === 'manifest.json' ||
          entryName === 'asset_hashes.json' ||
          entryName === 'asset_credits.json');
      if (isRootLevelMetaFile) {
        continue;
      }

      const categoryName = categoryOverride ?? categoryForPath(relPath);

      if (!categoryName) {
        continue;
      }

      const categoryDef = ASSET_CATEGORIES[categoryName];
      const ext = extname(entryName).toLowerCase();
      if (!categoryDef.extensions.has(ext)) {
        continue;
      }

      // C-433: include extension in tag for tilesets to disambiguate
      // same-name files with different extensions (atlas.webp vs atlas.json).
      const includeExt = categoryName === 'tilesets';
      const tag = pathToTag(splitStateSegments(relPath, categoryName), { includeExt });
      const nameDotIdx = entryName.lastIndexOf('.');
      const name = nameDotIdx >= 0 ? entryName.slice(0, nameDotIdx) : entryName;
      const pathSegments = relPath.split('/');
      const subcategory = pathSegments.length > 2 ? pathSegments.slice(1, -1).join('/') : '';

      if (!assets[tag]) {
        const entry: AssetEntry = {
          tag,
          category: categoryName,
          subcategory,
          name,
          path: relPath,
          ext,
        };
        assets[tag] = entry;
        byCategory[categoryName].push(entry);

        // C-373: compute SHA-256 + size for the hash sidecar.
        hashes[tag] = await hashFile(entryPath);
      }
    }
  };

  await walk(scanRootDir);

  for (const catEntries of Object.values(byCategory)) {
    catEntries.sort((a, b) => a.tag.localeCompare(b.tag));
  }

  return {
    manifest: {
      scannedAt: new Date().toISOString(),
      count: Object.keys(assets).length,
      assets,
      byCategory,
    },
    hashes,
  };
};

/**
 * Computes the SHA-256 hex digest + size in bytes of a file.
 * Streams the file in chunks so large binaries never load fully into memory.
 */
const hashFile = async (filePath: string): Promise<{ hash: string; sizeBytes: number }> => {
  const hash = createHash('sha256');
  const fileStat = await stat(filePath);
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', rejectPromise);
    stream.on('end', () => resolvePromise());
  });
  return { hash: hash.digest('hex'), sizeBytes: fileStat.size };
};

// ---------------------------------------------------------------------------
// C-395: attribution merge (AC-4)
// ---------------------------------------------------------------------------

/** One credit merged into asset_credits.json — a CatalogAssetEntry credit. */
type MergedCredit = {
  licenses: string[];
  authors: string[];
  sourceUrls: string[];
  licenseNote?: string;
  /** Where the credit came from — lpc (CREDITS.csv), lpc-supplement, or project. */
  source: 'lpc' | 'lpc-supplement' | 'project';
};

/** The asset_credits.json sidecar document. */
type AssetCreditsFile = {
  scannedAt: string;
  credits: Record<string, MergedCredit>;
};

/**
 * Read a JSON sidecar file; returns null when missing or unparseable.
 */
const readJsonSidecar = async <T>(filePath: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
};

/**
 * Merge the three committed attribution sources into asset_credits.json:
 *   - lpc_credits.json          — CREDITS.csv join, keyed by output tag (collector)
 *   - lpc_credits_supplement.json — LPC library-level declarations for tags
 *                                   CREDITS.csv does not cover (collector)
 *   - project_licenses.json     — project-owned declaration for non-LPC tags
 *                                 (committed in scripts/src/lib/catalog/)
 *
 * The publish pipeline reads manifest.json + asset_hashes.json +
 * asset_credits.json, and its preflight hard-fails on any catalog tag
 * present in none of the three sources (C-395 AC-4).
 */
const writeCreditsSidecar = async (creditRootDir: string): Promise<void> => {
  const credits: Record<string, MergedCredit> = {};

  const lpcCredits = await readJsonSidecar<{
    credits: Record<string, Omit<MergedCredit, 'source'>>;
  }>(join(creditRootDir, 'lpc_credits.json'));
  if (lpcCredits) {
    for (const [tag, credit] of Object.entries(lpcCredits.credits)) {
      credits[tag] = { ...credit, source: 'lpc' };
    }
  }

  const supplement = await readJsonSidecar<{
    credits: Record<string, Omit<MergedCredit, 'source'>>;
  }>(join(creditRootDir, 'lpc_credits_supplement.json'));
  if (supplement) {
    for (const [tag, credit] of Object.entries(supplement.credits)) {
      // The supplement must never override a real CREDITS.csv resolution.
      if (!credits[tag]) {
        credits[tag] = { ...credit, source: 'lpc-supplement' };
      }
    }
  }

  const projectPath = resolve(join(import.meta.dirname, '../catalog/project_licenses.json'));
  const project = await readJsonSidecar<{
    credits: Record<string, Omit<MergedCredit, 'source'>>;
  }>(projectPath);
  if (project) {
    for (const [tag, credit] of Object.entries(project.credits)) {
      if (!credits[tag]) {
        credits[tag] = { ...credit, source: 'project' };
      }
    }
  }

  const creditsPath = join(creditRootDir, 'asset_credits.json');
  const creditsFile: AssetCreditsFile = {
    scannedAt: new Date().toISOString(),
    credits,
  };
  await writeFile(creditsPath, JSON.stringify(creditsFile, null, 2), 'utf-8');
  console.log(
    `scan_assets: asset_credits.json emitted — ${Object.keys(credits).length} tags with attribution`,
  );
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const SCAN_ROOTS = [
  { dir: GAME_DATA_DIR, label: 'game-data' },
  { dir: CONTENT_PACKS_DIR, label: 'content-packs' },
];

for (const { dir: rootDir, label } of SCAN_ROOTS) {
  // Ensure category directories exist (only for game-data root)
  if (label === 'game-data') {
    for (const category of Object.values(ASSET_CATEGORIES)) {
      const categoryDir = join(rootDir, category.name);
      await mkdir(categoryDir, { recursive: true });
      for (const subdir of category.defaultSubdirs) {
        await mkdir(join(categoryDir, subdir), { recursive: true });
      }
    }
  }

  console.log(`scan_assets: scanning ${label} at ${rootDir}`);
  // C-433: content-packs root uses a category override so all files get
  // the 'contentPacks' category regardless of their directory structure.
  const categoryOverride = label === 'content-packs' ? 'contentPacks' : undefined;
  const { manifest, hashes } = await scanDir(rootDir, { categoryOverride });

  const manifestPath = join(rootDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  // C-373: hash sidecar — tag → sha256 + sizeBytes.
  const hashesPath = join(rootDir, 'asset_hashes.json');
  const hashesFile: AssetHashesFile = {
    scannedAt: manifest.scannedAt,
    hashes,
  };
  await writeFile(hashesPath, JSON.stringify(hashesFile), 'utf-8');

  // C-395 AC-4: merge attribution sources into asset_credits.json.
  await writeCreditsSidecar(rootDir);

  console.log(
    `scan_assets: ${label} done — ${manifest.count} assets indexed, ${Object.keys(hashes).length} hashes emitted`,
  );
}
