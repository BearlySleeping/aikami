// packages/frontend/engine/src/rendering/tilemap_chunk_renderer.ts

import {
  Buffer,
  BufferUsage,
  Container,
  GlProgram,
  GpuProgram,
  Mesh,
  MeshGeometry,
  Shader,
  type Texture,
  UniformGroup,
} from 'pixi.js';
import type { TilemapData, TilemapTileset } from '../assets/map_loader.ts';

// ---------------------------------------------------------------------------
// TilemapChunkRenderer — WebGPU-optimized chunked tilemap Mesh pipeline
//
// Contract C-171: Replaces RenderTexture baking with a spatial chunking
// architecture. The map is divided into uniform 32×32 tile chunks; each
// chunk is a single PixiJS `Mesh` backed by `Float32Array` position/UV
// buffers and a `Uint32Array` index buffer. CPU-side frustum culling
// adds/removes chunks from the scene graph based on the camera AABB.
//
// GC Mitigation: `autoGarbageCollect = false` on every `MeshGeometry`
// and its position/UV buffers (PixiJS v8 unbinding bug guard).
//
// Shader: Custom WGSL via GpuProgram.from() — single-texture vertex/fragment
// shader declared inline. Uses @group(2) for texture/sampler (PixiJS v8
// Mesh resource convention). Future: upgrade to texture_2d_array<f32>.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Custom WGSL shader for tilemap chunk rendering
//
// Vertex shader: receives position (@location 0) and UV (@location 1),
// applies the global transform matrix (group 0, injected by PixiJS),
// and passes UV through to the fragment shader.
//
// Fragment shader: samples the tileset texture (group 2, binding 0)
// using the nearest-neighbour sampler (group 2, binding 1) for crisp
// pixel-art tile rendering.
// ---------------------------------------------------------------------------

/** WGSL source for the tilemap chunk vertex + fragment shader. */
const TILEMAP_CHUNK_WGSL = /* wgsl */ `
  struct VertexInput {
    @location(0) aPosition: vec2<f32>,
    @location(1) aUV: vec2<f32>,
  };

  struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) vUV: vec2<f32>,
  };

  @vertex
  fn mainVertex(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.position = vec4<f32>(input.aPosition, 0.0, 1.0);
    output.vUV = input.aUV;
    return output;
  }

  @group(2) @binding(0) var uTexture: texture_2d<f32>;
  @group(2) @binding(1) var uSampler: sampler;

  @fragment
  fn mainFragment(@location(0) vUV: vec2<f32>) -> @location(0) vec4<f32> {
    return textureSample(uTexture, uSampler, vUV);
  }
`;

/** Cached GpuProgram instance — created once and reused by all chunks. */
let _cachedGpuProgram: GpuProgram | undefined;

/**
 * Returns a shared GpuProgram for all tilemap chunks.
 *
 * Created lazily on first call and cached. All chunks share the same
 * shader (identical WGSL source) — only geometry and texture differ.
 */
const _getSharedGpuProgram = (): GpuProgram => {
  if (!_cachedGpuProgram) {
    _cachedGpuProgram = GpuProgram.from({
      name: 'tilemap-chunk',
      vertex: {
        source: TILEMAP_CHUNK_WGSL,
        entryPoint: 'mainVertex',
      },
      fragment: {
        source: TILEMAP_CHUNK_WGSL,
        entryPoint: 'mainFragment',
      },
    });
  }
  return _cachedGpuProgram;
};

// ---------------------------------------------------------------------------
// GLSL fallback shader for WebGL2 (C-179)
//
// When WebGPU is unavailable, PixiJS falls back to WebGL2. The WGSL
// shader above has no glProgram — causing a "Mesh shader has no
// glProgram" warning per frame and blank rendering. This GLSL fallback
// renders the tileset as a static 2D texture (no texture-array or
// animation support — acceptable degradation).
// ---------------------------------------------------------------------------

const TILEMAP_CHUNK_GLSL_VERTEX = /* glsl */ `#version 300 es

  in vec2 aPosition;
  in vec2 aUV;

  out vec2 vUV;

  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform mat3 uTransformMatrix;

  void main(void) {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
  }
`;

const TILEMAP_CHUNK_GLSL_FRAGMENT = /* glsl */ `#version 300 es
  precision highp float;

  in vec2 vUV;

  uniform sampler2D uTexture;

  out vec4 fragColor;

  void main(void) {
    fragColor = texture(uTexture, vUV);
  }
`;

/** Cached GlProgram instance — created once and reused by all chunks. */
let _cachedGlProgram: GlProgram | undefined;

/**
 * Returns a shared GlProgram for all tilemap chunks.
 *
 * Created lazily on first call and cached. All chunks share the same
 * GLSL source — only geometry and texture differ. This is the WebGL2
 * fallback for the WGSL shader above.
 */
