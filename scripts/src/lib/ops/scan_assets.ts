// scripts/src/lib/ops/scan_assets.ts
//
// CLI entry point: scans static/game-data/ and content/packs/,
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
import { extname, join, relative, resolve, sep } from 'node:path';
import { ASSET_CATEGORIES, categoryForPath, splitStateSegments } from '@aikami/constants';
import type { CatalogAssetCredit } from '@aikami/schemas';
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

      // `relative()` + a forward-slash join keeps tags/paths portable: on
      // Windows path.join/resolve produce `\`-separated paths, so a naive
      // string replace against `${scanRootDir}/` never matches and every
      // downstream check that assumes `/` (categoryForPath, pathToTag)
      // silently no-ops the whole scan root.
      const relPath = relative(scanRootDir, entryPath).split(sep).join('/');

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

      // C-433: include extension in tag for categories that declare
      // tagIncludesExtension (tilesets), to disambiguate same-name files
      // with different extensions (atlas.webp vs atlas.json). Must mirror
      // the client-side pathToTag (packages/frontend/engine) exactly, or
      // resolveUrl() never finds the row published under this tag.
      const includeExt = ASSET_CATEGORIES[categoryName]?.tagIncludesExtension === true;
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
      // Filled in by the caller from the committed file when the scan found no
      // semantic change — see `preservedScannedAt`. A placeholder here keeps
      // `scannedAt` first in the serialized object, matching the committed
      // format.
      scannedAt: '',
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
type MergedCredit = CatalogAssetCredit & {
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
 * The `scannedAt` already committed for this sidecar, or `fallback`.
 *
 * `scannedAt` is truthful metadata about when a scan last found a difference,
 * not part of the artifact's identity. Preserving it when nothing changed is
 * what makes a second identical scan a no-op instead of a tracked-file diff.
 */
const preservedScannedAt = async (filePath: string, fallback: string): Promise<string> => {
  const existing = await readJsonSidecar<{ scannedAt?: unknown }>(filePath);
  return typeof existing?.scannedAt === 'string' && existing.scannedAt.length > 0
    ? existing.scannedAt
    : fallback;
};

/**
 * Writes `content` only when it differs from what is already on disk.
 *
 * Returns whether a write happened. This is the whole determinism guarantee:
 * an unchanged scan produces byte-identical output, so the second run compares
 * equal and writes nothing. Without it, a generated artifact would dirty the
 * tree on every run purely because time passed, and the release model — clean
 * committed source, deterministic rebuild, seal — could not hold.
 */
const writeIfChanged = async (filePath: string, content: string): Promise<boolean> => {
  try {
    if ((await readFile(filePath, 'utf8')) === content) {
      return false;
    }
  } catch {
    // Missing or unreadable — fall through and write.
  }
  await writeFile(filePath, content, 'utf-8');
  return true;
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
/**
 * Merges one attribution source into `credits`, never overriding a tag an
 * earlier (more authoritative) source already resolved.
 *
 * Extracted so the three-source merge reads as three calls rather than three
 * copies of the same nested loop — the precedence rule lives in one place.
 */
const mergeCreditSource = (options: {
  credits: Record<string, MergedCredit>;
  source: Record<string, Omit<MergedCredit, 'source'>> | undefined;
  label: MergedCredit['source'];
  /** When true, this source may replace an existing entry. */
  override: boolean;
}): void => {
  const { credits, source, label, override } = options;
  if (!source) {
    return;
  }
  for (const [tag, credit] of Object.entries(source)) {
    if (override || !credits[tag]) {
      credits[tag] = { ...credit, source: label };
    }
  }
};

const writeCreditsSidecar = async (creditRootDir: string): Promise<void> => {
  const credits: Record<string, MergedCredit> = {};
  type SourceFile = { credits: Record<string, Omit<MergedCredit, 'source'>> };

  // Precedence: CREDITS.csv resolution, then the library-level supplement, then
  // the project's own declaration. Only the first may replace an existing tag.
  mergeCreditSource({
    credits,
    source: (await readJsonSidecar<SourceFile>(join(creditRootDir, 'lpc_credits.json')))?.credits,
    label: 'lpc',
    override: true,
  });
  mergeCreditSource({
    credits,
    source: (await readJsonSidecar<SourceFile>(join(creditRootDir, 'lpc_credits_supplement.json')))
      ?.credits,
    label: 'lpc-supplement',
    override: false,
  });
  mergeCreditSource({
    credits,
    source: (
      await readJsonSidecar<SourceFile>(
        resolve(join(import.meta.dirname, '../catalog/project_licenses.json')),
      )
    )?.credits,
    label: 'project',
    override: false,
  });

  const creditsPath = join(creditRootDir, 'asset_credits.json');
  const creditsFile: AssetCreditsFile = {
    scannedAt: await preservedScannedAt(creditsPath, new Date().toISOString()),
    credits,
  };
  const wrote = await writeIfChanged(creditsPath, JSON.stringify(creditsFile, null, 2));
  console.log(
    `scan_assets: asset_credits.json ${wrote ? 'emitted' : 'unchanged'} — ${Object.keys(credits).length} tags with attribution`,
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
  // One scan timestamp, shared by every sidecar this run rewrites, and
  // preserved from the committed file when the scan found nothing new.
  const scannedAt = await preservedScannedAt(manifestPath, new Date().toISOString());
  manifest.scannedAt = scannedAt;
  const manifestWrote = await writeIfChanged(manifestPath, JSON.stringify(manifest, null, 2));

  // C-373: hash sidecar — tag → sha256 + sizeBytes.
  const hashesPath = join(rootDir, 'asset_hashes.json');
  const hashesFile: AssetHashesFile = { scannedAt, hashes };
  const hashesWrote = await writeIfChanged(hashesPath, JSON.stringify(hashesFile));

  // C-395 AC-4: merge attribution sources into asset_credits.json.
  await writeCreditsSidecar(rootDir);

  console.log(
    `scan_assets: ${label} done — ${manifest.count} assets indexed, ${Object.keys(hashes).length} hashes emitted, manifest ${manifestWrote ? 'written' : 'unchanged'}, hashes ${hashesWrote ? 'written' : 'unchanged'}`,
  );
}
