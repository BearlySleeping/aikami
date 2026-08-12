// packages/frontend/engine/src/__tests__/tilemap_render.test.ts
//
// Contract C-377 — Pixel-Art Render Correctness.
//
// AC-4: chunks that leave the viewport return when the camera comes back.
// AC-5: renderTilemap returns the uniform group its chunks are bound to.
// AC-8: a real content-pack map renders in an automated test.
//
// Headless PixiJS strategy (reused from rendering.test.ts conventions):
//   - DOMAdapter is swapped for a canvas stub so GlProgram compilation
//     (which creates a WebGL test context on first use) works without a
//     browser.
//   - Assets.init({ skipDetections: true }) skips format detection (which
//     needs real <video>/<img>).
//   - A stub loader parser is unshifted onto Assets.loader.parsers so
//     Assets.load(image) returns a pre-built TextureSource-backed texture
//     instead of fetching.
//
// The AC-4 and AC-5 tests target the C-377 result shape (owned chunk
// array on TilemapRenderResult / TilemapChunkRenderResult) and the
// visibility-toggle culler. Against pre-contract HEAD they fail — the
// result has no `chunks`, and the culler permanently removes children.

import { beforeAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Assets, DOMAdapter, Texture, TextureSource } from 'pixi.js';
import { loadTilemap } from '../assets/map_loader.ts';
// Same function pixi_app.ts calls at renderer creation — installing the
// global nearest-neighbour TextureStyle default before any texture is
// created. Isolated in a config-free module so engine tests (which have no
// PUBLIC_* env) can exercise the identical production default.
import { installNearestTextureDefault } from '../rendering/texture_defaults.ts';
import {
  buildTilemapChunks,
  frustumCullChunks,
  type TilemapChunk,
} from '../rendering/tilemap_chunk_renderer.ts';
import { renderTilemap, type TilemapRenderResult } from '../systems/tilemap_render_system.ts';

// ---------------------------------------------------------------------------
// Headless PixiJS bootstrap
// ---------------------------------------------------------------------------

/** Minimal WebGL context used by GlProgram's test-context path. */
const _fakeGlContext = (): unknown => {
  return {
    getShaderPrecisionFormat: () => ({ precision: 1, rangeMin: 127, rangeMax: 127 }),
    getExtension: () => null,
    getParameter: () => null,
    isContextLost: () => false,
    // WebGL constants used by getMaxFragmentPrecision (UPPER_SNAKE matches
    // the WebGL API surface; suppressed via biome-ignore below).
    // biome-ignore lint/style/useNamingConvention: WebGL API constants.
    FRAGMENT_SHADER: 0x8b30,
    // biome-ignore lint/style/useNamingConvention: WebGL API constants.
    HIGH_FLOAT: 0x1406,
  };
};

beforeAll(() => {
  installNearestTextureDefault();
  DOMAdapter.set({
    createCanvas: () =>
      ({ width: 0, height: 0, getContext: () => _fakeGlContext() }) as unknown as HTMLCanvasElement,
    createImage: () => ({}) as unknown as HTMLImageElement,
    getCanvasRenderingContext2D: () => ({}) as unknown as typeof CanvasRenderingContext2D,
    getWebGLRenderingContext: () => ({}) as unknown as typeof WebGLRenderingContext,
    getNavigator: () => ({}) as unknown as Navigator,
    getBaseUrl: () => 'http://localhost/',
    getFontFaceSet: () => ({}) as unknown as FontFaceSet,
    fetch: (url: RequestInfo | URL, init?: RequestInit) => fetch(url, init),
    parseXML: (xml: string) => new DOMParser().parseFromString(xml, 'text/xml'),
  });
});

/** Installs the Assets stub loader for the tileset image URL. */
const _installStubTextureLoader = (): void => {
  Assets.loader.parsers.unshift({
    name: 'test-texture-stub',
    id: 'test-texture-stub',
    test: (url: string) => url.includes('atlas.webp') || url.includes('tileset'),
    load: async (): Promise<Texture> => {
      // Deliberately NOT forcing scaleMode here: the global default installed
      // by installNearestTextureDefault() must be what makes this nearest —
      // that is the AC-1 production mechanism under test.
      const source = new TextureSource({ width: 512, height: 256 });
      return new Texture({ source });
    },
    unload: () => {},
  });
};

