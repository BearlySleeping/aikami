// packages/frontend/engine/src/assets/map_loader.test.ts

import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { PackConfig } from '@aikami/types';
import { logger } from '$logger';
import type { TilemapData } from './map_loader.ts';
import {
  buildCollisionGrid,
  clearMapCache,
  extractCollisionGrid,
  extractSpawnPoints,
  loadTilemap,
} from './map_loader.ts';

// ---------------------------------------------------------------------------
// C-135 Task 4: Unit tests for Map Asset Loader
// ---------------------------------------------------------------------------

/**
 * Creates a minimal valid Tiled JSON map for testing.
 */
const createTestMap = (overrides?: Partial<Record<string, unknown>>): Record<string, unknown> => {
  return {
    width: 10,
    height: 8,
    tilewidth: 32,
    tileheight: 32,
    tilesets: [
      {
        firstgid: 1,
        name: 'test_tileset',
        image: 'tileset.png',
        imagewidth: 256,
        imageheight: 256,
        tilewidth: 32,
        tileheight: 32,
        columns: 8,
        tilecount: 64,
      },
    ],
    layers: [
      {
        name: 'ground',
        width: 10,
        height: 8,
        data: new Array(80).fill(1),
        visible: true,
        type: 'tilelayer',
      },
    ],
    ...overrides,
  };
};

/**
 * Mock fetch that returns a JSON response from the given object.
 */
const mockFetch = (data: unknown) => {
  return mock(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(data),
    } as Response),
  ) as unknown as typeof fetch;
};

afterEach(() => {
  clearMapCache();
});

// ---------------------------------------------------------------------------
// AC: Map JSON files are successfully parsed and cached
// ---------------------------------------------------------------------------

