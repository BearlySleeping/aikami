// packages/frontend/engine/src/rendering/tilemap_chunk_renderer.ts

import {
  Container,
  GlProgram,
  Mesh,
  MeshGeometry,
  Shader,
  type Texture,
  type TextureSource,
  UniformGroup,
} from 'pixi.js';
import type { TilemapData, TilemapTileset } from '../assets/map_loader.ts';

// ---------------------------------------------------------------------------
// TilemapChunkRenderer — chunked tilemap Mesh pipeline
//
// The map is divided into uniform 32×32 tile chunks; each chunk is a
// single PixiJS `Mesh` backed by `Float32Array` position/UV buffers and
// a `Uint32Array` index buffer. CPU-side frustum culling toggles
// `mesh.visible` based on the camera AABB — chunks are NEVER reparented,
// so the scene graph stays stable across camera pans.
//
// GC Mitigation: `autoGarbageCollect = false` on every `MeshGeometry`
// and its position/UV buffers (PixiJS v8 unbinding bug guard).
//
// Shader: GLSL only (WebGL2). The WGSL/WebGPU path was removed in C-377 —
// it never executed (nothing selects WebGPU), and a correct WGSL port
// needs the @group(0) global uniform layout that differs between PixiJS
// minor versions. `rendererPreference` stays in the options type, but the
// renderer is WebGL2.
// ---------------------------------------------------------------------------

const TILEMAP_CHUNK_GLSL_VERTEX = /* glsl */ `#version 300 es

  in vec2 aPosition;
  in vec2 aUV;
  in float aTextureLayer;

  out vec2 vUV;
  out float vLayer;

  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform mat3 uTransformMatrix;

  void main(void) {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
    vLayer = aTextureLayer;
  }
`;

const TILEMAP_CHUNK_GLSL_FRAGMENT = /* glsl */ `#version 300 es
  precision highp float;

  in vec2 vUV;
  in float vLayer;

  uniform sampler2D uTexture;
  uniform vec4 uTint;

  out vec4 fragColor;

  void main(void) {
    vec4 tex = texture(uTexture, vUV);
    // C-378 AC-9: day/night tint — the same factor the rest of the scene
    // uses. A fully-neutral factor (1,1,1,1) is pixel-identical to an
    // untinted render (tex * 1 = tex).
    fragColor = vec4(tex.rgb * uTint.rgb, tex.a);
    // aTextureLayer is supplied by the geometry (C-177) for the (removed)
    // WGSL texture-array path. The GLSL fallback is static — textureLayers
    // are always 0 — but referencing vLayer keeps the attribute active in
    // the compiled program and silences PixiJS's "attribute not present in
    // the shader" warning.
    if (vLayer != 0.0) {
      fragColor = vec4(0.0);
    }
  }
`;

/** Cached GlProgram instance — created once and reused by all chunks. */
let _cachedGlProgram: GlProgram | undefined;

/**
 * Returns a shared GlProgram for all tilemap chunks.
 *
 * Created lazily on first call and cached. All chunks share the same
 * GLSL source — only geometry and texture differ.
 */
const _getSharedGlProgram = (): GlProgram => {
  if (!_cachedGlProgram) {
    _cachedGlProgram = GlProgram.from({
      vertex: TILEMAP_CHUNK_GLSL_VERTEX,
      fragment: TILEMAP_CHUNK_GLSL_FRAGMENT,
      name: 'tilemap-chunk',
    });
  }
  return _cachedGlProgram;
};

/** Tiles per chunk side (32×32 = 1024 tiles per chunk). */
const CHUNK_SIZE = 32;

/** Overdraw margin in pixels — chunks this far outside the viewport are kept visible. */
const OVERDRAW_MARGIN = 64;

/** Vertices per tile quad (4 corners). */
const VERTS_PER_TILE = 4;

/** Indices per tile quad (2 triangles × 3 vertices). */
const INDICES_PER_TILE = 6;