/** Creates a 512×256 tileset texture directly (no Assets round-trip). */
const _createTilesetTexture = (): Texture => {
  const source = new TextureSource({ width: 512, height: 256 });
  return new Texture({ source });
};

// ---------------------------------------------------------------------------
// Real Emberwatch village map (AC-8 / AC-5)
// ---------------------------------------------------------------------------

/**
 * Extracts the uniform group a chunk mesh is bound to, throwing if the
 * mesh has no shader (defensive — the chunk renderer always sets one).
 */
const _boundUniformGroup = (chunk: TilemapChunk): import('pixi.js').UniformGroup => {
  const shader = chunk.mesh.shader;
  if (!shader) {
    throw new Error('tilemap chunk mesh has no shader');
  }
  const globals = shader.resources.globals;
  if (!globals) {
    throw new Error('tilemap chunk shader has no globals uniform group');
  }
  return globals;
};

const VILLAGE_MAP_PATH = join(
  import.meta.dir,
  '../../../../../apps/frontend/client/static/content-packs/emberwatch/maps/village.json',
);

const _loadVillageTilemap = async (): Promise<Awaited<ReturnType<typeof loadTilemap>>> => {
  const raw = readFileSync(VILLAGE_MAP_PATH, 'utf-8');
  return loadTilemap({
    url: 'emberwatch/village.json',
    fetch: (async (): Promise<Response> =>
      new Response(raw, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch,
  });
};

// ---------------------------------------------------------------------------
// Synthetic 96×96 map helper (AC-4) — 9 chunks of 32×32 tiles
// ---------------------------------------------------------------------------

const _createSyntheticTilemap = (): Awaited<ReturnType<typeof loadTilemap>> => {
  const width = 96;
  const height = 96;
  // Solid fill with a GID of 1 (first tile in the tileset).
  const data = new Array<number>(width * height).fill(1);
  return {
    width,
    height,
    tilewidth: 32,
    tileheight: 32,
    tilesets: [
      {
        firstgid: 1,
        name: 'test-tileset',
        image: '/game-data/sprites/tilesets/tileset.webp',
        imagewidth: 512,
        imageheight: 256,
        tilewidth: 32,
        tileheight: 32,
        columns: 16,
        tilecount: 128,
      },
    ],
    layers: [
      { name: 'ground', width, height, data: [...data], visible: true },
      {
        name: 'collision',
        width,
        height,
        data: new Array<number>(width * height).fill(0),
        visible: false,
      },
    ],
  };
};

// ---------------------------------------------------------------------------
// AC-4 — frustum culling toggles visibility both ways, never reparents
// ---------------------------------------------------------------------------

describe('C-377 AC-4 — frustum culling returns chunks to the viewport', () => {
  it('hides chunks that leave the viewport and redraws them on return, keeping container children constant', () => {
    const tilemap = _createSyntheticTilemap();
    const result = buildTilemapChunks({
      tilemap,
      tilesetTexture: _createTilesetTexture(),
    });

    // 96×96 tiles = 3×3 chunks = 9 chunks.
    expect(result.chunkCount).toBe(9);
    const chunks: readonly TilemapChunk[] = result.chunks;
    expect(chunks.length).toBe(9);

    const container = result.container;
    const initialChildCount = container.children.length;
    expect(initialChildCount).toBe(9);

    // World viewport: 640×480 world px (e.g. 2560×1920 CSS at 4× scale).
    // Chunks are 1024×1024 world px.
    const vpW = 640;
    const vpH = 480;

    // Camera at top-left (0,0) → only chunk (0,0) fully overlaps; the
    // overdraw margin (64px) keeps a 64px border of neighbors warm but
    // chunks starting at 1024 cannot overlap [0, 640+64].
    frustumCullChunks(chunks, 0, 0, vpW, vpH);
    const c00 = chunks[0];
    const c10 = chunks[1];
    const c01 = chunks[3];
    expect(c00.mesh.visible).toBe(true);
    expect(c10.mesh.visible).toBe(false); // x=1024 > 704
    expect(c01.mesh.visible).toBe(false); // y=1024 > 544
    expect(container.children.length).toBe(initialChildCount);

    // Pan camera right by 1200px → chunk (0,0) leaves, chunk (1,0) enters.
    frustumCullChunks(chunks, 1200, 0, vpW, vpH);
    expect(c00.mesh.visible).toBe(false);
    expect(c10.mesh.visible).toBe(true);
    expect(container.children.length).toBe(initialChildCount);

    // Pan back to origin → chunk (0,0) is drawn again (the C-377 defect:
    // pre-contract this chunk was permanently deleted).
    frustumCullChunks(chunks, 0, 0, vpW, vpH);
    expect(c00.mesh.visible).toBe(true);
    expect(c10.mesh.visible).toBe(false);
    expect(container.children.length).toBe(initialChildCount);
  });

  it('keeps container children constant across many camera pans (no reparenting)', () => {
    const tilemap = _createSyntheticTilemap();
    const result = buildTilemapChunks({
      tilemap,
      tilesetTexture: _createTilesetTexture(),
    });
    const chunks = result.chunks;
    const container = result.container;
    const initialChildCount = container.children.length;

    for (let i = 0; i < 20; i++) {
      const cx = (i % 5) * 700;
      const cy = Math.floor(i / 5) * 700;
      frustumCullChunks(chunks, cx, cy, 640, 480);
      expect(container.children.length).toBe(initialChildCount);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-5 — renderTilemap returns the uniform group its chunks are bound to
// ---------------------------------------------------------------------------

describe('C-377 AC-5 — renderTilemap returns the bound uniform group', () => {
  it('village.json (layers [ground, collision]) returns the group bound in chunk meshes', async () => {
    _installStubTextureLoader();
    await Assets.init({ skipDetections: true });

    const tilemap = await _loadVillageTilemap();
    const result: TilemapRenderResult = await renderTilemap({ tilemap });

    expect(result.chunks.length).toBeGreaterThan(0);
    // AC-5: reference-identical — the returned group IS the chunk's group.
    // Assert every chunk, not just the first, so later layers are covered.
    for (const chunk of result.chunks) {
      expect(result.globalUniforms).toBe(_boundUniformGroup(chunk));
    }
  });

  it('a map whose last layer IS rendered also returns the bound group', async () => {
    _installStubTextureLoader();
    await Assets.init({ skipDetections: true });

    // Layer order [ground, path] — the LAST layer is a rendered tile layer.
    // `_createSyntheticTilemap()` returns [ground, collision], so splicing a
    // path layer in front of `layers[1]` would still leave collision last;
    // the collision layer is deliberately dropped to exercise the
    // rendered-last ordering (pre-contract this hit the early-return path
    // with the real group, so this guards against regressions in both).
    const tilemap = _createSyntheticTilemap();
    tilemap.layers = [
      tilemap.layers[0],
      {
        name: 'path',
        width: 96,
        height: 96,
        data: new Array<number>(96 * 96).fill(2),
        visible: true,
      },
    ];

    const result: TilemapRenderResult = await renderTilemap({ tilemap });
    expect(result.chunks.length).toBeGreaterThan(0);
    // Every chunk (ground + path) must be bound to the returned group —
    // checking only the first chunk can miss a later layer's binding.
    for (const chunk of result.chunks) {
      expect(result.globalUniforms).toBe(_boundUniformGroup(chunk));
    }
  });
});

// ---------------------------------------------------------------------------
// AC-8 — real content-pack map renders in an automated test
// ---------------------------------------------------------------------------

describe('C-377 AC-8 — real Emberwatch village map renders headlessly', () => {
  it('constructs chunk shaders with glProgram only (no gpuProgram — WGSL path deleted)', async () => {
    const tilemap = await _loadVillageTilemap();
    const result = buildTilemapChunks({
      tilemap,
      tilesetTexture: _createTilesetTexture(),
    });

    const firstChunk = result.chunks[0];
    const shader = firstChunk.mesh.shader;
    // AC-6: the tilemap renders through the GLSL program only.
    if (!shader) {
      throw new Error('expected chunk shader to be defined');
    }
    expect(shader.glProgram).toBeDefined();
    expect(shader.gpuProgram).toBeUndefined();
  });

  it('parses the committed map, builds chunks, and validates geometry', async () => {
    const tilemap = await _loadVillageTilemap();

    // Village is 20×20 tiles → a single 32×32-tile chunk per band layer.
    expect(tilemap.width).toBe(20);
    expect(tilemap.height).toBe(20);

    const result = buildTilemapChunks({
      tilemap,
      tilesetTexture: _createTilesetTexture(),
    });

    // C-378: the converted map carries ground + decor + overhead bands;
    // each visible band produces its own chunk. Collision contributes none.
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(result.chunks.length).toBe(result.chunkCount);
    const chunk = result.chunks[0];
    const geometry = chunk.geometry;

    // Collision layer contributes no geometry — every chunk is a visible
    // band layer (ground/decor/overhead).
    expect(chunk.layerName).not.toBe('collision');

    // Vertex positions match `col * tilewidth` / `row * tileheight` and all
    // stay within the map's pixel bounds.
    const posBuffer = geometry.getBuffer('aPosition');
    if (!posBuffer) {
      throw new Error('expected aPosition buffer');
    }
    const positions = posBuffer.data as Float32Array;
    const mapPixelW = tilemap.width * tilemap.tilewidth;
    const mapPixelH = tilemap.height * tilemap.tileheight;
    expect(positions.length % 2).toBe(0);
    for (let i = 0; i < positions.length; i += 2) {
      const x = positions[i];
      const y = positions[i + 1];
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(mapPixelW);
      expect(y).toBeLessThanOrEqual(mapPixelH);
      expect(x % tilemap.tilewidth).toBe(0);
      expect(y % tilemap.tileheight).toBe(0);
    }

    // Per-tile UV rectangles within [0,1].
    const uvBuffer = geometry.getBuffer('aUV');
    if (!uvBuffer) {
      throw new Error('expected aUV buffer');
    }
    const uvs = uvBuffer.data as Float32Array;
    expect(uvs.length % 2).toBe(0);
    for (let i = 0; i < uvs.length; i += 2) {
      expect(uvs[i]).toBeGreaterThanOrEqual(0);
      expect(uvs[i]).toBeLessThanOrEqual(1);
      expect(uvs[i + 1]).toBeGreaterThanOrEqual(0);
      expect(uvs[i + 1]).toBeLessThanOrEqual(1);
    }

    // The ground layer has non-zero tiles (the map is not empty).
    expect(positions.length).toBeGreaterThan(0);
  });

  it('renderTilemap on the real map skips the collision layer and returns chunk geometry', async () => {
    _installStubTextureLoader();
    await Assets.init({ skipDetections: true });

    const tilemap = await _loadVillageTilemap();
    const result: TilemapRenderResult = await renderTilemap({ tilemap });

    // C-378: the map now carries ground + decor + overhead bands; the
    // collision layer still contributes no chunks. The map ALSO carries a
    // terrain channel, but renderTilemap without terrainLayers renders the
    // baked ground band (legacy path) — chunk count reflects all visible
    // bands.
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(result.chunks.length).toBe(result.chunkCount);
    expect(result.layerCount).toBe(3); // ground + decor + overhead
    for (const chunk of result.chunks) {
      expect(chunk.layerName).not.toBe('collision');
    }
  });
});

// ---------------------------------------------------------------------------
// AC-1 (integration seam) — tileset texture resolves to nearest filtering
// ---------------------------------------------------------------------------

describe('C-377 AC-1 — tilemap textures use nearest filtering', () => {
  it('resolves the tileset texture with scaleMode nearest after renderTilemap', async () => {
    _installStubTextureLoader();
    await Assets.init({ skipDetections: true });

    const tilemap = await _loadVillageTilemap();
    await renderTilemap({ tilemap });

    const tilesetTexture = Texture.from('/game-data/sprites/tilesets/atlas.webp');
    expect(tilesetTexture.source.scaleMode).toBe('nearest');
  });
});

// ---------------------------------------------------------------------------
// C-378 AC-9 — day/night tint uniform on the tilemap shader
// ---------------------------------------------------------------------------

describe('C-378 AC-9 — tilemap tint uniform', () => {
  it('the chunk shader resources carry a uTint uniform (present, neutral default)', async () => {
    _installStubTextureLoader();
    await Assets.init({ skipDetections: true });

    const tilemap = await _loadVillageTilemap();
    const result: TilemapRenderResult = await renderTilemap({ tilemap });

    expect(result.chunks.length).toBeGreaterThan(0);
    const shader = result.chunks[0].mesh.shader;
    if (!shader) {
      throw new Error('expected chunk shader');
    }
    const globals = shader.resources.globals as { uniforms?: Record<string, unknown> } | undefined;
    expect(globals).toBeDefined();
    expect(globals?.uniforms?.uTint).toBeDefined();
    // Neutral default: (1,1,1,1) — pixel-identical to an untinted render.
    const tint = globals?.uniforms?.uTint as Float32Array | number[] | undefined;
    expect(Array.from(tint as number[])).toEqual([1, 1, 1, 1]);
  });
});
