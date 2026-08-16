// packages/frontend/engine/src/assets/asset_manifest_node.ts
//
// Node-only asset manifest operations (filesystem scanning, disk I/O).
//
// Kept separate from `asset_manifest.ts` so the browser bundle never pulls in
// `node:fs/promises` / `node:path` (externalized as empty modules in browser
// builds). The engine barrel re-exports only the browser-safe helpers from
// `asset_manifest.ts`; anything that touches the filesystem lives here.
//
// Contract: C-243

import {
  ASSET_CATEGORIES,
  DEFAULT_ASSETS_DIR,
  MANIFEST_FILENAME,
  splitStateSegments,
} from '@aikami/constants';
import { AssetManifestSchema } from '@aikami/schemas';
import type { AssetEntry, AssetManifest } from '@aikami/types';
import { logger } from '$logger';
import { pathToTag } from './asset_manifest.ts';

// ---------------------------------------------------------------------------
// Scan context — internal state shared across scan helpers
// ---------------------------------------------------------------------------

type ScanContext = {
  rootDir: string;
  assets: Record<string, AssetEntry>;
  byCategory: Record<string, AssetEntry[]>;
  collisionWarnings: string[];
  /** Set of visited canonical directory paths to prevent symlink cycles. */
  visitedDirs: Set<string>;
};

// ---------------------------------------------------------------------------
// ensureAssetDirs — scaffold default directory structure
// ---------------------------------------------------------------------------

/**
 * Creates the default asset directory scaffolding if it doesn't exist.
 *
 * Based on {@link ASSET_CATEGORIES}, creates all top-level category
 * directories and their nested default subdirectories.
 *
 * @param rootDir - Absolute path to the game-data root.
 */
export const ensureAssetDirs = async (rootDir: string): Promise<void> => {
  const { mkdir } = await import('node:fs/promises');
  const { join } = await import('node:path');

  for (const category of Object.values(ASSET_CATEGORIES)) {
    const categoryDir = join(rootDir, category.name);
    await mkdir(categoryDir, { recursive: true });

    for (const subdir of category.defaultSubdirs) {
      await mkdir(join(categoryDir, subdir), { recursive: true });
    }
  }

  logger.debug('ensureAssetDirs: directories created', { rootDir });
};

// ---------------------------------------------------------------------------
// buildManifest — recursive directory scan
// ---------------------------------------------------------------------------

/**
 * Recursively scans the game-data directory tree and builds an asset manifest.
 *
 * Filters files by category-specific extension sets, generates tags via
 * {@link pathToTag}, detects duplicate tag collisions, and writes the
 * resulting manifest to `manifest.json` in the root directory.
 *
 * Hidden files and directories (starting with `.`) are excluded from
 * the scan. Symlinks are followed (Bun's `readdir` follows symlinks by default).
 *
 * @param rootDir - Absolute path to the game-data root directory
 *   (defaults to `data/game-assets/` relative to the current working directory).
 * @returns A promise resolving to the built {@link AssetManifest}.
 */