/** Position components per vertex (x, y). */
const POS_COMPONENTS = 2;

/** UV components per vertex (u, v). */
const UV_COMPONENTS = 2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A uniform 32×32 tile chunk backed by a PixiJS Mesh.
 *
 * The chunk owns its MeshGeometry and Mesh. Frustum culling toggles
 * `mesh.visible` — the Mesh is never removed from / re-added to the
 * scene graph, keeping `container.children` stable across camera pans.
 */
export type TilemapChunk = {
  /** Chunk grid X (column index in chunk-space). */
  gridX: number;
  /** Chunk grid Y (row index in chunk-space). */
  gridY: number;
  /** The tile layer this chunk was built from. */
  layerName: string;
  /** The PixiJS Mesh for this chunk (GLSL shader, not TextureShader). */
  mesh: Mesh<MeshGeometry, Shader>;
  /** The MeshGeometry holding the position/UV/index buffers. */
  geometry: MeshGeometry;
  /** World-space pixel bounds (for frustum culling). */
  bounds: { x: number; y: number; width: number; height: number };
};

/**
 * Options for constructing a chunked tilemap.
 */
export type TilemapChunkRendererOptions = {
  /** The parsed tilemap data from {@link loadTilemap}. */
  tilemap: TilemapData;
  /** The loaded tileset texture (2D image). */
  tilesetTexture: Texture;
  /**
   * Optional shared uniform group. When provided, all chunks bind this
   * group — used by {@link renderTilemap} so every layer of a map shares
   * ONE group (C-377 AC-5). When omitted, a fresh group is created and
   * returned (direct callers).
   */
  globalUniforms?: UniformGroup;
  /**
   * C-378: resolves a frame NAME to a UV rect for terrain layers. The
   * autotiler emits layers whose cells hold frame names (never GIDs); the
   * caller builds this resolver from the pack's atlas spritesheet. When
   * absent, terrain frame layers render nothing (degraded but safe).
   */
  frameUvResolver?: FrameUvResolver;
};

/**
 * Result of building the chunked tilemap mesh pipeline.
 *
 * Carries the owned chunk records so the culler can iterate them without
 * walking the scene graph (C-377 AC-4).
 */
export type TilemapChunkRenderResult = {
  /** A Container holding all chunk Meshes. Add to the world container. */
  container: Container;
  /** Number of chunks created. */
  chunkCount: number;
  /** Chunk records owned by the renderer — the culler's iteration source. */
  chunks: readonly TilemapChunk[];
  /** Global uniform group the chunk meshes are bound to. */
  globalUniforms: UniformGroup;
};

// ---------------------------------------------------------------------------
// TilemapChunkRenderer
// ---------------------------------------------------------------------------

/**
 * Builds a chunked tilemap from parsed tilemap data.
 *
 * Divides the map into 32×32 tile chunks, creates a PixiJS Mesh per
 * chunk with pre-allocated Float32Array position/UV buffers and
 * Uint32Array index buffers. Applies autoGarbageCollect = false on
 * all geometry and buffer objects (PixiJS v8 GC mitigation).
 *
 * All chunks of a layer share ONE Shader (identical GLSL source, texture
 * and uniform group) — per-chunk Shader allocation was removed in C-377.
 *
 * The returned Container holds all chunk Meshes. Frustum culling is
 * performed externally via {@link frustumCullChunks}.
 *
 * @param options - Tilemap data and tileset texture.
 * @returns A container with all chunk meshes and chunk metadata.
 */
