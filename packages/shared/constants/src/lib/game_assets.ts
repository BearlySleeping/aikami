// packages/shared/constants/src/lib/game_assets.ts
//
// Asset management system constants — file extensions, MIME maps,
// category definitions, and directory scaffolding.
// Shared between engine (manifest scanner) and backend (upload validation).
//
// Contract: C-243

// ---------------------------------------------------------------------------
// File extension sets
// ---------------------------------------------------------------------------

/** Image file extensions accepted for sprite/background uploads. */
export const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg']);

/** Audio file extensions accepted for music/sfx/ambient uploads. */
export const AUDIO_EXTS = new Set(['.mp3', '.ogg', '.wav', '.flac', '.m4a', '.aac', '.webm']);

/** Text file extensions for note/script asset uploads. */
export const TEXT_EXTS = new Set(['.txt', '.md', '.json', '.yaml', '.yml', '.csv', '.xml']);

// ---------------------------------------------------------------------------
// MIME type maps
// ---------------------------------------------------------------------------

/** Maps file extensions to MIME types for content-type headers. */
export const IMAGE_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
};

/** Maps audio file extensions to MIME types for content-type headers. */
export const AUDIO_MIME_MAP: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.webm': 'audio/webm',
};

// ---------------------------------------------------------------------------
// Category definitions
// ---------------------------------------------------------------------------

/** Category metadata — name, allowed extensions, and default subdirectories. */
export type AssetCategoryDefinition = {
  name: string;
  extensions: Set<string>;
  defaultSubdirs: string[];
  /**
   * Optional: for categories where files are named `<name>.<state>.<ext>`
   * (e.g. LPC spritesheets `bodies_male.walk.webp`), the trailing state
   * token is split into its own tag segment so the manifest tag becomes
   * `lpc:body:bodies_male:walk` instead of `lpc:body:bodies_male.walk`.
   */
  stateExtensions?: readonly string[];
};

/**
 * All supported asset categories with validation rules.
 *
 * C-433 added `maps`, `tilesets` and `contentPacks` to widen catalog
 * coverage to every asset the client ships. Category assignment is by
 * containing directory, not by extension alone (`.json` is shared by maps,
 * tileset descriptors and pack manifests).
 */
export const ASSET_CATEGORIES: Record<string, AssetCategoryDefinition> = {
  music: {
    name: 'music',
    extensions: new Set(AUDIO_EXTS),
    defaultSubdirs: [
      'exploration/fantasy/calm',
      'combat/fantasy/intense',
      'dialogue/fantasy/calm',
      'travel_rest/fantasy/calm',
    ],
  },
  sfx: {
    name: 'sfx',
    extensions: new Set(AUDIO_EXTS),
    defaultSubdirs: ['ui', 'combat', 'exploration'],
  },
  ambient: {
    name: 'ambient',
    extensions: new Set(AUDIO_EXTS),
    defaultSubdirs: ['nature', 'urban', 'interior'],
  },
  sprites: {
    name: 'sprites',
    extensions: new Set(IMAGE_EXTS),
    defaultSubdirs: ['generic-fantasy', 'generic-scifi'],
  },
  backgrounds: {
    name: 'backgrounds',
    extensions: new Set(IMAGE_EXTS),
    defaultSubdirs: ['fantasy', 'scifi', 'modern', 'illustrations'],
  },
  lpc: {
    name: 'lpc',
    extensions: new Set(['.webp']),
    defaultSubdirs: [
      'body',
      'legs',
      'feet',
      'torso',
      'head',
      'hair',
      'eyes',
      'facial',
      'hat',
      'neck',
      'shield',
      'shoulders',
      'weapon',
      'cape',
      'dress',
      'beard',
    ],
    stateExtensions: [
      'walk',
      'idle',
      'run',
      'jump',
      'sit',
      'climb',
      'emote',
      'spellcast',
      'thrust',
      'slash',
      'halfslash',
      'backslash',
      'shoot',
      'hurt',
      'combat_idle',
    ],
  },

  // C-433: structured map data — Tiled JSON export and compact .jton form
  maps: {
    name: 'maps',
    extensions: new Set(['.jton', '.json']),
    defaultSubdirs: [],
  },

  // C-433: tileset atlases and descriptors — reverses the C-395 dev-only exclusion
  tilesets: {
    name: 'tilesets',
    extensions: new Set(['.webp', '.png', '.json']),
    defaultSubdirs: [],
  },

  // C-433: content-pack constituents — manifests, pack maps, pack sprites
  contentPacks: {
    name: 'contentPacks',
    extensions: new Set(['.json', '.jton', '.webp', '.png']),
    defaultSubdirs: [],
  },

  // NPC/player portrait sprites — pre-generated WebP busts grouped by character
  portraits: {
    name: 'portraits',
    extensions: new Set(['.webp', '.svg']),
    defaultSubdirs: [],
  },
} as const satisfies Record<string, AssetCategoryDefinition>;

// ---------------------------------------------------------------------------
// Tag normalization helpers
// ---------------------------------------------------------------------------

