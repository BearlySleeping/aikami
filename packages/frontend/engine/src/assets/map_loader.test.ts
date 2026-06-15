// packages/frontend/engine/src/assets/map_loader.test.ts

import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { TilemapData } from './map_loader.ts';
import {
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
