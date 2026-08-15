// scripts/src/lib/ops/scan_assets.ts
//
// CLI entry point: scans static/game-data/, generates manifest.json,
// and ensures the default directory structure exists.
//
// Usage: bun run scripts/src/lib/ops/scan_assets.ts
//
// Contract: C-243

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { ASSET_CATEGORIES, splitStateSegments } from '@aikami/constants';
import type { AssetEntry, AssetHashesFile, AssetManifest } from '@aikami/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pathToTag = (relPath: string): string => {
  const withoutExt = relPath.replace(/\.[^.]+$/, '');
  return withoutExt.replace(/\//g, ':');
};

const scanDir = async (
  rootDir: string,
): Promise<{
  manifest: AssetManifest;
  hashes: AssetHashesFile['hashes'];
}> => {
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

      const relPath = entryPath.replace(`${rootDir}/`, '');
      const pathSegments = relPath.split('/');
      const categoryName = pathSegments[0];
      const categoryDef = ASSET_CATEGORIES[categoryName];

      if (!categoryDef) {
        continue;
      }

      const ext = extname(entryName).toLowerCase();
      if (!categoryDef.extensions.has(ext)) {
        continue;
      }

      const tag = pathToTag(splitStateSegments(relPath, categoryName));
      const nameDotIdx = entryName.lastIndexOf('.');
      const name = nameDotIdx >= 0 ? entryName.slice(0, nameDotIdx) : entryName;
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

  await walk(rootDir);

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
const writeCreditsSidecar = async (rootDir: string): Promise<void> => {
  const credits: Record<string, MergedCredit> = {};

  const lpcCredits = await readJsonSidecar<{
    credits: Record<string, Omit<MergedCredit, 'source'>>;
  }>(join(rootDir, 'lpc_credits.json'));
  if (lpcCredits) {
    for (const [tag, credit] of Object.entries(lpcCredits.credits)) {
      credits[tag] = { ...credit, source: 'lpc' };
    }
  }

  const supplement = await readJsonSidecar<{
    credits: Record<string, Omit<MergedCredit, 'source'>>;
  }>(join(rootDir, 'lpc_credits_supplement.json'));
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

  const creditsPath = join(rootDir, 'asset_credits.json');
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

const rootDir = resolve(join(process.cwd(), 'apps/frontend/client/static/game-data'));

// Ensure category directories exist
for (const category of Object.values(ASSET_CATEGORIES)) {
  const categoryDir = join(rootDir, category.name);
  await mkdir(categoryDir, { recursive: true });
  for (const subdir of category.defaultSubdirs) {
    await mkdir(join(categoryDir, subdir), { recursive: true });
  }
}

console.log(`scan_assets: scanning ${rootDir}`);
const { manifest, hashes } = await scanDir(rootDir);

const manifestPath = join(rootDir, 'manifest.json');
await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

// C-373: hash sidecar — tag → sha256 + sizeBytes. Regenerated together with
// manifest.json and committed; consumed by the boot seeder for registry seeds.
const hashesPath = join(rootDir, 'asset_hashes.json');
const hashesFile: AssetHashesFile = {
  scannedAt: manifest.scannedAt,
  hashes,
};
await writeFile(hashesPath, JSON.stringify(hashesFile), 'utf-8');

// C-395 AC-4: merge lpc_credits.json + lpc_credits_supplement.json +
// project_licenses.json into asset_credits.json for the publish pipeline.
await writeCreditsSidecar(rootDir);

console.log(
  `scan_assets: done — ${manifest.count} assets indexed, ${Object.keys(hashes).length} hashes emitted`,
);
