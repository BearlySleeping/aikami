// packages/frontend/preview/src/lib/map/map_preview_scene.ts
//
// C-507 — Pure scene-load helper for the map preview.
//
// The preview already holds the raw scene text/tilemap, so it compiles
// synchronously through the engine's unified loader. Extracted from the
// ViewModel so the terrain-forwards behaviour is testable without a DOM.

import type { TilemapData } from '@aikami/frontend/engine/sim';
import {
  buildGidFrameResolver,
  normalizeTilemap,
  type SceneLoadResult,
  sceneFromNative,
  sceneFromTilemap,
} from '@aikami/frontend/engine/sim';
import type { ContentPackTerrain } from '@aikami/schemas';

/** Minimal tileset fields the preview needs to sample a spritesheet. */
export type TilemapTilesetLike = TilemapData['tilesets'][number];

/** Options for {@link loadSceneSync}. */
export type PreviewSceneLoadOptions = {
  sceneId: string;
  assetLock: string;
  adapter: { baseTerrain?: string };
  /** Pack terrain definitions — required to compile terrain-channel scenes. */
  terrains?: readonly ContentPackTerrain[];
};

/**
 * Synchronous scene load for the preview (it already has the raw text).
 * Native scenes parse/compile directly; Tiled/JTON normalize through the
 * adapter. Mirrors `loadScene` without the network fetch. Also returns the
 * raw tilesets so the preview can resolve the spritesheet for real images.
 */
export const loadSceneSync = (
  text: string,
  options: PreviewSceneLoadOptions,
): { result: SceneLoadResult; tilesets: TilemapTilesetLike[] } => {
  const trimmed = text.trimStart();
  const parsed: unknown = JSON.parse(trimmed);
  if ((parsed as { kind?: unknown } | null)?.kind === 'aikami.scene') {
    return {
      result: sceneFromNative(parsed, {
        sceneId: options.sceneId,
        assetLock: options.assetLock,
        terrains: options.terrains,
        adapter: options.adapter,
      }),
      tilesets: [],
    };
  }
  // Normalize raw Tiled JSON through the map loader first: it splits
  // `objectgroup` layers (spawns, transitions) out of `layers` and masks flip
  // bits — without this the adapter rejects the map for having an unbanded
  // layer. Same normalization `loadTilemap`/`loadScene` apply.
  const tilemap = normalizeTilemap(parsed, '<preview>');
  return {
    result: sceneFromTilemap(tilemap, {
      sceneId: options.sceneId,
      assetLock: options.assetLock,
      terrains: options.terrains,
      adapter: {
        ...options.adapter,
        frameResolver: buildGidFrameResolver(tilemap.tilesets),
      },
    }),
    tilesets: tilemap.tilesets,
  };
};