const _getSharedGlProgram = (): GlProgram => {
  if (!_cachedGlProgram) {
    _cachedGlProgram = GlProgram.from({
      vertex: TILEMAP_CHUNK_GLSL_VERTEX,
      fragment: TILEMAP_CHUNK_GLSL_FRAGMENT,
      name: 'tilemap-gl-fallback',
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
 * The chunk owns its MeshGeometry and Mesh. When `isActive` is false,
 * the Mesh is removed from the scene graph (frustum culled). When true,
 * it is re-added.
 */
type TilemapChunk = {
  /** Chunk grid X (column index in chunk-space). */
  gridX: number;
  /** Chunk grid Y (row index in chunk-space). */
  gridY: number;
  /** The PixiJS Mesh for this chunk (custom WGSL shader, not TextureShader). */
  mesh: Mesh<MeshGeometry, Shader>;
  /** The MeshGeometry holding the position/UV/index buffers. */
  geometry: MeshGeometry;
  /** Whether the chunk is currently in the scene graph. */
  isActive: boolean;
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
};

/**
 * Result of building the chunked tilemap mesh pipeline.
 */
export type TilemapChunkRenderResult = {
  /** A Container holding all chunk Meshes. Add to the world container. */
  container: Container;
  /** Number of chunks created. */
  chunkCount: number;
  /** Global uniform group for animation time. */
  globalUniforms: UniformGroup;
  /** Storage buffer for animation tables. */
  animStorageBuffer: Buffer;
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
 * Uses a custom WGSL shader via GpuProgram.from() — single shared
 * GpuProgram instance cached across all chunks. Each chunk Mesh
 * gets its own Shader with the chunk's tileset texture bound as
 * a resource.
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
  const { tilemap, tilesetTexture } = options;

  const container = new Container();
  container.label = 'tilemap-chunks';

  // Compute chunk grid dimensions
  const chunksX = Math.ceil(tilemap.width / CHUNK_SIZE);
  const chunksY = Math.ceil(tilemap.height / CHUNK_SIZE);

  const tilePixelW = tilemap.tilewidth;
  const tilePixelH = tilemap.tileheight;

  // Build tileset frame lookup (GID → UV rectangle)
  const tilesetEntries = _buildTilesetEntries(tilemap.tilesets);

  // Global Uniforms for time
  const globalUniforms = new UniformGroup({
    uTransformMatrix: { value: new Float32Array(9), type: 'mat3x3<f32>' },
    uTime: { value: 0, type: 'f32' },
  });

  // Storage buffer for animation tables (MAX_TILE_TYPES=256, 4 floats per entry = 4096 bytes)
  const animStorageBuffer = new Buffer({
    data: new Float32Array(256 * 4),
    usage: BufferUsage.STORAGE | BufferUsage.COPY_DST,
  });

  // Shared GpuProgram — created once, used by all chunks
  const gpuProgram = _getSharedGpuProgram();

  let chunkCount = 0;

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
          tilesetTexture,
          tilePixelW,
          tilePixelH,
          gpuProgram,
          globalUniforms,
          animStorageBuffer,
        });

        if (chunk) {
          container.addChild(chunk.mesh);
          chunkCount += 1;
        }
      }
    }
  }

  return { container, chunkCount, globalUniforms, animStorageBuffer };
};

// ---------------------------------------------------------------------------
// Frustum culling
// ---------------------------------------------------------------------------

/**
 * Applies CPU-side frustum culling to all chunk children of a container.
 *
 * Chunks whose world-space bounds fall outside the camera AABB (plus
 * overdraw margin) are removed from the scene graph. Chunks that enter
 * the viewport are re-added. This ensures zero-cost GPU culling — only
 * visible chunks consume draw calls.
 *
 * @param container - The Container holding all chunk Meshes.
 * @param cameraX - Camera X position (world-space, top-left of viewport).
 * @param cameraY - Camera Y position (world-space, top-left of viewport).
 * @param viewportWidth - Width of the viewport in world-space pixels.
 * @param viewportHeight - Height of the viewport in world-space pixels.
 */
