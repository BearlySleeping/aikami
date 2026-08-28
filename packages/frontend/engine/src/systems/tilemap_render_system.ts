// packages/frontend/engine/src/systems/tilemap_render_system.ts

import { Assets, Container, Texture, UniformGroup } from 'pixi.js';
import { logger } from '$logger';
import type { TerrainLayerEmission } from '../assets/autotile.ts';
import type {
  AssetTagResolver,
  TilemapBand,
  TilemapData,
  TilemapLayer,
} from '../assets/map_loader.ts';
import { resolveGid } from '../assets/map_loader.ts';
import { WORLD_Z_BANDS } from '../rendering/layer_bands.ts';
import {
  buildTilemapChunks,
  type FrameUvResolver,
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
// C-378 AC-1: layers are grouped by their declared band (ground / decor /
// overhead) into SEPARATE containers, each with its own zIndex. Ground and
// decor render below every entity; overhead renders above the maximum
// possible entity zIndex. `chunks` spans all band containers — the culler
// iterates them without walking the scene graph.
//
// All MeshGeometry and Buffer objects are created with `autoGarbageCollect = false`
// to prevent the PixiJS v8 silent unbinding bug when chunks are temporarily
// culled from the screen.
// ---------------------------------------------------------------------------

/**
 * C-378: a UV rectangle in [0,1] atlas space.
 */
export type FrameUvRect = { u0: number; v0: number; u1: number; v1: number };

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
  /**
   * C-378: terrain layers emitted by the autotiler. When provided, these
   * frame-name layers render as the ground band (base fill + overlays in
   * precedence order).
   */
  terrainLayers?: readonly TerrainLayerEmission[];
  /**
   * C-378: frame NAME → UV rect resolver built from the pack's atlas
   * spritesheet. Required to render {@link terrainLayers}. The resolver
   * exposes the atlas source its UV rects are computed against — when it
   * does not match the sampled tileset texture, terrain chunk creation is
   * skipped so the baked ground fallback renders (never garbage UVs).
   */
  frameUvResolver?: FrameUvResolver;
  /**
   * C-434: optional registry-backed tag resolver for tileset images.
   * When provided, tileset image paths are resolved through the asset
   * registry before being loaded by PixiJS.
   */
  resolveTag?: AssetTagResolver;
  /**
   * C-434: optional blob URL release function. Called after tileset
   * images are loaded, to revoke refcounted blob URLs.
   */
  releaseUrl?: (url: string) => void;
};

export type { FrameUvResolver } from '../rendering/tilemap_chunk_renderer.ts';

/**
 * One band container from {@link TilemapRenderResult}.
 */
export type TilemapBandContainer = {
  /** Band this container renders. */
  band: TilemapBand;
  /** The container holding this band's chunk meshes. */
  container: Container;
  /** The zIndex to assign on the world container (C-378 AC-1). */
  zIndex: number;
  /** Chunks in this band (subset of the merged `chunks`). */
  chunks: readonly TilemapChunk[];
};

/**
 * Internal mutable variant of {@link TilemapBandContainer} — the chunk array
 * is accumulated with in-place pushes while the band is being filled, then
 * exposed readonly via the public types (no per-layer array rebuilds).
 */
type MutableBandEntry = Omit<TilemapBandContainer, 'chunks'> & { chunks: TilemapChunk[] };

/**
 * Result of rendering a tilemap into the scene.
 */
