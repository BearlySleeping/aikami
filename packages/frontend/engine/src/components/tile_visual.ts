// packages/frontend/engine/src/components/tile_visual.ts

import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// TileVisual — SoA component for per-tile visual metadata
//
// Contract C-171: Stores per-tile rendering data — texture layer index
// within a WebGPU texture2d_array and tint colour. Used with ChunkData
// via bitECS hierarchical relations for tilemap rendering.
//
// Tiles are bound to their parent chunk via a relation component,
// allowing the render system to batch tiles per chunk for GPU upload.
// ---------------------------------------------------------------------------

/** Maximum number of tile entities. */
export const MAX_TILES = 65536;

/** SoA storage for per-tile visual data. Indexed by entity ID. */
export const TileVisual = {
  /** Layer index in the texture2d_array (0 = base tileset). */
  textureLayer: [] as number[],
  /** Hex colour tint (e.g. 0xffffff for no tint). */
  tint: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type TileVisualData = {
  textureLayer: number;
  tint: number;
};

/**
 * Registers onSet and onGet observers for the TileVisual component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerTileVisualObservers = (world: World): void => {
  observe(world, onSet(TileVisual), (eid: number, params: TileVisualData) => {
    TileVisual.textureLayer[eid] = params.textureLayer;
    TileVisual.tint[eid] = params.tint;
  });

  observe(
    world,
    onGet(TileVisual),
    (eid: number): TileVisualData => ({
      textureLayer: TileVisual.textureLayer[eid],
      tint: TileVisual.tint[eid],
    }),
  );
};