describe('loadTilemap: parsing', () => {
  it('parses a valid Tiled JSON map into TilemapData', async () => {
    const raw = createTestMap();
    const fetcher = mockFetch(raw);

    const result = await loadTilemap({ url: 'test://map.json', fetch: fetcher });

    expect(result.width).toBe(10);
    expect(result.height).toBe(8);
    expect(result.tilewidth).toBe(32);
    expect(result.tileheight).toBe(32);
    expect(result.tilesets).toHaveLength(1);
    expect(result.tilesets[0].name).toBe('test_tileset');
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0].name).toBe('ground');
  });

  it('extracts tileset fields correctly', async () => {
    const raw = createTestMap();
    const fetcher = mockFetch(raw);

    const result = await loadTilemap({ url: 'test://map.json', fetch: fetcher });

    const tileset = result.tilesets[0];
    expect(tileset.firstgid).toBe(1);
    expect(tileset.image).toBe('tileset.png');
    expect(tileset.imagewidth).toBe(256);
    expect(tileset.imageheight).toBe(256);
    expect(tileset.columns).toBe(8);
    expect(tileset.tilecount).toBe(64);
    expect(tileset.tilewidth).toBe(32);
    expect(tileset.tileheight).toBe(32);
  });

  it('extracts layer data as numbers', async () => {
    const raw = createTestMap();
    const fetcher = mockFetch(raw);

    const result = await loadTilemap({ url: 'test://map.json', fetch: fetcher });

    const layer = result.layers[0];
    expect(layer.width).toBe(10);
    expect(layer.height).toBe(8);
    expect(layer.data).toHaveLength(80);
    expect(layer.visible).toBe(true);
    expect(typeof layer.data[0]).toBe('number');
  });

  it('parses multiple layers', async () => {
    const raw = createTestMap({
      layers: [
        {
          name: 'ground',
          width: 10,
          height: 8,
          data: new Array(80).fill(1),
          visible: true,
          type: 'tilelayer',
        },
        {
          name: 'walls',
          width: 10,
          height: 8,
          data: new Array(80).fill(2),
          visible: true,
          type: 'tilelayer',
        },
        {
          name: 'overlay',
          width: 10,
          height: 8,
          data: new Array(80).fill(0),
          visible: false,
          type: 'tilelayer',
        },
      ],
    });
    const fetcher = mockFetch(raw);

    const result = await loadTilemap({ url: 'test://map.json', fetch: fetcher });

    expect(result.layers).toHaveLength(3);
    expect(result.layers[0].name).toBe('ground');
    expect(result.layers[1].name).toBe('walls');
    expect(result.layers[2].name).toBe('overlay');
    expect(result.layers[2].visible).toBe(false);
  });

  it('parses multiple tilesets', async () => {
    const raw = createTestMap({
      tilesets: [
        {
          firstgid: 1,
          name: 'tileset_a',
          image: 'a.png',
          imagewidth: 128,
          imageheight: 128,
          tilewidth: 32,
          tileheight: 32,
          columns: 4,
          tilecount: 16,
        },
        {
          firstgid: 17,
          name: 'tileset_b',
          image: 'b.png',
          imagewidth: 256,
          imageheight: 256,
          tilewidth: 32,
          tileheight: 32,
          columns: 8,
          tilecount: 64,
        },
      ],
    });
    const fetcher = mockFetch(raw);

    const result = await loadTilemap({ url: 'test://map.json', fetch: fetcher });

    expect(result.tilesets).toHaveLength(2);
    expect(result.tilesets[0].name).toBe('tileset_a');
    expect(result.tilesets[1].name).toBe('tileset_b');
    expect(result.tilesets[0].firstgid).toBe(1);
    expect(result.tilesets[1].firstgid).toBe(17);
  });

  it('parses a layer with mixed tile IDs including zeros', async () => {
    const data = new Array(50).fill(0).concat(new Array(30).fill(1));
    const raw = createTestMap({
      layers: [
        {
          name: 'ground',
          width: 10,
          height: 8,
          data,
          visible: true,
          type: 'tilelayer',
        },
      ],
    });
    const fetcher = mockFetch(raw);

    const result = await loadTilemap({ url: 'test://map.json', fetch: fetcher });

    const layer = result.layers[0];
    expect(layer.data[0]).toBe(0);
    expect(layer.data[49]).toBe(0);
    expect(layer.data[50]).toBe(1);
    expect(layer.data[79]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC: Caching
// ---------------------------------------------------------------------------

describe('loadTilemap: caching', () => {
  it('caches the result and returns cached data on subsequent calls', async () => {
    const raw = createTestMap();
    const fetcher = mockFetch(raw);

    const result1 = await loadTilemap({ url: 'test://cached.json', fetch: fetcher });
    const result2 = await loadTilemap({ url: 'test://cached.json', fetch: fetcher });

    // Should be the same object reference (cached)
    expect(result1).toBe(result2);
  });

  it('clearMapCache removes cached entries', async () => {
    const raw = createTestMap();
    const fetcher = mockFetch(raw);

    const result1 = await loadTilemap({ url: 'test://clear.json', fetch: fetcher });
    clearMapCache();
    const result2 = await loadTilemap({ url: 'test://clear.json', fetch: fetcher });

    // Different object references after cache clear
    expect(result1).not.toBe(result2);
    expect(result2.width).toBe(10); // Still parses correctly
  });

  it('caches different URLs independently', async () => {
    const makeMap = (w: number) => ({
      width: w,
      height: 8,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [
        {
          firstgid: 1,
          name: 'ts',
          image: 't.png',
          imagewidth: 256,
          imageheight: 256,
          tilewidth: 32,
          tileheight: 32,
          columns: 8,
          tilecount: 64,
        },
      ],
      layers: [
        {
          name: 'ground',
          width: w,
          height: 8,
          data: new Array(w * 8).fill(1),
          visible: true,
          type: 'tilelayer',
        },
      ],
    });

    const raw1 = makeMap(5);
    const raw2 = makeMap(20);
    const fetcher = mock((url: string) => {
      const data = url.includes('url2') ? raw2 : raw1;
      return Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response);
    }) as unknown as typeof fetch;

    const result1 = await loadTilemap({
      url: 'test://url1.json',
      fetch: fetcher as unknown as typeof fetch,
    });
    const result2 = await loadTilemap({ url: 'test://url2.json', fetch: fetcher });

    expect(result1.width).toBe(5);
    expect(result2.width).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Edge cases: validation
// ---------------------------------------------------------------------------

describe('loadTilemap: validation errors', () => {
  it('throws on invalid JSON', async () => {
    const fetcher = mockFetch('not an object');

    await expect(loadTilemap({ url: 'test://bad.json', fetch: fetcher })).rejects.toThrow(
      'MapLoader: invalid JSON',
    );
  });

  it('throws when width is missing', async () => {
    const raw = createTestMap({ width: undefined });
    const fetcher = mockFetch(raw);

    await expect(loadTilemap({ url: 'test://bad.json', fetch: fetcher })).rejects.toThrow(
      'missing or invalid "width"',
    );
  });

  it('throws when height is missing', async () => {
    const raw = createTestMap({ height: undefined });
    const fetcher = mockFetch(raw);

    await expect(loadTilemap({ url: 'test://bad.json', fetch: fetcher })).rejects.toThrow(
      'missing or invalid "height"',
    );
  });

  it('throws when tilesets is missing', async () => {
    const raw = createTestMap({ tilesets: undefined });
    const fetcher = mockFetch(raw);

    await expect(loadTilemap({ url: 'test://bad.json', fetch: fetcher })).rejects.toThrow(
      'missing or invalid "tilesets"',
    );
  });

  it('throws when layers is missing', async () => {
    const raw = createTestMap({ layers: undefined });
    const fetcher = mockFetch(raw);

    await expect(loadTilemap({ url: 'test://bad.json', fetch: fetcher })).rejects.toThrow(
      'missing or invalid "layers"',
    );
  });

  it('throws when dimensions are zero', async () => {
    const raw = createTestMap({ width: 0, height: 0 });
    const fetcher = mockFetch(raw);

    await expect(loadTilemap({ url: 'test://bad.json', fetch: fetcher })).rejects.toThrow(
      'invalid dimensions',
    );
  });

  it('throws when layer dimensions do not match map', async () => {
    const raw = createTestMap({
      layers: [
        {
          name: 'ground',
          width: 5, // Does not match map width (10)
          height: 8,
          data: new Array(40).fill(1),
          visible: true,
          type: 'tilelayer',
        },
      ],
    });
    const fetcher = mockFetch(raw);

    await expect(loadTilemap({ url: 'test://bad.json', fetch: fetcher })).rejects.toThrow(
      "don't match map",
    );
  });

  it('throws when layer data length does not match dimensions', async () => {
    const raw = createTestMap({
      layers: [
        {
          name: 'ground',
          width: 10,
          height: 8,
          data: [1, 2, 3], // Only 3 elements, expected 80
          visible: true,
          type: 'tilelayer',
        },
      ],
    });
    const fetcher = mockFetch(raw);

    await expect(loadTilemap({ url: 'test://bad.json', fetch: fetcher })).rejects.toThrow(
      "doesn't match dimensions",
    );
  });

  it('throws when fetch fails with non-ok response', async () => {
    const fetcher = mock(() =>
      Promise.resolve({
        ok: false,
        status: 404,
      } as Response),
    ) as unknown as typeof fetch;

    await expect(loadTilemap({ url: 'test://notfound.json', fetch: fetcher })).rejects.toThrow(
      'HTTP 404',
    );
  });

  it('skips non-tilelayer layers', async () => {
    const raw = createTestMap({
      layers: [
        {
          name: 'ground',
          width: 10,
          height: 8,
          data: new Array(80).fill(1),
          visible: true,
          type: 'tilelayer',
        },
        {
          name: 'objects',
          width: 10,
          height: 8,
          objects: [{ id: 1 }],
          visible: true,
          type: 'objectgroup',
        },
      ],
    });
    const fetcher = mockFetch(raw);

    const result = await loadTilemap({ url: 'test://map.json', fetch: fetcher });

    // Only tilelayer should be included
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0].name).toBe('ground');
  });

  it('throws when no tile layers are found', async () => {
    const raw = createTestMap({
      layers: [
        {
          name: 'objects',
          width: 10,
          height: 8,
          objects: [{ id: 1 }],
          visible: true,
          type: 'objectgroup',
        },
      ],
    });
    const fetcher = mockFetch(raw);

    await expect(loadTilemap({ url: 'test://bad.json', fetch: fetcher })).rejects.toThrow(
      'no tile layers found',
    );
  });

  it('handles spacing and margin in tilesets', async () => {
    const raw = createTestMap({
      tilesets: [
        {
          firstgid: 1,
          name: 'spaced',
          image: 'spaced.png',
          imagewidth: 256,
          imageheight: 256,
          tilewidth: 32,
          tileheight: 32,
          columns: 8,
          tilecount: 64,
          spacing: 2,
          margin: 4,
        },
      ],
    });
    const fetcher = mockFetch(raw);

    const result = await loadTilemap({ url: 'test://map.json', fetch: fetcher });

    expect(result.tilesets[0].spacing).toBe(2);
    expect(result.tilesets[0].margin).toBe(4);
  });

  it('defaults spacing and margin to 0 when absent', async () => {
    const raw = createTestMap();
    const fetcher = mockFetch(raw);

    const result = await loadTilemap({ url: 'test://map.json', fetch: fetcher });

    expect(result.tilesets[0].spacing).toBe(0);
    expect(result.tilesets[0].margin).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC: Object layer parsing and spawn point extraction
// ---------------------------------------------------------------------------

describe('extractSpawnPoints', () => {
  it('returns empty array when no objectLayers exist', () => {
    const tilemap: TilemapData = {
      width: 4,
      height: 3,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      layers: [
        {
          name: 'ground',
          width: 4,
          height: 3,
          data: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          visible: true,
        },
      ],
    };

    const spawnPoints = extractSpawnPoints(tilemap);
    expect(spawnPoints).toEqual([]);
  });

  it('returns empty array when objectLayers is an empty array', () => {
    const tilemap: TilemapData = {
      width: 4,
      height: 3,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      layers: [],
      objectLayers: [],
    };

    const spawnPoints = extractSpawnPoints(tilemap);
    expect(spawnPoints).toEqual([]);
  });

  it('extracts NPC spawn points with custom properties (array format)', () => {
    const tilemap: TilemapData = {
      width: 10,
      height: 8,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      layers: [],
      objectLayers: [
        {
          name: 'npcs',
          objects: [
            {
              id: 1,
              type: 'npc',
              x: 320,
              y: 256,
              properties: [
                { name: 'npcId', type: 'string', value: 'guard_town_1' },
                { name: 'dialogueKey', type: 'string', value: 'guard_greeting' },
              ],
            },
          ],
        },
      ],
    };

    const spawnPoints = extractSpawnPoints(tilemap);
    expect(spawnPoints).toHaveLength(1);
    expect(spawnPoints[0].id).toBe('1');
    expect(spawnPoints[0].type).toBe('npc');
    expect(spawnPoints[0].x).toBe(320);
    expect(spawnPoints[0].y).toBe(256);
    expect(spawnPoints[0].properties).toEqual({
      npcId: 'guard_town_1',
      dialogueKey: 'guard_greeting',
    });
  });

  it('extracts spawn points with flat object properties format', () => {
    const tilemap: TilemapData = {
      width: 10,
      height: 8,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      layers: [],
      objectLayers: [
        {
          name: 'props',
          objects: [
            {
              id: 5,
              type: 'prop',
              x: 128,
              y: 64,
              properties: {
                assetId: 'chest_01',
                interactive: true,
              },
            },
          ],
        },
      ],
    };

    const spawnPoints = extractSpawnPoints(tilemap);
    expect(spawnPoints).toHaveLength(1);
    expect(spawnPoints[0].id).toBe('5');
    expect(spawnPoints[0].type).toBe('prop');
    expect(spawnPoints[0].properties).toEqual({
      assetId: 'chest_01',
      interactive: true,
    });
  });

  it('extracts multiple spawn points from multiple object layers', () => {
    const tilemap: TilemapData = {
      width: 10,
      height: 8,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      layers: [],
      objectLayers: [
        {
          name: 'npcs',
          objects: [
            { id: 1, type: 'npc', x: 100, y: 200, properties: [] },
            { id: 2, type: 'npc', x: 300, y: 400, properties: [] },
          ],
        },
        {
          name: 'props',
          objects: [{ id: 3, type: 'prop', x: 50, y: 150, properties: [] }],
        },
      ],
    };

    const spawnPoints = extractSpawnPoints(tilemap);
    expect(spawnPoints).toHaveLength(3);
    expect(spawnPoints[0].type).toBe('npc');
    expect(spawnPoints[1].type).toBe('npc');
    expect(spawnPoints[2].type).toBe('prop');
  });

  it('skips objects without an id', () => {
    const tilemap: TilemapData = {
      width: 10,
      height: 8,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      layers: [],
      objectLayers: [
        {
          name: 'npcs',
          objects: [
            { type: 'npc', x: 100, y: 200 }, // no id
            { id: 2, type: 'npc', x: 300, y: 400 },
          ],
        },
      ],
    };

    const spawnPoints = extractSpawnPoints(tilemap);
    expect(spawnPoints).toHaveLength(1);
    expect(spawnPoints[0].id).toBe('2');
  });

  it('skips objects without a type', () => {
    const tilemap: TilemapData = {
      width: 10,
      height: 8,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      layers: [],
      objectLayers: [
        {
          name: 'npcs',
          objects: [
            { id: 1, x: 100, y: 200 }, // no type
            { id: 2, type: 'npc', x: 300, y: 400 },
          ],
        },
      ],
    };

    const spawnPoints = extractSpawnPoints(tilemap);
    expect(spawnPoints).toHaveLength(1);
    expect(spawnPoints[0].id).toBe('2');
  });

  it('defaults x and y to 0 when missing', () => {
    const tilemap: TilemapData = {
      width: 10,
      height: 8,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      layers: [],
      objectLayers: [
        {
          name: 'npcs',
          objects: [{ id: 1, type: 'npc' }],
        },
      ],
    };

    const spawnPoints = extractSpawnPoints(tilemap);
    expect(spawnPoints).toHaveLength(1);
    expect(spawnPoints[0].x).toBe(0);
    expect(spawnPoints[0].y).toBe(0);
  });

  it('handles objects with no properties', () => {
    const tilemap: TilemapData = {
      width: 10,
      height: 8,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      layers: [],
      objectLayers: [
        {
          name: 'npcs',
          objects: [{ id: 1, type: 'npc', x: 100, y: 200 }],
        },
      ],
    };

    const spawnPoints = extractSpawnPoints(tilemap);
    expect(spawnPoints).toHaveLength(1);
    expect(spawnPoints[0].properties).toEqual({});
  });
});

describe('loadTilemap: objectgroup parsing', () => {
  it('parses objectgroup layers alongside tilelayers', async () => {
    const raw = {
      width: 10,
      height: 8,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [
        {
          firstgid: 1,
          name: 'test_tileset',
          image: 'tileset.png',
          imagewidth: 256,
          imageheight: 256,
          tilewidth: 32,
          tileheight: 32,
          columns: 8,
          tilecount: 64,
        },
      ],
      layers: [
        {
          name: 'ground',
          width: 10,
          height: 8,
          data: new Array(80).fill(1),
          visible: true,
          type: 'tilelayer',
        },
        {
          name: 'npcs',
          width: 10,
          height: 8,
          objects: [{ id: 1, type: 'npc', x: 320, y: 256 }],
          visible: true,
          type: 'objectgroup',
        },
      ],
    };
    const fetcher = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(raw),
      } as Response),
    ) as unknown as typeof fetch;

    const result = await loadTilemap({ url: 'test://obj.json', fetch: fetcher });

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0].name).toBe('ground');
    expect(result.objectLayers).toHaveLength(1);
    expect(result.objectLayers?.[0].name).toBe('npcs');
    expect(result.objectLayers?.[0].objects).toHaveLength(1);
  });

  it('sets objectLayers to undefined when no objectgroup layers exist', async () => {
    const raw = {
      width: 10,
      height: 8,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [
        {
          firstgid: 1,
          name: 'test_tileset',
          image: 'tileset.png',
          imagewidth: 256,
          imageheight: 256,
          tilewidth: 32,
          tileheight: 32,
          columns: 8,
          tilecount: 64,
        },
      ],
      layers: [
        {
          name: 'ground',
          width: 10,
          height: 8,
          data: new Array(80).fill(1),
          visible: true,
          type: 'tilelayer',
        },
      ],
    };
    const fetcher = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(raw),
      } as Response),
    ) as unknown as typeof fetch;

    const result = await loadTilemap({ url: 'test://noobj.json', fetch: fetcher });

    expect(result.objectLayers).toBeUndefined();
  });

  it('throws when objectgroup has no objects array', async () => {
    const raw = {
      width: 10,
      height: 8,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [
        {
          firstgid: 1,
          name: 'test_tileset',
          image: 'tileset.png',
          imagewidth: 256,
          imageheight: 256,
          tilewidth: 32,
          tileheight: 32,
          columns: 8,
          tilecount: 64,
        },
      ],
      layers: [
        {
          name: 'ground',
          width: 10,
          height: 8,
          data: new Array(80).fill(1),
          visible: true,
          type: 'tilelayer',
        },
        {
          name: 'broken',
          width: 10,
          height: 8,
          visible: true,
          type: 'objectgroup',
        },
      ],
    };
    const fetcher = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(raw),
      } as Response),
    ) as unknown as typeof fetch;

    await expect(loadTilemap({ url: 'test://badobj.json', fetch: fetcher })).rejects.toThrow(
      'has no "objects" array',
    );
  });
});

