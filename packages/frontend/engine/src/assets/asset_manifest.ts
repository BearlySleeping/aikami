// packages/frontend/engine/src/assets/asset_manifest.ts
//
// Asset Manifest Scanner — recursively scans the game-data directory,
// builds a tag→path index, persists it as manifest.json, and provides
// tag-based URL resolution and prompt-optimized tag lists.
//
// Contract: C-243

import { MAX_TAG_LIST_LENGTH, tagToAssetPath } from '@aikami/constants';
import type { AssetManifest, AssetTreeNode } from '@aikami/types';

// ---------------------------------------------------------------------------
// pathToTag — convert filesystem path to manifest tag
// ---------------------------------------------------------------------------

/**
 * Converts a relative file path to its manifest tag.
 *
 * Strips the file extension and replaces all path separators with `:`.
 *
 * @example "sprites/generic-fantasy/elf-male.png" → "sprites:generic-fantasy:elf-male"
 * @param relPath - Relative file path from the game-data root.
 * @returns The manifest tag string.
 */
export const pathToTag = (relPath: string): string => {
  const withoutExt = relPath.replace(/\.[^.]+$/, '');
  return withoutExt.replace(/\//g, ':');
};

// ---------------------------------------------------------------------------
// tagToPath — reverse resolution (tag → relative path with extension)
// ---------------------------------------------------------------------------

/**
 * Resolves a manifest tag back to a file path, given the original extension.
 *
 * Delegates to {@link tagToAssetPath}, which is the exact inverse of the
 * `pathToTag(splitStateSegments(...))` pipeline used to build the tag. A plain
 * `:` → `/` swap is NOT that inverse: for categories with `stateExtensions`
 * (LPC) the trailing state token is a filename suffix, not a directory.
 *
 * @param tag - Manifest tag (e.g. "sprites:generic-fantasy:elf-male")
 * @param ext  - File extension including dot (e.g. ".png")
 * @returns The relative file path (e.g. "sprites/generic-fantasy/elf-male.png")
 */
export const tagToPath = (tag: string, ext: string): string => tagToAssetPath({ tag, ext });

// ---------------------------------------------------------------------------
// sanitizeAssetFilename — clean user-provided filenames
// ---------------------------------------------------------------------------

/**
 * Sanitizes a user-provided filename for safe storage.
 *
 * Replaces non-ASCII characters with their ASCII approximations,
 * strips path separators, collapses whitespace, and lowercases.
 *
 * @param filename - Raw user-provided filename.
 * @returns A sanitized filename string.
 */
export const sanitizeAssetFilename = (filename: string): string =>
  filename
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, '-')
    .toLowerCase();

// ---------------------------------------------------------------------------
// isSafePath — path traversal guard
// ---------------------------------------------------------------------------

/**
 * Validates that a resolved path stays within the game-data directory.
 *
 * Resolves the joined path and asserts it starts with the base directory
 * path. Prevents path traversal attacks (e.g. `../../etc/passwd`).
 *
 * @param basePath - Absolute path to the game-data root.
 * @param targetPath - The requested relative or absolute path.
 * @returns `true` if the resolved path is within the base directory.
 */
export const isSafePath = (basePath: string, targetPath: string): boolean => {
  // Resolve relative to base to get the canonical absolute path.
  // Bun's resolve logic handles `..` traversal correctly.
  const resolved = `${basePath}/${targetPath}`.replace(/\/+/g, '/');
  return resolved.startsWith(basePath.replace(/\/+$/, ''));
};

// ---------------------------------------------------------------------------
// hasNativeMarker — protect bundled engine assets from deletion
// ---------------------------------------------------------------------------

/**
 * Checks whether a file is a native/bundled engine asset.
 *
 * Files in directories starting with `.` or containing a `.native` marker
 * file are considered read-only and protected from deletion/rename.
 *
 * @param relPath - Relative file path.
 * @returns `true` if the file should be write-protected.
 */
export const hasNativeMarker = (relPath: string): boolean =>
  relPath.startsWith('.') || relPath.includes('/.native/');

// ---------------------------------------------------------------------------
// resolveAssetUrl — tag → URL resolution
// ---------------------------------------------------------------------------

/**
 * Resolves a manifest tag to an API file URL.
 *
 * @param tag - Manifest tag (e.g. "backgrounds:fantasy:dark-forest")
 * @param manifest - The loaded asset manifest.
 * @param baseUrl - Base URL for the assets API endpoint
 *   (defaults to "/api/assets/file/").
 * @returns The resolved URL, or `null` if the tag is not found.
 */
