// packages/frontend/engine/src/systems/tilemap_render_system.ts

import { Assets, Buffer, BufferUsage, Container, Texture, UniformGroup } from 'pixi.js';
import type { TilemapData } from '../assets/map_loader.ts';
import { buildTilemapChunks, frustumCullChunks } from '../rendering/tilemap_chunk_renderer.ts';

// ---------------------------------------------------------------------------
// Tilemap Rendering System — WebGPU chunk-based Mesh pipeline
//
// Contract C-171: Replaces the legacy RenderTexture baking system with a
// spatial chunking architecture. The map is divided into 32×32 tile chunks,
// each rendered as a single PixiJS `Mesh` backed by `Float32Array` vertex/UV
// buffers and `Uint32Array` index buffers.
//
// CPU-side frustum culling (via {@link frustumCullChunks}) removes off-screen
// chunks from the scene graph, achieving zero-cost GPU culling for maps
// larger than the viewport.
//
// All MeshGeometry and Buffer objects are created with `autoGarbageCollect = false`
// to prevent the PixiJS v8 silent unbinding bug when chunks are temporarily
// culled from the screen.
// ---------------------------------------------------------------------------

/**
 * Options for rendering a tilemap into a PixiJS scene.
 */
export type TilemapRenderOptions = {
  /** The parsed tilemap data from {@link loadTilemap}. */
  tilemap: TilemapData;
  /**
   * Optional layer name filter. When provided, only layers whose
   * name matches are rendered. Layers with the name "collision"
   * are always skipped.
   *
   * When omitted, all visible non-collision layers are rendered.
   */
  layerFilter?: (layerName: string) => boolean;
};

/**
 * Result of rendering a tilemap into the scene.
 */
export type TilemapRenderResult = {
  /** The Container holding all chunk Meshes. Add to the world container. */
  container: Container;
  /** Number of layers rendered. */
  layerCount: number;
  /** Number of mesh chunks created. */
  chunkCount: number;
  /** Global uniform group for animation time. */
  globalUniforms: UniformGroup;
  /** Storage buffer for animation tables. */
  animStorageBuffer: Buffer;
};

/**
 * Renders a parsed tilemap into a PixiJS Container using chunked Mesh
 * rendering instead of RenderTexture baking.
 *
 * Each visible, non-collision layer is divided into 32×32 tile chunks.
 * Each chunk is a single {@link Mesh} with pre-allocated position/UV/index
 * buffers. The tileset image is loaded as a Texture and shared across
 * all chunks in its layer.
 *
 * The returned Container holds all chunk Meshes. Frustum culling is
 * performed externally via {@link frustumCullChunks} every frame.
 *
 * @param options - Tilemap data and optional layer filter.
 * @returns A container with all chunk meshes.
 */
