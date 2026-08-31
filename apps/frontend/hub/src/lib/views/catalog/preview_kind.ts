// apps/frontend/hub/src/lib/views/catalog/preview_kind.ts
//
// Per-category preview dispatch (C-446 AC-2). Pure function — no imports
// from server-only modules, safe to use in client-side ViewModels.

import type { CatalogAssetEntry } from '@aikami/schemas';

/** Which interactive preview an entry supports, if any. */
export type PreviewKind =
  | 'lpc' // composed, animated character
  | 'tileset' // atlas grid at integer scale
  | 'map' // rendered tilemap
  | 'prop' // single sprite / spritesheet frame
  | 'pack' // content-pack contents listing
  | 'none'; // thumbnail only — audio, unknown categories

/**
 * Pure dispatch. Every branch is explicit; unknown categories return 'none'
 * so the server-rendered thumbnail is never replaced by a broken canvas.
 *
 * @param entry - The catalog asset entry to classify.
 * @returns The preview kind for this entry.
 */
export const previewKindForEntry = (entry: CatalogAssetEntry): PreviewKind => {
  const { category } = entry;

  switch (category) {
    case 'lpc':
      return 'lpc';

    case 'tilesets':
      return 'tileset';

    case 'maps':
      return 'map';

    case 'sprites':
      return 'prop';

    case 'contentPacks':
      return 'pack';

    // Audio categories — no interactive preview, keep the thumbnail.
    case 'music':
    case 'sfx':
    case 'ambient':
      return 'none';

    // Backgrounds — single image, thumbnail is sufficient.
    case 'backgrounds':
      return 'none';

    default:
      return 'none';
  }
};