describe('extractCollisionGrid', () => {
  it('extracts the collision layer as a boolean array', () => {
    const tilemap: TilemapData = {
      width: 4,
      height: 3,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      layers: [
        {
          name: 'ground',
          width: 4,
          height: 3,
          // GID 1 = grass (walkable). Exercises the explicit collision layer.
          data: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          visible: true,
        },
        {
          name: 'collision',
          width: 4,
          height: 3,
          data: [
            1,
            1,
            1,
            1, // Top row: all solid
            1,
            0,
            0,
            1, // Middle row: walls on edges, walkable center
            1,
            1,
            1,
            1, // Bottom row: all solid
          ],
          visible: true,
        },
      ],
    };

    const grid = extractCollisionGrid(tilemap);

    expect(grid).toBeDefined();
    if (!grid) {
      throw new Error('grid should be defined');
    }

    expect(grid).toHaveLength(12);

    // Top row: all true (solid)
    expect(grid[0]).toBe(true);
    expect(grid[1]).toBe(true);
    expect(grid[2]).toBe(true);
    expect(grid[3]).toBe(true);

    // Middle row: edges are solid, center is walkable
    expect(grid[4]).toBe(true); // left wall
    expect(grid[5]).toBe(false); // walkable
    expect(grid[6]).toBe(false); // walkable
    expect(grid[7]).toBe(true); // right wall

    // Bottom row: all true (solid)
    expect(grid[8]).toBe(true);
    expect(grid[11]).toBe(true);
  });

  it('returns undefined when no collision layer exists', () => {
    const tilemap: TilemapData = {
      width: 2,
      height: 2,
      tilewidth: 16,
      tileheight: 16,
      tilesets: [],
      layers: [
        {
          name: 'ground',
          width: 2,
          height: 2,
          // No collision layer → no blocked cells.
          data: [1, 1, 1, 1],
          visible: true,
        },
      ],
    };

    const grid = extractCollisionGrid(tilemap);
    expect(grid).toBeUndefined();
  });

  it('accepts a custom layer name', () => {
    const tilemap: TilemapData = {
      width: 2,
      height: 2,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      layers: [
        {
          name: 'collision_walls',
          width: 2,
          height: 2,
          data: [0, 1, 0, 0],
          visible: true,
        },
      ],
    };

    const grid = extractCollisionGrid(tilemap, { layerName: 'collision_walls' });

    expect(grid).toBeDefined();
    if (!grid) {
      throw new Error('grid should be defined');
    }
    expect(grid[0]).toBe(false);
    expect(grid[1]).toBe(true);
    expect(grid[2]).toBe(false);
    expect(grid[3]).toBe(false);
  });

  it('maps non-zero GIDs to true regardless of the tile value', () => {
    const tilemap: TilemapData = {
      width: 2,
      height: 1,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      layers: [
        {
          name: 'collision',
          width: 2,
          height: 1,
          data: [5, 0], // GID 5 is solid, 0 is empty
          visible: true,
        },
      ],
    };

    const grid = extractCollisionGrid(tilemap);

    expect(grid).toBeDefined();
    if (!grid) {
      throw new Error('grid should be defined');
    }
    expect(grid[0]).toBe(true);
    expect(grid[1]).toBe(false);
  });
});

