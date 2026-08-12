// packages/frontend/engine/src/systems/tilemap_render_system.ts

import { Assets, Container, Texture, UniformGroup } from 'pixi.js';
import type { TilemapData } from '../assets/map_loader.ts';
import {
  buildTilemapChunks,
  frustumCullChunks,
  type TilemapChunk,
} from '../rendering/tilemap_chunk_renderer.ts';

// ---------------------------------------------------------------------------
// Tilemap Rendering System — chunk-based Mesh pipeline
//
// The map is divided into 32×32 tile chunks, each rendered as a single
// PixiJS `Mesh` backed by `Float32Array` vertex/UV buffers and
// `Uint32Array` index buffers.
//
// CPU-side frustum culling (via {@link frustumCullChunks}) toggles
// `mesh.visible` on the owned chunk records — no scene-graph mutation,
// so chunks return when the camera comes back (C-377 AC-4).
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
  /** Chunk records owned by the renderer — the culler's iteration source. */
  chunks: readonly TilemapChunk[];
  /** Uniform group the chunk meshes are actually bound to. */
  globalUniforms: UniformGroup;
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
 * The returned `globalUniforms` is the uniform group the chunk meshes are
 * actually bound to, for every layer ordering (C-377 AC-5) — never a fresh
 * unbound placeholder. `chunks` carries the owned chunk records for the
 * culler.
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
  for (const tileset of tilemap.tilesets) {
    imageSet.add(tileset.image);
  }

  // Load all tileset textures.
  // Asset URLs are resolved by the global resolver (Assets.resolver.rootPath
  // handles custom-scheme/Tauri origins), so the raw path stays a valid cache
  // alias for Texture.from() below.
  const loadPromises = [...imageSet].map((image) => Assets.load(image));
  await Promise.all(loadPromises);

  // Build a texture map keyed by image path
  const textureMap = new Map<string, Texture>();
  for (const image of imageSet) {
    const texture = Texture.from(image);
    textureMap.set(image, texture);
  }

  let layerCount = 0;
  const allChunks: TilemapChunk[] = [];
  // ONE shared uniform group for every chunk of every layer (C-377 AC-5) —
  // the returned group is always reference-identical to the group bound in
  // `chunks[i].mesh.shader.resources.globals`, for every layer ordering.
  const globalUniforms = new UniformGroup({
    uTransformMatrix: { value: new Float32Array(9), type: 'mat3x3<f32>' },
    uTime: { value: 0, type: 'f32' },
  });

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
      globalUniforms,
    });

    // Merge chunk children into the main container
    while (result.container.children.length > 0) {
      container.addChild(result.container.children[0]);
    }

    layerCount += 1;
    allChunks.push(...result.chunks);
  }

  // The uniform group the chunks are actually bound to (C-377 AC-5). When
  // at least one layer rendered, this is the real shared group. Only a
  // fully empty map (no rendered layers → no chunks) gets a fresh
  // placeholder, which is unbound only because there is nothing to bind it
  // to.
  if (layerCount > 0) {
    return {
      container,
      layerCount,
      chunkCount: allChunks.length,
      chunks: allChunks,
      globalUniforms,
    };
  }

  // Fallback (empty map — no rendered layers)
  return {
    container,
    layerCount,
    chunkCount: 0,
    chunks: [],
    globalUniforms: new UniformGroup({
      uTransformMatrix: { value: new Float32Array(9), type: 'mat3x3<f32>' },
      uTime: { value: 0, type: 'f32' },
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
