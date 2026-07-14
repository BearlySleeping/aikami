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
};

/** All supported asset categories with validation rules. */
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
} as const satisfies Record<string, AssetCategoryDefinition>;

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
