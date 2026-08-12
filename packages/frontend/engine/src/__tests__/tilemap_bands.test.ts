// packages/frontend/engine/src/__tests__/tilemap_bands.test.ts
//
// C-378 AC-1 — tiles can draw above entities.
//
// Renders a synthetic 3-band map (ground + decor + overhead) headlessly and
// asserts:
//   - three band containers exist with the declared zIndex values
//   - entity zIndex for any in-map y falls strictly between decor and
//     overhead bands
//   - chunks land in their band's container

import { beforeAll, describe, expect, it } from 'bun:test';
import { Assets, Container, DOMAdapter, Texture, TextureSource } from 'pixi.js';
import type { TilemapData } from '../assets/map_loader.ts';
import { computeEntityZIndex, WORLD_Z_BANDS } from '../rendering/layer_bands.ts';
import { renderTilemap } from '../systems/tilemap_render_system.ts';

// Reuse the headless PixiJS bootstrap pattern from tilemap_render.test.ts.

const _fakeGlContext = (): unknown => {
  return {
    getShaderPrecisionFormat: () => ({ precision: 1, rangeMin: 127, rangeMax: 127 }),
    getExtension: () => null,
    getParameter: () => null,
    isContextLost: () => false,
    // biome-ignore lint/style/useNamingConvention: WebGL API constants.
    FRAGMENT_SHADER: 0x8b30,
    // biome-ignore lint/style/useNamingConvention: WebGL API constants.
    HIGH_FLOAT: 0x1406,
  };
};

const _installStubTextureLoader = (): void => {
  // Use a DISTINCT image URL (not the shared atlas.webp) so this parser
  // never collides with the C-377 render test's parser in the shared test
  // process. The band test's tilemap references bands-test-tiles.png only.
  Assets.loader.parsers.unshift({
    name: 'test-texture-stub-bands',
    id: 'test-texture-stub-bands',
    test: (url: string) => url.includes('bands-test-tiles.png'),
    load: async (): Promise<Texture> => {
      const source = new TextureSource({ width: 128, height: 64 });
      source.scaleMode = 'nearest';
      return new Texture({ source });
    },
    unload: () => {},
  });
};

beforeAll(async () => {
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
  _installStubTextureLoader();
  await Assets.init({ skipDetections: true });
});

/** Synthetic 3-band map: ground (grass GID 1), decor (GID 2), overhead (GID 3). */
const _createBandTilemap = (): TilemapData => {
  const width = 4;
  const height = 4;
  const ground = new Array<number>(width * height).fill(1);
  const decor = new Array<number>(width * height).fill(0);
  const overhead = new Array<number>(width * height).fill(0);
  decor[5] = 2;
  overhead[10] = 3;
  return {
    width,
    height,
    tilewidth: 32,
    tileheight: 32,
    tilesets: [
      {
        firstgid: 1,
        name: 'atlas',
        image: '/game-data/sprites/tilesets/bands-test-tiles.png',
        imagewidth: 128,
        imageheight: 64,
        tilewidth: 32,
        tileheight: 32,
        columns: 4,
        tilecount: 8,
        spacing: 0,
        margin: 0,
      },
    ],
    layers: [
      { name: 'ground', width, height, data: ground, visible: true, band: 'ground' },
      { name: 'decor', width, height, data: decor, visible: true, band: 'decor' },
      { name: 'overhead', width, height, data: overhead, visible: true, band: 'overhead' },
      { name: 'collision', width, height, data: new Array(width * height).fill(0), visible: false },
    ],
  };
};

describe('C-378 AC-1 — per-band tilemap containers', () => {
  it('renders three band containers with the declared zIndex values', async () => {
    const result = await renderTilemap({ tilemap: _createBandTilemap() });

    const bands = [...result.bandContainers].sort((a, b) => a.zIndex - b.zIndex);
    expect(bands.map((b) => b.band)).toEqual(['ground', 'decor', 'overhead']);
    expect(bands[0].zIndex).toBe(WORLD_Z_BANDS.tilemapGround);
    expect(bands[1].zIndex).toBe(WORLD_Z_BANDS.tilemapDecor);
    expect(bands[2].zIndex).toBe(WORLD_Z_BANDS.tilemapOverhead);

    for (const band of bands) {
      expect(band.container).toBeInstanceOf(Container);
      expect(band.container.label).toBe(`tilemap-band-${band.band}`);
    }
  });

  it('entity zIndex for any in-map y falls strictly between decor and overhead bands', () => {
    // AC-1 watch point: the invariant is asserted with realistic map pixel
    // heights, not by trusting the constant.
    for (const y of [0, 32, 64, 128, 256, 512, 1024, 2048, 4096]) {
      const entityZ = computeEntityZIndex(y);
      expect(entityZ, `entity y ${y} above decor`).toBeGreaterThan(WORLD_Z_BANDS.tilemapDecor);
      expect(entityZ, `entity y ${y} below overhead`).toBeLessThan(WORLD_Z_BANDS.tilemapOverhead);
    }
  });

  it('places each chunk in its band container (not the merged one)', async () => {
    const result = await renderTilemap({ tilemap: _createBandTilemap() });

    const groundBand = result.bandContainers.find((b) => b.band === 'ground');
    const decorBand = result.bandContainers.find((b) => b.band === 'decor');
    const overheadBand = result.bandContainers.find((b) => b.band === 'overhead');

    expect(groundBand?.chunks.length).toBe(1); // one chunk with the ground fill
    expect(decorBand?.chunks.length).toBe(1); // decor tile present
    expect(overheadBand?.chunks.length).toBe(1); // overhead tile present

    // The merged container contains the band containers as children.
    expect(result.container.children.length).toBe(3);
  });

  it('a map with only ground layers degrades to a single ground band', async () => {
    const tilemap = _createBandTilemap();
    tilemap.layers = tilemap.layers.filter((l) => l.name !== 'decor' && l.name !== 'overhead');
    const result = await renderTilemap({ tilemap });

    expect(result.bandContainers.map((b) => b.band)).toEqual(['ground']);
  });

  it('a visible layer with an omitted band property lands in the ground band (bandZ default)', async () => {
    // Strip the band property from the decor layer — an omitted band must
    // default to 'ground' (the bandZ default branch + `layer.band ?? 'ground'`),
    // never throw or vanish the layer.
    const tilemap = _createBandTilemap();
    const decor = tilemap.layers.find((l) => l.name === 'decor');
    if (decor) {
      delete decor.band;
    }
    const result = await renderTilemap({ tilemap });

    const groundBand = result.bandContainers.find((b) => b.band === 'ground');
    // The decor tiles now render in the ground band alongside the ground
    // fill — two layers merged into one band's chunk list.
    expect(groundBand?.chunks.length).toBe(2);
    expect(groundBand?.zIndex).toBe(WORLD_Z_BANDS.tilemapGround);
    // No decor band exists anymore; overhead keeps its explicit band.
    expect(result.bandContainers.map((b) => b.band)).toEqual(['ground', 'overhead']);
  });
});