export type TilemapRenderResult = {
  /**
   * The Container holding all chunk Meshes across all bands. Add to the
   * world container. Prefer the per-band {@link bandContainers} for zIndex
   * correctness (C-378 AC-1) — this merged container exists for callers
   * that render a single z-band (legacy tests / sandbox).
   */
  container: Container;
  /** Number of layers rendered. */
  layerCount: number;
  /** Number of mesh chunks created. */
  chunkCount: number;
  /** Chunk records owned by the renderer — the culler's iteration source. */
  chunks: readonly TilemapChunk[];
  /** Uniform group the chunk meshes are actually bound to. */
  globalUniforms: UniformGroup;
  /**
   * C-378 AC-1: per-band containers with their declared zIndex. The
   * production caller adds each container to the world with its `zIndex`.
   */
  bandContainers: readonly TilemapBandContainer[];
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
  const { tilemap, layerFilter, terrainLayers, frameUvResolver, releaseUrl } = options;

  const container = new Container();
  container.label = 'tilemap-chunks';

  // Collect unique tileset images to load
  const imageSet = new Set<string>();
  for (const tileset of tilemap.tilesets) {
    imageSet.add(tileset.image);
  }

  // C-434: resolve tileset image paths through the registry when a resolver
  // is provided. The resolved URL is used for loading; the original path
  // stays as the texture cache key so Texture.from() resolves correctly.
  const imageToResolvedUrl = new Map<string, string>();
  for (const image of imageSet) {
    const resolved = options.resolveTag ? (options.resolveTag(image) ?? image) : image;
    imageToResolvedUrl.set(image, resolved);
  }

  // Load all tileset textures.
  //
  // `Assets.load(src)` caches the result keyed by `src` itself, so loading
  // straight from a resolved URL (an R2 CDN URL, not the map's raw tileset
  // path) would register the texture under that resolved URL — leaving
  // `Texture.from(image)` below (which looks up the raw path) unable to
  // find it, resolving to Texture.WHITE with a "not found in the Cache"
  // warning. `Assets.add({ alias, src })` registers the resolved URL as the
  // fetch source while keeping the raw path as the cache key, so the raw
  // path stays a valid alias for Texture.from() as the comment always
  // intended.
  const loadPromises = [...imageSet].map((image) => {
    const resolved = imageToResolvedUrl.get(image) ?? image;
    if (resolved !== image && !Assets.resolver.hasKey(image)) {
      Assets.add({ alias: image, src: resolved });
    }
    return Assets.load(image);
  });
  await Promise.all(loadPromises);

  // Release resolved blob URLs after the textures are loaded — the data
  // is now in PixiJS's texture cache and the blob URL is no longer needed.
  if (releaseUrl) {
    for (const [image, resolved] of imageToResolvedUrl) {
      if (resolved !== image) {
        releaseUrl(resolved);
      }
    }
  }

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
    uTint: { value: new Float32Array([1, 1, 1, 1]), type: 'vec4<f32>' },
  });

  // Band grouping: each rendered layer lands in exactly one band container
  // (C-378 AC-1). Ground/decor render below entities; overhead above them.
  const bands: MutableBandEntry[] = [];
  const bandContainersByKey = new Map<string, MutableBandEntry>();
  const bandZ = (band: TilemapBand): number => {
    switch (band) {
      case 'decor':
        return WORLD_Z_BANDS.tilemapDecor;
      case 'overhead':
        return WORLD_Z_BANDS.tilemapOverhead;
      default:
        // 'ground' (and any future band with no declared zIndex)
        return WORLD_Z_BANDS.tilemapGround;
    }
  };
  const bandContainerFor = (band: TilemapBand): MutableBandEntry => {
    const existing = bandContainersByKey.get(band);
    if (existing) {
      return existing;
    }
    const bandContainer = new Container();
    bandContainer.label = `tilemap-band-${band}`;
    const entry: MutableBandEntry = {
      band,
      container: bandContainer,
      zIndex: bandZ(band),
      chunks: [],
    };
    bands.push(entry);
    bandContainersByKey.set(band, entry);
    return entry;
  };

  // Render terrain layers (C-378) first — they are the ground band underlay
  // (base fill + overlays in precedence order). Track whether the terrain
  // block ACTUALLY emitted chunks: when the tileset texture is missing or
  // frame resolution fails, buildTilemapChunks yields zero chunks and the
  // baked ground layers must remain as fallback (never a blank map).
  let terrainGroundRendered = false;
  if (terrainLayers && terrainLayers.length > 0) {
    const primaryTileset = tilemap.tilesets[0];
    const texture = primaryTileset ? textureMap.get(primaryTileset.image) : undefined;
    if (texture) {
      // C-378: the terrain UV rects are computed against the resolver's
      // atlas source — they are valid only when the sampled tileset
      // texture IS that source. A mismatch (a map whose tileset image is
      // not the pack spritesheet) would sample garbage rects, so skip
      // terrain chunk creation and leave terrainGroundRendered false:
      // the baked ground layers then render as the fallback.
      if (frameUvResolver && frameUvResolver.source !== texture.source) {
        logger.warn('renderTilemap:terrain-atlas-mismatch', {
          tileset: primaryTileset?.image,
          hint: 'Frame UVs come from a different atlas than the sampled tileset — terrain chunk creation skipped; rendering the baked ground fallback (C-378).',
        });
      } else {
        const bandEntry = bandContainerFor('ground');
        for (const terrainLayer of terrainLayers) {
          const layerTilemap: TilemapData = {
            ...tilemap,
            layers: [
              {
                name: terrainLayer.name,
                width: tilemap.width,
                height: tilemap.height,
                data: [],
                frames: terrainLayer.frames,
                visible: true,
                band: 'ground',
              },
            ],
          };
          const result = buildTilemapChunks({
            tilemap: layerTilemap,
            tilesetTexture: texture,
            globalUniforms,
            frameUvResolver,
          });
          while (result.container.children.length > 0) {
            bandEntry.container.addChild(result.container.children[0]);
          }
          layerCount += 1;
          bandEntry.chunks.push(...result.chunks);
          allChunks.push(...result.chunks);
          if (result.chunks.length > 0) {
            terrainGroundRendered = true;
          }
        }
      }
    }
  }

  // Render baked layers bottom-to-top (preserve Tiled draw order).
  // C-378: when the autotiler supplied terrain layers, the baked ground
  // band is REPLACED (terrain layers render in its place) — skip
  // ground-band baked layers to avoid double-rendering the base fill.
  // Decor/overhead baked layers still render on top. The baked ground band
  // is skipped ONLY when terrain chunks really rendered — if the tileset
  // texture or frame resolution prevented terrain rendering, the baked
  // ground layers stay as the fallback.
  const hasTerrainGround = terrainGroundRendered;
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
    if (hasTerrainGround && (layer.band ?? 'ground') === 'ground') {
      continue;
    }

    // Determine which tileset(s) this layer's GIDs reference.
    // C-379 AC-9: a layer may reference MULTIPLE tilesets. Build a per-
    // tileset sub-layer for each referenced tileset — each sub-layer keeps
    // only that tileset's GIDs and renders with THAT tileset's texture, so
    // every tile samples its own tileset's frame (the old single-primary-
    // tileset binding rendered garbage when UVs came from a different
    // tileset's dimensions).
    const referencedTilesets = tilemap.tilesets.filter((ts) =>
      _layerReferencesTileset(layer, ts, tilemap.tilesets),
    );
    if (referencedTilesets.length === 0) {
      continue;
    }

    // A visible layer counts ONCE regardless of how many tilesets it
    // references — layerCount gates the real-uniform-group return path
    // (CodeRabbit review, C-379).
    layerCount += 1;

    for (const ts of referencedTilesets) {
      const texture = textureMap.get(ts.image);
      if (!texture) {
        continue;
      }

      // Build a filtered tilemap for THIS tileset: only the layer, with
      // every GID that does NOT resolve to this tileset zeroed out (empty
      // tile). Resolution goes through the shared resolveGid (highest
      // firstgid wins), so overlapping tileset ranges follow the SAME
      // convention as every other GID consumer. Flip flags ride along —
      // the flips array stays index-parallel to the zeroed data and is
      // passed through WITHOUT copying (C-379 AC-9, CodeRabbit review).
      const subLayer: TilemapLayer = {
        ...layer,
        data: layer.data.map((gid) => {
          if (gid === 0) {
            return 0;
          }
          const resolved = resolveGid(gid, tilemap.tilesets);
          return resolved && resolved.tileset.firstgid === ts.firstgid ? gid : 0;
        }),
        flips: layer.flips,
      };
      const layerTilemap: TilemapData = {
        ...tilemap,
        layers: [subLayer],
        // Only this tileset participates — UV lookup for non-zero GIDs is
        // guaranteed to resolve against `ts`.
        tilesets: [ts],
      };

      const result = buildTilemapChunks({
        tilemap: layerTilemap,
        tilesetTexture: texture,
        globalUniforms,
      });

      // Merge chunk children into the layer's band container
      const bandEntry = bandContainerFor(layer.band ?? 'ground');
      while (result.container.children.length > 0) {
        bandEntry.container.addChild(result.container.children[0]);
      }

      bandEntry.chunks.push(...result.chunks);
      allChunks.push(...result.chunks);
    }
  }

  // The merged container keeps all bands as children for callers that use
  // a single z-band (legacy tests / sandbox). The per-band containers are
  // the production path (C-378 AC-1).
  for (const band of bands) {
    container.addChild(band.container);
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
      bandContainers: bands,
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
      uTint: { value: new Float32Array([1, 1, 1, 1]), type: 'vec4<f32>' },
    }),
    bandContainers: bands,
  };
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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
