// scripts/src/lib/ops/scan_assets.ts
//
// CLI entry point: scans static/game-assets/, generates manifest.json,
// and ensures the default directory structure exists.
//
// Usage: bun run scripts/src/lib/ops/scan_assets.ts
//
// Contract: C-243

import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { ASSET_CATEGORIES } from '@aikami/constants';
import type { AssetEntry, AssetManifest } from '@aikami/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pathToTag = (relPath: string): string => {
  const withoutExt = relPath.replace(/\.[^.]+$/, '');
  return withoutExt.replace(/\//g, ':');
};

const scanDir = async (rootDir: string): Promise<AssetManifest> => {
  const assets: AssetManifest['assets'] = {};
  const byCategory: AssetManifest['byCategory'] = {};

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

      const tag = pathToTag(relPath);
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
      }
    }
  };

  await walk(rootDir);

  for (const catEntries of Object.values(byCategory)) {
    catEntries.sort((a, b) => a.tag.localeCompare(b.tag));
  }

  return {
    scannedAt: new Date().toISOString(),
    count: Object.keys(assets).length,
    assets,
    byCategory,
  };
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const rootDir = resolve(join(process.cwd(), 'apps/frontend/client/static/game-assets'));

// Ensure category directories exist
for (const category of Object.values(ASSET_CATEGORIES)) {
  const categoryDir = join(rootDir, category.name);
  await mkdir(categoryDir, { recursive: true });
  for (const subdir of category.defaultSubdirs) {
    await mkdir(join(categoryDir, subdir), { recursive: true });
  }
}

console.log(`scan_assets: scanning ${rootDir}`);
const manifest = await scanDir(rootDir);

const manifestPath = join(rootDir, 'manifest.json');
await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

console.log(`scan_assets: done — ${manifest.count} assets indexed`);