export const buildTilemapChunks = (
  options: TilemapChunkRendererOptions,
): TilemapChunkRenderResult => {
  const { tilemap, tilesetTexture, frameUvResolver } = options;

  const container = new Container();
  container.label = 'tilemap-chunks';

  // Compute chunk grid dimensions
  const chunksX = Math.ceil(tilemap.width / CHUNK_SIZE);
  const chunksY = Math.ceil(tilemap.height / CHUNK_SIZE);

  const tilePixelW = tilemap.tilewidth;
  const tilePixelH = tilemap.tileheight;

  // Build tileset frame lookup (GID → UV rectangle)
  const tilesetEntries = _buildTilesetEntries(tilemap.tilesets);

  // Global Uniforms for time. renderTilemap passes ONE shared group so all
  // layers of a map bind the same group (C-377 AC-5); direct callers get a
  // fresh group returned here.
  const globalUniforms =
    options.globalUniforms ??
    new UniformGroup({
      uTransformMatrix: { value: new Float32Array(9), type: 'mat3x3<f32>' },
      uTime: { value: 0, type: 'f32' },
      uTint: { value: new Float32Array([1, 1, 1, 1]), type: 'vec4<f32>' },
    });

  // ONE shared Shader for this renderer call (per layer when called from
  // renderTilemap, which builds one layer at a time).
  const shader = new Shader({
    glProgram: _getSharedGlProgram(),
    resources: {
      globals: globalUniforms,
      uTexture: tilesetTexture.source,
      uSampler: tilesetTexture.source.style,
    },
  });

  const chunks: TilemapChunk[] = [];

  // Process visible non-collision layers
  for (const layer of tilemap.layers) {
    if (!layer.visible) {
      continue;
    }
    if (layer.name === 'collision') {
      continue;
    }

    // For each chunk in this layer
    for (let cy = 0; cy < chunksY; cy++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const chunk = _buildChunk({
          layer,
          chunkGridX: cx,
          chunkGridY: cy,
          tilemap,
          tilesetEntries,
          tilePixelW,
          tilePixelH,
          shader,
          frameUvResolver,
        });

        if (chunk) {
          container.addChild(chunk.mesh);
          chunks.push(chunk);
        }
      }
    }
  }

  return { container, chunkCount: chunks.length, chunks, globalUniforms };
};

// ---------------------------------------------------------------------------
// Frustum culling
// ---------------------------------------------------------------------------

/**
 * Applies CPU-side frustum culling to an owned chunk array.
 *
 * Chunks whose world-space bounds fall outside the camera AABB (plus
 * overdraw margin) are hidden via `mesh.visible = false`. Chunks that
 * enter the viewport are shown again. The scene graph is NEVER mutated —
 * `container.children` stays constant for the life of the map, so a
 * chunk that leaves the viewport is always discoverable when the camera
 * returns (C-377 AC-4 — the pre-contract culler removed children and
 * permanently lost them).
 *
 * @param chunks - The owned chunk records (from {@link TilemapChunkRenderResult.chunks}).
 * @param cameraX - Camera X position (world-space, top-left of viewport).
 * @param cameraY - Camera Y position (world-space, top-left of viewport).
 * @param viewportWidth - Width of the viewport in world-space pixels.
 * @param viewportHeight - Height of the viewport in world-space pixels.
 * @returns Counts of visible vs total chunks for render diagnostics.
 */
export const frustumCullChunks = (
  chunks: readonly TilemapChunk[],
  cameraX: number,
  cameraY: number,
  viewportWidth: number,
  viewportHeight: number,
): { visible: number; total: number } => {
  // Viewport AABB with overdraw margin (world pixels)
  const vpLeft = cameraX - OVERDRAW_MARGIN;
  const vpRight = cameraX + viewportWidth + OVERDRAW_MARGIN;
  const vpTop = cameraY - OVERDRAW_MARGIN;
  const vpBottom = cameraY + viewportHeight + OVERDRAW_MARGIN;

  let visible = 0;

  for (const chunk of chunks) {
    const { bounds } = chunk;

    // AABB intersection test
    const overlaps =
      bounds.x < vpRight &&
      bounds.x + bounds.width > vpLeft &&
      bounds.y < vpBottom &&
      bounds.y + bounds.height > vpTop;

    chunk.mesh.visible = overlaps;
    if (overlaps) {
      visible += 1;
    }
  }

  return { visible, total: chunks.length };
};