/**
 * Splits a trailing `<state>` token into its own path segment for categories
 * that declare {@link AssetCategoryDefinition.stateExtensions}.
 *
 * @example "lpc/body/bodies_male.walk" → "lpc/body/bodies_male/walk"
 * @param relPath - Extension-stripped relative path (may still contain the
 *   trailing `.<state>` token).
 * @param categoryName - First path segment (the asset category).
 * @returns The normalized path, or the input unchanged when the category has
 *   no state extensions or the trailing token is not a known state.
 */
export const splitStateSegments = (relPath: string, categoryName: string): string => {
  const categoryDef = ASSET_CATEGORIES[categoryName];
  const stateExtensions = categoryDef?.stateExtensions;
  if (!stateExtensions || stateExtensions.length === 0) {
    return relPath;
  }

  // Strip the real file extension first (e.g. "lpc/body/bodies_male.walk.webp" →
  // "lpc/body/bodies_male.walk") so the trailing `.<state>` token is what remains.
  const withoutExt = relPath.replace(/\.[^.]+$/, '');
  const lastDot = withoutExt.lastIndexOf('.');
  if (lastDot <= 0) {
    return relPath;
  }

  const state = withoutExt.slice(lastDot + 1);
  if (!stateExtensions.includes(state)) {
    return relPath;
  }

  return `${withoutExt.slice(0, lastDot)}/${state}`;
};

/**
 * Resolves a manifest tag back to its relative file path — the exact inverse
 * of `pathToTag(splitStateSegments(relPath, category))`, which is how every
 * tag in the catalog was produced.
 *
 * Tags are the only asset identity the compact boot seed (C-435) carries, so
 * this is what turns a seed row back into a bundled URL or an R2 key. It must
 * stay in lockstep with {@link splitStateSegments}.
 *
 * @example "sprites:tilesets:atlas" + ".webp" → "sprites/tilesets/atlas.webp"
 * @example "lpc:body:bodies_male:walk" + ".webp" → "lpc/body/bodies_male.walk.webp"
 * @param options - Tag and file extension (including the leading dot).
 * @returns The relative path under the game-data root.
 */
export const tagToAssetPath = (options: { tag: string; ext: string }): string => {
  const segments = options.tag.split(':');
  const stateExtensions = ASSET_CATEGORIES[segments[0] ?? '']?.stateExtensions;
  const state = segments.at(-1);

  // When the tag already includes the extension in its last segment
  // (e.g. "sprites:tilesets:atlas.webp" with ext ".webp"), don't add it again.
  const lastSegment = segments.at(-1) ?? '';
  const normalizedExt = options.ext.startsWith('.') ? options.ext : `.${options.ext}`;
  if (lastSegment.endsWith(normalizedExt)) {
    return segments.join('/');
  }

  // Only rejoin when the category actually splits state tokens AND the
  // trailing segment is a declared state — otherwise the tag never had a
  // `.<state>` suffix and every segment is a real directory.
  if (
    stateExtensions &&
    stateExtensions.length > 0 &&
    state !== undefined &&
    segments.length > 2 &&
    stateExtensions.includes(state)
  ) {
    return `${segments.slice(0, -1).join('/')}.${state}${options.ext}`;
  }

  return `${segments.join('/')}${options.ext}`;
};

/**
 * Object key for an asset in the published R2 bucket (C-395 layout:
 * `assets/<hash[0:2]>/<hash><ext>`). The content hash *is* the identity, so
 * the key never needs revalidating.
 *
 * @param options - SHA-256 content hash and extension (including the dot).
 * @returns The bucket-relative object key.
 */
export const r2AssetKey = (options: { hash: string; ext: string }): string =>
  `assets/${options.hash.slice(0, 2)}/${options.hash}${options.ext}`;

/**
 * Public download URL for an asset in the R2 bucket.
 *
 * @param options - Bucket base URL (trailing slash optional), hash, extension.
 * @returns The absolute URL to fetch the asset from.
 */
export const r2AssetUrl = (options: { baseUrl: string; hash: string; ext: string }): string =>
  `${options.baseUrl.replace(/\/$/, '')}/${r2AssetKey(options)}`;

/**
 * URL prefix the client serves bundled game data from (`static/game-data`).
 * Shared so the registry, the asset store and the seed generator all agree on
 * where a bundled relative path is mounted.
 */
export const BUNDLED_ASSET_BASE = '/game-data';

/**
 * `pack_id` given to assets that ship inside the client and must survive LRU
 * eviction (C-435 offline core). Everything else is packed by category, so the
 * eviction guard is a single pack id rather than "every bundled category".
 */
export const OFFLINE_CORE_PACK_ID = 'core';

/** Default filename for the persisted manifest JSON. */
export const MANIFEST_FILENAME = 'manifest.json';

/** Default directory name for game assets at the project root. */
export const DEFAULT_ASSETS_DIR = 'data/game-data';

/** Maximum upload file size in bytes (50 MB for audio/images). */
export const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;

/** Maximum upload file size in bytes for text files (10 MB). */
export const MAX_TEXT_UPLOAD_SIZE = 10 * 1024 * 1024;

/** Maximum number of tags to include in buildAssetTagList output. */
export const MAX_TAG_LIST_LENGTH = 1000;
