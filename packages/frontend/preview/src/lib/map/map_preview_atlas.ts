// packages/frontend/preview/src/lib/map/map_preview_atlas.ts
//
// C-507 — Explicit atlas frame mapping for the map preview.
//
// The preview used to derive a frame's source rect from a trailing-number
// heuristic against a grid tileset. Real packed atlases (margin/spacing,
// corner16 frame order) do not follow that layout, so hosts now hand the
// preview an explicit frame -> source-rect map. These helpers are pure so
// they can be unit-tested without a DOM/canvas.

/** A source rectangle in a packed atlas texture. */
export type MapPreviewAtlasFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** An explicit frame -> source-rect atlas supplied by the host. */
export type MapPreviewAtlas = {
  /** Absolute or resolver-relative URL of the packed atlas texture image. */
  imageUrl: string;
  /** Logical frame name (e.g. "earth_3.png") -> source rect in the image. */
  frames: Readonly<Record<string, MapPreviewAtlasFrame>>;
};

/** Resolve a frame name to a source rect from an explicit atlas map, or undefined. */
export const frameRectFromAtlas = (
  frames: Readonly<Record<string, MapPreviewAtlasFrame>>,
  frame: string,
): MapPreviewAtlasFrame | undefined => frames[frame];