// ---------------------------------------------------------------------------
// Internal: Chunk builder
// ---------------------------------------------------------------------------

/**
 * A resolved tileset entry with a GID → UV rectangle lookup function.
 */
type TilesetEntry = TilemapTileset & {
  /** Computed UV rectangle for a given local tile ID. */
  getUvRect: (localId: number) => { u0: number; v0: number; u1: number; v1: number };
};

/**
 * Builds tileset lookup entries from the tilemap's tileset array.
 *
 * C-378 AC-5: exact UV rects are used only for tilesets CONFIRMED to have
 * atlas extrusion (Tiled `spacing`/`margin` > 0 — the emberwatch atlas
 * packs at 34px pitch with a 1px extruded border). Tight-packed tilesets
 * (spacing 0 AND margin 0, no extrusion) get a half-texel inset so the
 * sampler never bleeds into an adjacent frame.
 */
const _buildTilesetEntries = (tilesets: readonly TilemapTileset[]): TilesetEntry[] => {
  return tilesets.map((ts) => {
    const { tilewidth, tileheight, columns, spacing = 0, margin = 0, imagewidth, imageheight } = ts;

    // C-378 AC-5: exact UV rects are safe ONLY when the atlas layout
    // guarantees a gutter or extrusion border around every frame (Tiled
    // `spacing`/`margin` > 0 — e.g. the emberwatch atlas: 34px pitch with
    // a 1px extruded border). A tight-packed tileset (spacing 0 AND
    // margin 0 — frames flush edge-to-edge, no extrusion) bleeds into the
    // adjacent frame at the boundary; the half-texel inset keeps the
    // sampler inside the frame's own pixels.
    const extruded = spacing > 0 || margin > 0;
    const inset = extruded ? 0 : 0.5;

    const getUvRect = (localId: number): { u0: number; v0: number; u1: number; v1: number } => {
      const col = localId % columns;
      const row = Math.floor(localId / columns);
      const px = margin + col * (tilewidth + spacing);
      const py = margin + row * (tileheight + spacing);
      return {
        u0: (px + inset) / imagewidth,
        v0: (py + inset) / imageheight,
        u1: (px + tilewidth - inset) / imagewidth,
        v1: (py + tileheight - inset) / imageheight,
      };
    };

    return { ...ts, getUvRect };
  });
};

/**
 * Resolves a global tile ID to a tileset entry + local ID.
 *
 * @param gid - The global tile ID.
 * @param entries - The sorted tileset entries.
 * @returns The matching entry and local ID, or undefined if GID is 0 or unmatched.
 */
const _resolveGid = (
  gid: number,
  entries: readonly TilesetEntry[],
): { entry: TilesetEntry; localId: number } | undefined => {
  if (gid === 0) {
    return undefined;
  }

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (gid >= entry.firstgid) {
      const localId = gid - entry.firstgid;
      if (localId < entry.tilecount) {
        return { entry, localId };
      }
      break;
    }
  }

  return undefined;
};

/**
 * C-378: a frame NAME → UV rect resolver bound to ONE atlas source.
 *
 * The UV rects are computed against {@link source}; chunk sampling must
 * bind the SAME texture source or the rects land on the wrong pixels.
 */
export type FrameUvResolver = {
  /** Atlas texture source the UV rects are computed against. */
  source: TextureSource;
  /** Resolves a frame name to an exact UV rect in {@link source}. */
  resolve: (frame: string) => { u0: number; v0: number; u1: number; v1: number } | undefined;
};

/**
 * Options for building a single chunk.
 */