export const buildManifest = async (rootDir?: string): Promise<AssetManifest> => {
  const { join, relative } = await import('node:path');
  const { readdir, stat, writeFile, mkdir, realpath } = await import('node:fs/promises');

  const resolvedRoot = rootDir ?? join(process.cwd(), DEFAULT_ASSETS_DIR);

  // Ensure the root directory exists
  await mkdir(resolvedRoot, { recursive: true });

  const ctx: ScanContext = {
    rootDir: resolvedRoot,
    assets: {},
    byCategory: {},
    collisionWarnings: [],
    visitedDirs: new Set(),
  };

  // Initialize byCategory with empty arrays for all known categories
  for (const categoryName of Object.keys(ASSET_CATEGORIES)) {
    ctx.byCategory[categoryName] = [];
  }

  // Recursive scan helper
  const scanDir = async (dirPath: string): Promise<void> => {
    // Track canonical path to prevent symlink cycles
    let canonicalPath: string;
    try {
      canonicalPath = await realpath(dirPath);
    } catch {
      return; // Skip directories that can't be resolved (e.g. broken symlinks)
    }

    if (ctx.visitedDirs.has(canonicalPath)) {
      return; // Already visited — skip to prevent cycles
    }
    ctx.visitedDirs.add(canonicalPath);

    let entries: string[];
    try {
      entries = await readdir(dirPath);
    } catch {
      return; // Skip directories that can't be read
    }

    for (const entryName of entries) {
      if (entryName.startsWith('.')) {
        continue; // Skip hidden files and directories
      }

      const entryPath = join(dirPath, entryName);

      let entryStat: Awaited<ReturnType<typeof stat>>;
      try {
        entryStat = await stat(entryPath);
      } catch {
        continue; // Skip entries that can't be stat'd (e.g. broken symlinks)
      }

      if (entryStat.isDirectory()) {
        await scanDir(entryPath);
        continue;
      }

      // node:path's relative() emits backslashes on Windows; asset tags and
      // manifest paths are always POSIX-style, so normalize before splitting
      // — otherwise the whole path collapses into one segment on Windows and
      // categoryName never matches ASSET_CATEGORIES.
      const relPath = relative(resolvedRoot, entryPath).split('\\').join('/');

      // Determine category from first path segment
      const pathSegments = relPath.split('/');
      const categoryName = pathSegments[0];
      const categoryDef = ASSET_CATEGORIES[categoryName];

      if (!categoryDef) {
        continue; // File outside known category dirs — skip
      }

      // Check extension
      const extIdx = entryName.lastIndexOf('.');
      if (extIdx === -1) {
        continue;
      }
      const ext = entryName.slice(extIdx).toLowerCase();

      if (!categoryDef.extensions.has(ext)) {
        continue; // Extension not allowed for this category
      }

      // Build entry
      const tag = pathToTag(splitStateSegments(relPath, categoryName));
      const name = entryName.slice(0, extIdx);

      // Build subcategory from path segments between category and filename
      const subcategory = pathSegments.length > 2 ? pathSegments.slice(1, -1).join('/') : '';

      const entry: AssetEntry = {
        tag,
        category: categoryName,
        subcategory,
        name,
        path: relPath,
        ext,
      };

      // Duplicate tag detection
      if (ctx.assets[tag]) {
        ctx.collisionWarnings.push(
          `Tag collision: "${tag}" — "${relPath}" already taken by "${ctx.assets[tag].path}". Skipping.`,
        );
        continue;
      }

      ctx.assets[tag] = entry;
      ctx.byCategory[categoryName].push(entry);
    }
  };

  // Start scan from root
  await scanDir(resolvedRoot);

  // Sort each category array by tag for deterministic output
  for (const categoryEntries of Object.values(ctx.byCategory)) {
    categoryEntries.sort((a, b) => a.tag.localeCompare(b.tag));
  }

  // Log collision warnings
  for (const warning of ctx.collisionWarnings) {
    logger.warn(warning);
  }

  const manifest: AssetManifest = {
    scannedAt: new Date().toISOString(),
    count: Object.keys(ctx.assets).length,
    assets: ctx.assets,
    byCategory: ctx.byCategory,
  };

  // Persist to disk
  const manifestPath = join(resolvedRoot, MANIFEST_FILENAME);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  logger.debug('buildManifest: complete', {
    root: resolvedRoot,
    count: manifest.count,
    collisions: ctx.collisionWarnings.length,
  });

  return manifest;
};

// ---------------------------------------------------------------------------
// loadManifest — read cached manifest from disk
// ---------------------------------------------------------------------------

/**
 * Loads a previously persisted manifest from disk.
 *
 * Reads `manifest.json` from the asset root directory and validates
 * it against the {@link AssetManifestSchema} TypeBox schema.
 *
 * @param rootDir - Absolute path to the game-data root.
 * @returns The cached manifest, or `null` if not found or invalid.
 */
export const loadManifest = async (rootDir?: string): Promise<AssetManifest | null> => {
  const { join } = await import('node:path');
  const { readFile } = await import('node:fs/promises');
  const { Value } = await import('typebox/value');

  const resolvedRoot = rootDir ?? join(process.cwd(), DEFAULT_ASSETS_DIR);
  const manifestPath = join(resolvedRoot, MANIFEST_FILENAME);

  try {
    const raw = await readFile(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw);

    if (!Value.Check(AssetManifestSchema, parsed)) {
      logger.warn('loadManifest: cached manifest failed schema validation');
      return null;
    }

    return parsed as AssetManifest;
  } catch {
    return null;
  }
};
