// packages/frontend/engine/src/components/chunk_data.ts

import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// ChunkData — SoA component for tilemap chunk management
//
// Contract C-171: Stores spatial chunk metadata — grid coordinates,
// active/inactive flags, and dirty flags. Used by the tilemap rendering
// system to track which chunks are visible (in scene graph) and which
// need GPU buffer uploads.
//
// Chunk layout: maps are divided into uniform 32×32 tile chunks.
// Grid coordinates (gridX, gridY) identify the chunk's position in
// chunk-space, not world-space.
// ---------------------------------------------------------------------------

/** Number of tiles per chunk side. Must be a power of two. */
export const CHUNK_TILE_SIZE = 32;

/** Maximum number of chunks in a single map. */
export const MAX_CHUNKS = 256;

/** SoA storage for chunk metadata. Indexed by entity ID. */
export const ChunkData = {
  /** Chunk grid X coordinate (in chunk-space, not tile-space). */
  gridX: [] as number[],
  /** Chunk grid Y coordinate (in chunk-space, not tile-space). */
  gridY: [] as number[],
  /** 1 = visible in scene graph (mesh added to stage), 0 = culled. */
  isActive: [] as number[],
  /** 1 = needs buffer upload to GPU, 0 = clean. */
  isDirty: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type ChunkDataPayload = {
  gridX: number;
  gridY: number;
  isActive: number;
  isDirty: number;
};

/**
 * Registers onSet and onGet observers for the ChunkData component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerChunkDataObservers = (world: World): void => {
  observe(world, onSet(ChunkData), (eid: number, params: ChunkDataPayload) => {
    ChunkData.gridX[eid] = params.gridX;
    ChunkData.gridY[eid] = params.gridY;
    ChunkData.isActive[eid] = params.isActive;
    ChunkData.isDirty[eid] = params.isDirty;
  });

  observe(
    world,
    onGet(ChunkData),
    (eid: number): ChunkDataPayload => ({
      gridX: ChunkData.gridX[eid],
      gridY: ChunkData.gridY[eid],
      isActive: ChunkData.isActive[eid],
      isDirty: ChunkData.isDirty[eid],
    }),
  );
};