describe('buildCollisionGrid (C-376 AC-1)', () => {
  /** Minimal pack config declaring GID 1/2 walkable and GID 8 solid. */
  const makePackConfig = (): PackConfig => ({
    tiles: {
      '1': { name: 'grass', frame: 'grass.png', isWalkable: true },
      '2': { name: 'grass_variant', frame: 'grass_variant.png', isWalkable: true },
      '8': { name: 'brick', frame: 'brick.png', isWalkable: false },
    },
    props: {},
  });

  it('keeps GID 2 (grass_variant, isWalkable: true) fully walkable', () => {
    // C-376 A1 regression: the old default water-GID merge made
    // every grass_variant tile an invisible wall. The manifest says GID 2 is
    // walkable — it must stay open. A solid brick anchors the map so the
    // grid is materialized; every non-brick cell must remain walkable.
    const tilemap: TilemapData = {
      width: 5,
      height: 1,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      layers: [
        {
          name: 'ground',
          width: 5,
          height: 1,
          data: [1, 2, 8, 2, 1], // scattered grass_variant + one brick
          visible: true,
        },
      ],
    };

    const grid = buildCollisionGrid(tilemap, makePackConfig());

    expect(grid).toBeDefined();
    if (!grid) {
      throw new Error('grid should be defined');
    }
    expect(grid[0]).toBe(false);
    expect(grid[1]).toBe(false); // GID 2 walkable
    expect(grid[2]).toBe(true); // brick solid
    expect(grid[3]).toBe(false); // GID 2 walkable
    expect(grid[4]).toBe(false);
  });

  it('derives solid cells from manifest isWalkable (GID 8 → solid)', () => {
    const tilemap: TilemapData = {
      width: 3,
      height: 1,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      layers: [
        {
          name: 'ground',
          width: 3,
          height: 1,
          data: [1, 8, 2],
          visible: true,
        },
      ],
    };

    const grid = buildCollisionGrid(tilemap, makePackConfig());

    expect(grid).toBeDefined();
    if (!grid) {
      throw new Error('grid should be defined');
    }
    expect(grid[0]).toBe(false); // grass walkable
    expect(grid[1]).toBe(true); // brick solid
    expect(grid[2]).toBe(false); // grass_variant walkable
  });

  it('keeps GID 0 (empty) walkable', () => {
    const tilemap: TilemapData = {
      width: 3,
      height: 1,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      layers: [
        {
          name: 'ground',
          width: 3,
          height: 1,
          data: [0, 8, 0], // brick anchor keeps the grid materialized
          visible: true,
        },
      ],
    };

    const grid = buildCollisionGrid(tilemap, makePackConfig());

    expect(grid).toBeDefined();
    if (!grid) {
      throw new Error('grid should be defined');
    }
    expect(grid[0]).toBe(false); // empty = walkable
    expect(grid[1]).toBe(true); // brick
    expect(grid[2]).toBe(false);
  });

  it('warns + fail-closed for unknown GIDs — one warning per layer, not per cell', () => {
    // GID 99 is not declared in the manifest — runtime safety net treats it
    // as solid (authoring error caught earlier by the AC-6 validator). The
    // warning is emitted once per layer for the collected unknown GIDs, not
    // once per cell (CodeRabbit review, C-376 round 2).
    const tilemap: TilemapData = {
      width: 6,
      height: 1,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      layers: [
        {
          name: 'ground',
          width: 6,
          height: 1,
          data: [1, 99, 2, 99, 99, 1], // GID 99 scattered across 3 cells
          visible: true,
        },
      ],
    };

    const warnSpy = spyOn(logger, 'warn');
    try {
      const grid = buildCollisionGrid(tilemap, makePackConfig());

      expect(grid).toBeDefined();
      expect(grid?.[0]).toBe(false);
      expect(grid?.[1]).toBe(true); // unknown → solid
      expect(grid?.[2]).toBe(false);
      expect(grid?.[3]).toBe(true);
      expect(grid?.[4]).toBe(true);
      expect(grid?.[5]).toBe(false);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const call = warnSpy.mock.calls.find((args) => args[0] === 'buildCollisionGrid:unknown-gid');
      expect(call).toBeDefined();
      const payload = call?.[1] as { gids?: number[]; layer?: string };
      expect(payload.gids).toEqual([99]);
      expect(payload.layer).toBe('ground');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('applies the collision layer additively (never re-opens manifest-solid cells)', () => {
    const tilemap: TilemapData = {
      width: 4,
      height: 1,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      layers: [
        {
          name: 'ground',
          width: 4,
          height: 1,
          data: [1, 8, 2, 1], // brick at index 1 is manifest-solid
          visible: true,
        },
        {
          name: 'collision',
          width: 4,
          height: 1,
          data: [0, 0, 1, 1], // marks grass_variant + grass extra solid
          visible: true,
        },
      ],
    };

    const grid = buildCollisionGrid(tilemap, makePackConfig());

    expect(grid).toBeDefined();
    if (!grid) {
      throw new Error('grid should be defined');
    }
    expect(grid[0]).toBe(false); // grass, no collision marker
    expect(grid[1]).toBe(true); // manifest-solid (brick)
    expect(grid[2]).toBe(true); // collision layer added solidity
    expect(grid[3]).toBe(true); // collision layer added solidity
  });

  it('marks decor-layer cells solid by default, opt-out keeps them visual-only', () => {
    // Multiple non-collision tile layers: ground is walkable, a decor layer
    // paints non-walkable GID 8. By default the decor cells become solid
    // (C-376 contract: every non-collision tile layer contributes). With
    // solidityLayers the decor layer is visual-only and never blocks
    // (CodeRabbit review, C-376).
    const tilemap: TilemapData = {
      width: 4,
      height: 1,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      layers: [
        {
          name: 'ground',
          width: 4,
          height: 1,
          data: [1, 1, 1, 1], // all walkable grass
          visible: true,
        },
        {
          name: 'decor',
          width: 4,
          height: 1,
          data: [0, 8, 0, 8], // non-walkable brick decor accents
          visible: true,
        },
      ],
    };

    const defaultGrid = buildCollisionGrid(tilemap, makePackConfig());
    expect(defaultGrid).toBeDefined();
    expect(defaultGrid?.[0]).toBe(false);
    expect(defaultGrid?.[1]).toBe(true); // decor GID 8 solid by default
    expect(defaultGrid?.[2]).toBe(false);
    expect(defaultGrid?.[3]).toBe(true);

    const visualOnlyGrid = buildCollisionGrid(tilemap, makePackConfig(), {
      solidityLayers: ['ground'],
    });
    expect(visualOnlyGrid).toBeUndefined(); // nothing blocks → undefined
  });

  it('handles a named collision layer with packConfig', () => {
    // layerName override: the explicit collision layer is called
    // "collision_walls" — it still applies additively on top of manifest
    // solidity (CodeRabbit review, C-376).
    const tilemap: TilemapData = {
      width: 4,
      height: 1,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      layers: [
        {
          name: 'ground',
          width: 4,
          height: 1,
          data: [1, 8, 2, 1], // brick at index 1 manifest-solid
          visible: true,
        },
        {
          name: 'collision_walls',
          width: 4,
          height: 1,
          data: [0, 0, 1, 1], // additive markers
          visible: true,
        },
      ],
    };

    const grid = buildCollisionGrid(tilemap, makePackConfig(), {
      layerName: 'collision_walls',
    });

    expect(grid).toBeDefined();
    expect(grid?.[0]).toBe(false);
    expect(grid?.[1]).toBe(true); // manifest-solid (brick)
    expect(grid?.[2]).toBe(true); // named collision layer added solidity
    expect(grid?.[3]).toBe(true); // named collision layer added solidity
  });

  it('falls back to the explicit collision layer when packConfig is undefined', () => {
    // Graceful degradation: manifest resolution failed → packConfig undefined;
    // non-collision GIDs are walkable, collision layer still blocks.
    const tilemap: TilemapData = {
      width: 3,
      height: 1,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      layers: [
        {
          name: 'ground',
          width: 3,
          height: 1,
          data: [1, 8, 2],
          visible: true,
        },
        {
          name: 'collision',
          width: 3,
          height: 1,
          data: [0, 1, 0],
          visible: true,
        },
      ],
    };

    const grid = buildCollisionGrid(tilemap, undefined);

    expect(grid).toBeDefined();
    if (!grid) {
      throw new Error('grid should be defined');
    }
    expect(grid[0]).toBe(false);
    expect(grid[1]).toBe(true); // collision layer only
    expect(grid[2]).toBe(false);
  });

  it('returns undefined when no cell is blocked (all-walkable map)', () => {
    const tilemap: TilemapData = {
      width: 3,
      height: 1,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      layers: [
        {
          name: 'ground',
          width: 3,
          height: 1,
          data: [0, 1, 2], // all walkable
          visible: true,
        },
      ],
    };

    const grid = buildCollisionGrid(tilemap, makePackConfig());
    expect(grid).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// C-378 — terrain channel parsing, terrain-derived collision (AC-2/AC-4),
// legacy fallback (AC-8)
// ---------------------------------------------------------------------------

describe('loadTilemap: aikami terrain + elevation channels (C-378)', () => {
  it('parses the aikami.terrain channel into TilemapData.terrain', async () => {
    const raw = createTestMap({
      aikami: {
        formatVersion: 1,
        terrain: ['grass', 'grass', 'dirt', 'water'],
        elevation: [0, 0, 0, 0],
      },
    });
    // createTestMap builds 10×8 = 80 cells — stretch the channels.
    const terrain = new Array<string>(80).fill('grass');
    terrain[2] = 'dirt';
    terrain[3] = 'water';
    raw.aikami = { formatVersion: 1, terrain, elevation: new Array(80).fill(0) };

    const fetchMock = mockFetch(raw);
    const tilemap = await loadTilemap({ url: 'test://aikami-map.json', fetch: fetchMock });

    expect(tilemap.terrain).toBeDefined();
    expect(tilemap.terrain?.[2]).toBe('dirt');
    expect(tilemap.terrain?.[3]).toBe('water');
    expect(tilemap.elevation).toBeDefined();
    expect(tilemap.elevation?.[0]).toBe(0);
  });

  it('leaves terrain undefined when no aikami block is present (legacy path)', async () => {
    const raw = createTestMap();
    const fetchMock = mockFetch(raw);
    const tilemap = await loadTilemap({ url: 'test://legacy-map.json', fetch: fetchMock });

    expect(tilemap.terrain).toBeUndefined();
    expect(tilemap.elevation).toBeUndefined();
  });

  it('rejects an aikami.terrain channel with mismatched dimensions', async () => {
    const raw = createTestMap({
      aikami: { formatVersion: 1, terrain: ['grass', 'dirt'], elevation: [] },
    });
    const fetchMock = mockFetch(raw);

    expect(loadTilemap({ url: 'test://bad-aikami.json', fetch: fetchMock })).rejects.toThrow(
      /aikami\.terrain length/,
    );
  });

  it('parses the layer band property (defaults to ground)', async () => {
    const raw = createTestMap();
    const layers = raw.layers as Record<string, unknown>[];
    layers[0].properties = [{ name: 'band', type: 'string', value: 'decor' }];
    const fetchMock = mockFetch(raw);
    const tilemap = await loadTilemap({ url: 'test://band-map.json', fetch: fetchMock });

    expect(tilemap.layers[0].band).toBe('decor');
  });
});

describe('buildCollisionGrid: terrain-channel path (C-378 AC-2)', () => {
  /** Pack config with grass/dirt walkable and water solid. */
  const makeTerrainPackConfig = (): PackConfig => ({
    tiles: {
      '1': { name: 'grass', frame: 'grass.png', isWalkable: true },
      '4': { name: 'dirt', frame: 'dirt_0.png', isWalkable: true },
      '14': { name: 'water', frame: 'water_0.png', isWalkable: false },
    },
    props: {},
    terrains: [
      { name: 'grass', precedence: 0, wang: 'fill', frameBase: 'grass.png', isWalkable: true },
      { name: 'dirt', precedence: 1, wang: 'corner16', frameBase: 'dirt_0.png', isWalkable: true },
      {
        name: 'water',
        precedence: 2,
        wang: 'corner16',
        frameBase: 'water_0.png',
        isWalkable: false,
      },
    ],
  });

  it('derives solidity from terrain ids, never from the tile drawn (AC-2 load-bearing invariant)', () => {
    // A grass cell adjacent to water renders a water-edge overlay frame in
    // its ground layer (GID 14 — water's frame). The terrain channel says
    // grass. Collision must follow the terrain: grass walkable, water solid.
    const tilemap: TilemapData = {
      width: 2,
      height: 1,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      terrain: ['grass', 'water'],
      layers: [
        {
          name: 'ground',
          width: 2,
          height: 1,
          data: [14, 14], // both cells DRAW water frames — collision must ignore this
          visible: true,
        },
      ],
    };

    const grid = buildCollisionGrid(tilemap, makeTerrainPackConfig());

    expect(grid).toBeDefined();
    expect(grid?.[0]).toBe(false); // grass cell walkable despite water frame
    expect(grid?.[1]).toBe(true); // water cell solid
  });

  it('collision output is identical whether the autotiler ran or not', () => {
    // The byte-identity invariant: the autotiler only changes RENDERED
    // frames, never the terrain channel. Building collision from the raw
    // tilemap (with terrain channel) vs a tilemap whose ground layer was
    // replaced by autotiled frames must produce identical grids.
    const raw: TilemapData = {
      width: 3,
      height: 3,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      terrain: ['grass', 'grass', 'grass', 'grass', 'dirt', 'grass', 'grass', 'grass', 'water'],
      layers: [
        { name: 'ground', width: 3, height: 3, data: new Array(9).fill(1), visible: true },
        { name: 'collision', width: 3, height: 3, data: new Array(9).fill(0), visible: true },
      ],
    };

    const withoutAutotile = buildCollisionGrid(raw, makeTerrainPackConfig());
    // After autotiling, the ground layer GIDs become whatever frames the
    // autotiler resolved — collision must be identical because it reads the
    // terrain channel only.
    const autotiled: TilemapData = {
      ...raw,
      layers: [
        {
          name: 'ground',
          width: 3,
          height: 3,
          data: [14, 14, 14, 14, 4, 14, 14, 14, 14],
          visible: true,
        },
        { name: 'collision', width: 3, height: 3, data: new Array(9).fill(0), visible: true },
      ],
    };
    const withAutotile = buildCollisionGrid(autotiled, makeTerrainPackConfig());

    expect(withAutotile).toEqual(withoutAutotile);
    expect(withAutotile?.[4]).toBe(false); // dirt walkable
    expect(withAutotile?.[8]).toBe(true); // water solid
  });

  it('unknown terrain ids fall back to base terrain walkability + warn once', () => {
    const warnSpy = spyOn(logger, 'warn');
    try {
      const tilemap: TilemapData = {
        width: 2,
        height: 1,
        tilewidth: 32,
        tileheight: 32,
        tilesets: [],
        terrain: ['grass', 'mystery'],
        layers: [{ name: 'ground', width: 2, height: 1, data: [1, 1], visible: true }],
      };

      const grid = buildCollisionGrid(tilemap, makeTerrainPackConfig());

      expect(grid).toBeUndefined(); // both fall back to walkable grass
      const call = warnSpy.mock.calls.find(
        (args) => args[0] === 'buildCollisionGrid:unknown-terrain',
      );
      expect(call).toBeDefined();
      const payload = call?.[1] as { terrains?: string[] };
      expect(payload.terrains).toEqual(['mystery']);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('an empty string cell resolves to the base terrain', () => {
    const tilemap: TilemapData = {
      width: 2,
      height: 1,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      terrain: ['', 'water'],
      layers: [{ name: 'ground', width: 2, height: 1, data: [1, 14], visible: true }],
    };

    const grid = buildCollisionGrid(tilemap, makeTerrainPackConfig());
    expect(grid?.[0]).toBe(false); // '' → base grass walkable
    expect(grid?.[1]).toBe(true); // water solid
  });
});

describe('buildCollisionGrid: solidityLayers honoured with decor/overhead (C-378 AC-4)', () => {
  const makeTerrainPackConfig = (): PackConfig => ({
    tiles: {
      '1': { name: 'grass', frame: 'grass.png', isWalkable: true },
      '13': { name: 'roof', frame: 'roof.png', isWalkable: false },
    },
    props: {},
    terrains: [
      { name: 'grass', precedence: 0, wang: 'fill', frameBase: 'grass.png', isWalkable: true },
    ],
  });

  it('overhead roof tiles never block — only terrain + explicit collision layer contribute', () => {
    // Map with a terrain channel (all grass) + an overhead layer that is
    // ENTIRELY roof tiles (isWalkable: false). Zero cells may be blocked by
    // the overhead layer: terrain says walkable, collision layer is empty.
    const tilemap: TilemapData = {
      width: 3,
      height: 1,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      terrain: ['grass', 'grass', 'grass'],
      layers: [
        { name: 'ground', width: 3, height: 1, data: [1, 1, 1], visible: true },
        {
          name: 'overhead',
          width: 3,
          height: 1,
          data: [13, 13, 13], // roof everywhere — must NOT block
          band: 'overhead',
          visible: true,
        },
        { name: 'collision', width: 3, height: 1, data: [0, 0, 0], visible: true },
      ],
    };

    const grid = buildCollisionGrid(tilemap, makeTerrainPackConfig());
    // The explicit collision layer exists (all zeros) → grid is materialized
    // with every cell walkable — no cell is blocked by the overhead layer.
    expect(grid).toBeDefined();
    expect(grid?.every((v) => v === false)).toBe(true);
  });
});

describe('buildCollisionGrid: legacy baked-GID path still works (C-378 AC-8)', () => {
  it('a map with no terrain channel derives solidity from manifest tiles (legacy)', () => {
    const packConfig: PackConfig = {
      tiles: {
        '1': { name: 'grass', frame: 'grass.png', isWalkable: true },
        '8': { name: 'brick', frame: 'brick.png', isWalkable: false },
      },
      props: {},
      // no terrains block → legacy path
    };

    const tilemap: TilemapData = {
      width: 2,
      height: 1,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      layers: [{ name: 'ground', width: 2, height: 1, data: [1, 8], visible: true }],
    };

    const grid = buildCollisionGrid(tilemap, packConfig);
    expect(grid?.[0]).toBe(false);
    expect(grid?.[1]).toBe(true);
  });
});