export const renderTilemap = async (
  options: TilemapRenderOptions,
): Promise<TilemapRenderResult> => {
  const { tilemap, layerFilter } = options;

  const container = new Container();
  container.label = 'tilemap-chunks';

  // Collect unique tileset images to load
  const imageSet = new Set<string>();
  for (const layer of tilemap.layers) {
    if (!layer.visible || layer.name === 'collision') {
      continue;
    }
    if (layerFilter && !layerFilter(layer.name)) {
    }
    // No need to load tileset images per-layer — they're shared across all layers
  }
  for (const tileset of tilemap.tilesets) {
    imageSet.add(tileset.image);
  }

  // Load all tileset textures
  const loadPromises = [...imageSet].map((image) => Assets.load(image));
  await Promise.all(loadPromises);

  // Build a texture map keyed by image path
  const textureMap = new Map<string, Texture>();
  for (const image of imageSet) {
    const texture = Texture.from(image);
    textureMap.set(image, texture);
  }

  let layerCount = 0;
  let totalChunks = 0;

  // Render layers bottom-to-top (preserve Tiled draw order)
  for (const layer of tilemap.layers) {
    if (!layer.visible) {
      continue;
    }
    if (layer.name === 'collision') {
      continue;
    }
    if (layerFilter && !layerFilter(layer.name)) {
      continue;
    }

    // Determine which tileset(s) this layer's GIDs reference.
    // Build a filtered tileset list for this layer and use the
    // primary tileset's texture for rendering.
    const primaryTileset = _findPrimaryTilesetForLayer(layer, tilemap);
    if (!primaryTileset) {
      continue;
    }

    const texture = textureMap.get(primaryTileset.image);
    if (!texture) {
      continue;
    }

    // Build a filtered tilemap containing only this layer + relevant tilesets
    const layerTilemap: TilemapData = {
      ...tilemap,
      layers: [layer],
      // Include only the tilesets that this layer references
      tilesets: tilemap.tilesets.filter((ts) => {
        return _layerReferencesTileset(layer, ts, tilemap.tilesets);
      }),
    };

    const result = buildTilemapChunks({
      tilemap: layerTilemap,
      tilesetTexture: texture,
    });

    // Merge chunk children into the main container
    while (result.container.children.length > 0) {
      container.addChild(result.container.children[0]);
    }

    layerCount += 1;
    totalChunks += result.chunkCount;

    // Return the shared uniforms/buffer from the last layer
    if (layer === tilemap.layers[tilemap.layers.length - 1]) {
      return {
        container,
        layerCount,
        chunkCount: totalChunks,
        globalUniforms: result.globalUniforms,
        animStorageBuffer: result.animStorageBuffer,
      };
    }
  }

  // Fallback (empty map)
  return {
    container,
    layerCount,
    chunkCount: totalChunks,
    globalUniforms: new UniformGroup({
      uTransformMatrix: { value: new Float32Array(9), type: 'mat3x3<f32>' },
      uTime: { value: 0, type: 'f32' },
    }),
    animStorageBuffer: new Buffer({
      data: new Float32Array(0),
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST,
    }),
  };
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Finds the primary tileset for a layer by checking which tileset
 * covers the most non-zero GIDs in the layer's tile data.
 *
 * @param layer - The tile layer.
 * @param tilemap - The full tilemap data with tilesets.
 * @returns The primary tileset, or undefined if no tiles are found.
 */
const _findPrimaryTilesetForLayer = (
  layer: { data: readonly number[] },
  tilemap: TilemapData,
): TilemapData['tilesets'][number] | undefined => {
  if (tilemap.tilesets.length === 0) {
    return undefined;
  }

  // Count GIDs per tileset
  const counts = new Map<number, number>();

  for (const gid of layer.data) {
    if (gid === 0) {
      continue;
    }
    for (let i = tilemap.tilesets.length - 1; i >= 0; i--) {
      const ts = tilemap.tilesets[i];
      if (gid >= ts.firstgid && gid - ts.firstgid < ts.tilecount) {
        counts.set(i, (counts.get(i) ?? 0) + 1);
        break;
      }
    }
  }

  if (counts.size === 0) {
    return undefined;
  }

  // Find the tileset with the highest tile count in this layer
  let bestIndex = -1;
  let bestCount = 0;
  for (const [index, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestIndex = index;
    }
  }

  return bestIndex >= 0 ? tilemap.tilesets[bestIndex] : undefined;
};

/**
 * Checks whether a layer references tiles from the given tileset.
 *
 * @param layer - The tile layer.
 * @param tileset - The tileset to check.
 * @param allTilesets - All tilesets in the map (for firstgid ordering).
 * @returns True if at least one tile in the layer comes from this tileset.
 */
const _layerReferencesTileset = (
  layer: { data: readonly number[] },
  tileset: { firstgid: number; tilecount: number },
  _allTilesets: readonly { firstgid: number; tilecount: number }[],
): boolean => {
  for (const gid of layer.data) {
    if (gid >= tileset.firstgid && gid - tileset.firstgid < tileset.tilecount) {
      return true;
    }
  }
  return false;
};
