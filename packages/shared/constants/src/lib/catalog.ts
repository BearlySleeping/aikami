// packages/shared/constants/src/lib/catalog.ts
//
// Catalog constants shared between the publish pipeline (scripts/) and the
// hub browser surface (C-396).
//
// Thumbnails are generated ONCE at publish time by the pipeline and only
// READ by the hub — these two consumers must agree on the layout without
// duplicating strings.

/**
 * Extension of every generated catalog thumbnail. Standardised at publish
 * time (AC-5): the index only carries `thumbnailHash`, so the hub resolves
 * preview URLs as `<origin>/thumbnails/<hash[0:2]>/<hash><EXT>`.
 */
export const CATALOG_THUMBNAIL_EXT = '.webp';

/**
 * Object key prefix for thumbnails under the origin bucket. Mirrors the
 * asset layout (`assets/`) but under `thumbnails/` — content-addressed by
 * the thumbnail's own sha256, never the source sheet's.
 */
export const CATALOG_THUMBNAIL_KEY_PREFIX = 'thumbnails/';