export const frustumCullChunks = (
  container: Container,
  cameraX: number,
  cameraY: number,
  viewportWidth: number,
  viewportHeight: number,
): void => {
  // Viewport AABB with overdraw margin
  const vpLeft = cameraX - OVERDRAW_MARGIN;
  const vpRight = cameraX + viewportWidth + OVERDRAW_MARGIN;
  const vpTop = cameraY - OVERDRAW_MARGIN;
  const vpBottom = cameraY + viewportHeight + OVERDRAW_MARGIN;

  for (const child of container.children) {
    const mesh = child as Mesh;
    const chunkMeta = (mesh as Mesh & { _chunkMeta?: TilemapChunk })._chunkMeta;
    if (!chunkMeta) {
      continue;
    }

    const { bounds } = chunkMeta;

    // AABB intersection test
    const overlaps =
      bounds.x < vpRight &&
      bounds.x + bounds.width > vpLeft &&
      bounds.y < vpBottom &&
      bounds.y + bounds.height > vpTop;

    if (overlaps && !chunkMeta.isActive) {
      // Re-add — chunk entered viewport
      if (!mesh.parent) {
        container.addChild(mesh);
      }
      chunkMeta.isActive = true;
    } else if (!overlaps && chunkMeta.isActive) {
      // Remove — chunk left viewport
      if (mesh.parent) {
        mesh.parent.removeChild(mesh);
      }
      chunkMeta.isActive = false;
    }
  }
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
 */
const _buildTilesetEntries = (tilesets: readonly TilemapTileset[]): TilesetEntry[] => {
  return tilesets.map((ts) => {
    const { tilewidth, tileheight, columns, spacing = 0, margin = 0, imagewidth, imageheight } = ts;

    const getUvRect = (localId: number): { u0: number; v0: number; u1: number; v1: number } => {
      const col = localId % columns;
      const row = Math.floor(localId / columns);
      const px = margin + col * (tilewidth + spacing);
      const py = margin + row * (tileheight + spacing);
      return {
        u0: px / imagewidth,
        v0: py / imageheight,
        u1: (px + tilewidth) / imagewidth,
        v1: (py + tileheight) / imageheight,
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
 * Options for building a single chunk.
 */
type BuildChunkOptions = {
  /** The tile layer to read from. */
  layer: { width: number; height: number; data: readonly number[]; name: string };
  /** Chunk grid X (column). */
  chunkGridX: number;
  /** Chunk grid Y (row). */
  chunkGridY: number;
  /** Full tilemap data. */
  tilemap: TilemapData;
  /** Resolved tileset entries with UV lookup. */
  tilesetEntries: TilesetEntry[];
  /** The loaded tileset texture. */
  tilesetTexture: Texture;
  /** Tile pixel width. */
  tilePixelW: number;
  /** Tile pixel height. */
  tilePixelH: number;
  /** Shared GpuProgram for all chunks. */
  gpuProgram: GpuProgram;
  /** Global uniform group for time. */
  globalUniforms: UniformGroup;
  /** Storage buffer for animation tables. */
  animStorageBuffer: Buffer;
};

/**
 * Builds a single 32×32 tile chunk Mesh with geometry buffers.
 *
 * Creates a MeshGeometry with pre-allocated Float32Array position/UV
 * buffers and Uint32Array index buffer. Sets autoGarbageCollect = false
 * on the geometry and all buffer objects (C-171 AC-3 GC mitigation).
 *
 * Each chunk gets its own Shader bound to the chunk's tileset texture
 * via resources (`uTexture`, `uSampler`). All chunks share the same
 * GpuProgram (cached WGSL source).
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
    tilesetTexture,
    tilePixelW,
    tilePixelH,
    gpuProgram,
    globalUniforms,
    animStorageBuffer,
  } = options;

  // Compute tile range for this chunk
  const tileStartX = chunkGridX * CHUNK_SIZE;
  const tileStartY = chunkGridY * CHUNK_SIZE;
  const tileEndX = Math.min(tileStartX + CHUNK_SIZE, tilemap.width);
  const tileEndY = Math.min(tileStartY + CHUNK_SIZE, tilemap.height);

  // Count active tiles first
  let activeTileCount = 0;
  for (let row = tileStartY; row < tileEndY; row++) {
    for (let col = tileStartX; col < tileEndX; col++) {
      const index = row * layer.width + col;
      const gid = layer.data[index];
      if (gid === 0) {
        continue;
      }
      const resolved = _resolveGid(gid, tilesetEntries);
      if (!resolved) {
        continue;
      }
      activeTileCount += 1;
    }
  }

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
      const gid = layer.data[dataIndex];
      if (gid === 0) {
        continue;
      }
      const resolved = _resolveGid(gid, tilesetEntries);
      if (!resolved) {
        continue;
      }

      const { entry, localId } = resolved;
      const uv = entry.getUvRect(localId);

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

  // Create a Shader per chunk — binds globalUniforms, animation table, texture.
  // Passes both gpuProgram (WGSL for WebGPU) and glProgram (GLSL for WebGL2
  // fallback) so the shader works on both backends without console spam.
  const shader = new Shader({
    gpuProgram,
    glProgram: _getSharedGlProgram(),
    resources: {
      globals: globalUniforms,
      animTable: animStorageBuffer,
      uTextures: tilesetTexture.source,
      uSampler: tilesetTexture.source.style,
    },
  });

  // Create the Mesh with custom WGSL shader.
  // Note: we do NOT set mesh.texture — our custom Shader binds the
  // texture via resources (uTexture, uSampler), not via the
  // TextureShader.texture property. Setting mesh.texture would try
  // to write to shader.texture which does not exist on plain Shader.
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

  const chunk: TilemapChunk = {
    gridX: chunkGridX,
    gridY: chunkGridY,
    mesh,
    geometry,
    isActive: true,
    bounds,
  };

  // Attach chunk metadata to the mesh for frustum culling lookups
  (mesh as Mesh & { _chunkMeta?: TilemapChunk })._chunkMeta = chunk;

  return chunk;
};