type BuildChunkOptions = {
  /** The tile layer to read from (GIDs via `data` OR frame names via `frames`). */
  layer: {
    width: number;
    height: number;
    data?: readonly number[];
    frames?: readonly (string | 0)[];
    name: string;
  };
  /** Chunk grid X (column). */
  chunkGridX: number;
  /** Chunk grid Y (row). */
  chunkGridY: number;
  /** Full tilemap data. */
  tilemap: TilemapData;
  /** Resolved tileset entries with UV lookup. */
  tilesetEntries: TilesetEntry[];
  /** Tile pixel width. */
  tilePixelW: number;
  /** Tile pixel height. */
  tilePixelH: number;
  /** Shared Shader for all chunks of this layer. */
  shader: Shader;
  /** C-378: frame-name → UV resolver for terrain layers. */
  frameUvResolver?: FrameUvResolver;
};

/**
 * Builds a single 32×32 tile chunk Mesh with geometry buffers.
 *
 * Creates a MeshGeometry with pre-allocated Float32Array position/UV
 * buffers and Uint32Array index buffer. Sets autoGarbageCollect = false
 * on the geometry and all buffer objects (C-171 AC-3 GC mitigation).
 *
 * All chunks share the layer's Shader (C-377) — geometry is the only
 * per-chunk allocation.
 *
 * @returns The chunk metadata, or undefined if the chunk has no visible tiles.
 */