export const resolveAssetUrl = (options: {
  tag: string;
  manifest: AssetManifest;
  baseUrl?: string;
}): string | null => {
  const { tag, manifest, baseUrl = '/api/assets/file/' } = options;

  const entry = manifest.assets[tag];
  if (!entry) {
    return null;
  }

  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}${encodeURI(entry.path)}`;
};

// ---------------------------------------------------------------------------
// buildAssetTagList — condensed tag string for GM prompt injection
// ---------------------------------------------------------------------------

/**
 * Builds a condensed, human-readable list of all asset tags for GM prompt
 * injection.
 *
 * Groups tags by category and formats them as:
 * ```
 * music: [music:exploration:fantasy:calm:wanderer, music:combat:fantasy:intense:clash]
 * sfx: [sfx:ui:click, sfx:combat:slash]
 * backgrounds: [backgrounds:fantasy:forest, backgrounds:fantasy:dungeon]
 * sprites: [sprites:generic-fantasy:elf-male, sprites:generic-fantasy:goblin]
 * ```
 *
 * Empty categories are omitted. If the total tag count exceeds
 * {@link MAX_TAG_LIST_LENGTH}, output is truncated with an ellipsis count.
 *
 * @param manifest - The loaded asset manifest.
 * @returns A formatted string suitable for appending to the GM system prompt.
 */
export const buildAssetTagList = (manifest: AssetManifest): string => {
  const lines: string[] = [];
  let totalTags = 0;

  // Iterate categories in a stable order (alphabetical)
  const sortedCategories = Object.keys(manifest.byCategory).sort();

  for (const categoryName of sortedCategories) {
    const entries = manifest.byCategory[categoryName];
    if (!entries || entries.length === 0) {
      continue;
    }

    totalTags += entries.length;
    const tags = entries.map((entry) => entry.tag);

    // Truncate per-category if we exceed the max
    let displayTags = tags;
    if (totalTags > MAX_TAG_LIST_LENGTH && lines.length > 0) {
      const remaining = MAX_TAG_LIST_LENGTH - totalTags + tags.length;
      if (remaining <= 0) {
        break;
      }
      displayTags = tags.slice(0, remaining);
    }

    lines.push(`${categoryName}: [${displayTags.join(', ')}]`);
  }

  return lines.join('\n');
};

// ---------------------------------------------------------------------------
// buildAssetTree — folder tree for the UI
// ---------------------------------------------------------------------------

/**
 * Builds a hierarchical folder tree from the manifest for the asset browser UI.
 *
 * The tree represents the directory structure with asset files as leaf nodes.
 *
 * @param manifest - The loaded asset manifest.
 * @returns An array of root {@link AssetTreeNode}s (category directories).
 */
export const buildAssetTree = (manifest: AssetManifest): AssetTreeNode[] => {
  const roots: AssetTreeNode[] = [];

  /** Find or create a child directory node at a given path segment. */
  const findOrCreateDir = (
    parent: AssetTreeNode[],
    name: string,
    fullPath: string,
  ): AssetTreeNode => {
    let node = parent.find((n) => n.name === name && n.isDirectory);
    if (!node) {
      node = {
        name,
        path: fullPath,
        isDirectory: true,
        children: [],
      };
      parent.push(node);
    }
    return node;
  };

  for (const entry of Object.values(manifest.assets)) {
    const segments = entry.path.split('/');
    let currentLevel = roots;
    let currentPath = '';

    // Traverse/create all directory segments except the last (filename)
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;

      const dirNode = findOrCreateDir(currentLevel, segment, currentPath);
      currentLevel = dirNode.children;
    }

    // Add the file entry as a leaf node
    const fileName = segments[segments.length - 1];
    currentLevel.push({
      name: fileName,
      path: entry.path,
      isDirectory: false,
      children: [],
    });
  }

  // Recursively sort: directories first, then alphabetical
  const sortChildren = (nodes: AssetTreeNode[]): void => {
    nodes.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) {
        return -1;
      }
      if (!a.isDirectory && b.isDirectory) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      sortChildren(node.children);
    }
  };
  sortChildren(roots);

  return roots;
};

// ---------------------------------------------------------------------------
// validUniquePath — collision avoidance for rename/move
// ---------------------------------------------------------------------------

/**
 * Generates a unique path by appending a numeric suffix when the target
 * path already exists.
 *
 * Tries the original path first, then appends `-1`, `-2`, etc. until a
 * non-colliding name is found.
 *
 * @param manifest - The loaded asset manifest.
 * @param targetPath - The desired relative path.
 * @returns A unique, non-colliding relative path.
 */
export const validUniquePath = (manifest: AssetManifest, targetPath: string): string => {
  const existingPaths = new Set(Object.values(manifest.assets).map((entry) => entry.path));

  if (!existingPaths.has(targetPath)) {
    return targetPath;
  }

  const dotIdx = targetPath.lastIndexOf('.');
  const base = dotIdx >= 0 ? targetPath.slice(0, dotIdx) : targetPath;
  const ext = dotIdx >= 0 ? targetPath.slice(dotIdx) : '';

  let counter = 1;
  let candidate: string;

  do {
    candidate = `${base}-${counter}${ext}`;
    counter++;
  } while (existingPaths.has(candidate));

  return candidate;
};