const _buildChunk = (options: BuildChunkOptions): TilemapChunk | undefined => {
  const {
    layer,
    chunkGridX,
    chunkGridY,
    tilemap,
    tilesetEntries,
    tilePixelW,
    tilePixelH,
    shader,
    frameUvResolver,
  } = options;

  // Compute tile range for this chunk
  const tileStartX = chunkGridX * CHUNK_SIZE;
  const tileStartY = chunkGridY * CHUNK_SIZE;
  const tileEndX = Math.min(tileStartX + CHUNK_SIZE, tilemap.width);
  const tileEndY = Math.min(tileStartY + CHUNK_SIZE, tilemap.height);

  // Per-cell UV resolution: GID layers resolve through the tileset grid;
  // C-378 terrain layers resolve frame names through the atlas resolver.
  // A frame-name layer with no resolver has no resolvable cells.
  const isFrameLayer = layer.frames !== undefined;
  const resolveUv = (
    index: number,
  ): { u0: number; v0: number; u1: number; v1: number } | undefined => {
    if (isFrameLayer) {
      const frame = layer.frames?.[index];
      if (!frame || !frameUvResolver) {
        return undefined;
      }
      return frameUvResolver.resolve(frame);
    }
    const gid = layer.data?.[index] ?? 0;
    if (gid === 0) {
      return undefined;
    }
    const resolved = _resolveGid(gid, tilesetEntries);
    if (!resolved) {
      return undefined;
    }
    return resolved.entry.getUvRect(resolved.localId);
  };

  // Resolve each cell ONCE: cache non-empty UV results in the counting pass
  // and reuse them while filling — avoids a second resolver call (and a
  // second UV object allocation) per active cell (C-378 performance pass).
  const resolvedUvs = new Map<number, { u0: number; v0: number; u1: number; v1: number }>();
  for (let row = tileStartY; row < tileEndY; row++) {
    for (let col = tileStartX; col < tileEndX; col++) {
      const index = row * layer.width + col;
      const uv = resolveUv(index);
      if (uv) {
        resolvedUvs.set(index, uv);
      }
    }
  }
  const activeTileCount = resolvedUvs.size;

  if (activeTileCount === 0) {
    return undefined;
  }

  // Allocate buffers for active tiles
  const vertexCount = activeTileCount * VERTS_PER_TILE;
  const positions = new Float32Array(vertexCount * POS_COMPONENTS);
  const uvs = new Float32Array(vertexCount * UV_COMPONENTS);
  const textureLayers = new Float32Array(vertexCount); // (C-177: 1 float per vertex)
  const indices = new Uint32Array(activeTileCount * INDICES_PER_TILE);

  // Fill buffers
  let vi = 0; // vertex index
  let ii = 0; // index index

  for (let row = tileStartY; row < tileEndY; row++) {
    for (let col = tileStartX; col < tileEndX; col++) {
      const dataIndex = row * layer.width + col;
      const uv = resolvedUvs.get(dataIndex);
      if (!uv) {
        continue;
      }

      // World-space pixel position of this tile
      const px = col * tilePixelW;
      const py = row * tilePixelH;

      // Write 4 vertices (quad corners)
      const posOffset = vi * POS_COMPONENTS;
      const uvOffset = vi * UV_COMPONENTS;

      // Top-left
      positions[posOffset] = px;
      positions[posOffset + 1] = py;
      uvs[uvOffset] = uv.u0;
      uvs[uvOffset + 1] = uv.v0;
      textureLayers[vi] = 0;

      // Top-right
      positions[posOffset + 2] = px + tilePixelW;
      positions[posOffset + 3] = py;
      uvs[uvOffset + 2] = uv.u1;
      uvs[uvOffset + 3] = uv.v0;
      textureLayers[vi + 1] = 0;

      // Bottom-right
      positions[posOffset + 4] = px + tilePixelW;
      positions[posOffset + 5] = py + tilePixelH;
      uvs[uvOffset + 4] = uv.u1;
      uvs[uvOffset + 5] = uv.v1;
      textureLayers[vi + 2] = 0;

      // Bottom-left
      positions[posOffset + 6] = px;
      positions[posOffset + 7] = py + tilePixelH;
      uvs[uvOffset + 6] = uv.u0;
      uvs[uvOffset + 7] = uv.v1;
      textureLayers[vi + 3] = 0;

      // Write 6 indices (2 triangles)
      const baseVertex = vi;
      indices[ii] = baseVertex;
      indices[ii + 1] = baseVertex + 1;
      indices[ii + 2] = baseVertex + 2;
      indices[ii + 3] = baseVertex;
      indices[ii + 4] = baseVertex + 2;
      indices[ii + 5] = baseVertex + 3;

      vi += VERTS_PER_TILE;
      ii += INDICES_PER_TILE;
    }
  }

  // Create MeshGeometry with raw typed arrays.
  const geometry = new MeshGeometry({
    positions,
    uvs,
    indices,
  });

  // (C-177) Add custom attribute aTextureLayer
  geometry.addAttribute('aTextureLayer', textureLayers);

  // ── C-171 AC-3: GC Mitigation ──
  // Prevent the PixiJS v8 silent unbinding bug when chunks are
  // temporarily culled from the screen and then re-added.
  geometry.autoGarbageCollect = false;

  // PixiJS v8 names position attribute 'aPosition' and UV 'aUV'
  const posBuffer = geometry.getBuffer('aPosition');
  if (posBuffer) {
    posBuffer.autoGarbageCollect = false;
  }

  const uvBuffer = geometry.getBuffer('aUV');
  if (uvBuffer) {
    uvBuffer.autoGarbageCollect = false;
  }

  const textureLayerBuffer = geometry.getBuffer('aTextureLayer');
  if (textureLayerBuffer) {
    textureLayerBuffer.autoGarbageCollect = false;
  }

  if (geometry.indexBuffer) {
    geometry.indexBuffer.autoGarbageCollect = false;
  }

  // The Mesh uses the layer's shared Shader (C-377 AC-6: glProgram only —
  // the WGSL/WebGPU path is deleted).
  const mesh = new Mesh({
    geometry,
    shader,
  });

  mesh.label = `chunk-${layer.name}-${chunkGridX}-${chunkGridY}`;
  mesh.eventMode = 'none';

  // Compute world-space pixel bounds for frustum culling
  const bounds = {
    x: tileStartX * tilePixelW,
    y: tileStartY * tilePixelH,
    width: (tileEndX - tileStartX) * tilePixelW,
    height: (tileEndY - tileStartY) * tilePixelH,
  };

  return {
    gridX: chunkGridX,
    gridY: chunkGridY,
    layerName: layer.name,
    mesh,
    geometry,
    bounds,
  };
};

export { CHUNK_SIZE, OVERDRAW_MARGIN };
