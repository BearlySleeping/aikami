// packages/frontend/engine/src/__tests__/jton_parser.test.ts

import { describe, expect, test } from 'bun:test';
import { jtonToTilemapData, parseJtonMap } from '../assets/jton_parser.ts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** A valid minimal JTON map source (2×2 with one tile). */
const MINIMAL_JTON = `\
:map: 2 2 32 32
:tileset: test_tileset 1 test.png 128 128 32 32 4 16
:tiles: ground 1
0 0 14
1 0 15
:collision:
0 0
:spawn: 32 32 player town_spawn
:transition: 0 64 32 32 next_map next_spawn
]`;

// ---------------------------------------------------------------------------
// Basic parsing
// ---------------------------------------------------------------------------

describe('parseJtonMap — basic parsing', () => {
  test('parses map dimensions and tile size', () => {
    const result = parseJtonMap(MINIMAL_JTON, 'test.jton');
    expect(result.mapWidth).toBe(2);
    expect(result.mapHeight).toBe(2);
    expect(result.tileWidth).toBe(32);
    expect(result.tileHeight).toBe(32);
  });

  test('parses tileset entries', () => {
    const result = parseJtonMap(MINIMAL_JTON, 'test.jton');
    expect(result.tilesets.length).toBe(1);
    const ts = result.tilesets[0];
    expect(ts.name).toBe('test_tileset');
    expect(ts.firstgid).toBe(1);
    expect(ts.image).toBe('test.png');
    expect(ts.imagewidth).toBe(128);
    expect(ts.imageheight).toBe(128);
    expect(ts.tilewidth).toBe(32);
    expect(ts.tileheight).toBe(32);
    expect(ts.columns).toBe(4);
    expect(ts.tilecount).toBe(16);
    expect(ts.spacing).toBe(0);
    expect(ts.margin).toBe(0);
  });

  test('parses tile layers with correct tile placement', () => {
    const result = parseJtonMap(MINIMAL_JTON, 'test.jton');
    const groundLayer = result.layers.find((l) => l.name === 'ground');
    expect(groundLayer).toBeDefined();
    expect(groundLayer?.width).toBe(2);
    expect(groundLayer?.height).toBe(2);
    expect(groundLayer?.visible).toBe(true);
    // Row-major: [0][0]=14, [0][1]=15, [1][0]=0, [1][1]=0
    expect(groundLayer?.data[0]).toBe(14); // row 0, col 0
    expect(groundLayer?.data[1]).toBe(15); // row 0, col 1
    expect(groundLayer?.data[2]).toBe(0); // row 1, col 0 (empty)
    expect(groundLayer?.data[3]).toBe(0); // row 1, col 1 (empty)
  });

  test('parses collision layer', () => {
    const result = parseJtonMap(MINIMAL_JTON, 'test.jton');
    const collisionLayer = result.layers.find((l) => l.name === 'collision');
    expect(collisionLayer).toBeDefined();
    expect(collisionLayer?.visible).toBe(false);
    expect(collisionLayer?.data[0]).toBe(1); // solid at (0,0)
    expect(collisionLayer?.data[1]).toBe(0); // empty
  });

  test('parses spawn points', () => {
    const result = parseJtonMap(MINIMAL_JTON, 'test.jton');
    expect(result.spawnPoints.length).toBe(1);
    expect(result.spawnPoints[0]).toEqual({
      x: 32,
      y: 32,
      type: 'player',
      spawnId: 'town_spawn',
    });
  });

  test('parses NPC spawn points with dialogue', () => {
    const jton = `:map: 2 2 32 32
:tileset: ts 1 t.png 64 64 32 32 2 4
:spawn: 64 32 npc merchant_1 Hello_there! 1 swords,potions
]`;
    const result = parseJtonMap(jton, 'test.jton');
    expect(result.spawnPoints[0].type).toBe('npc');
    expect(result.spawnPoints[0].npcId).toBe('merchant_1');
    expect(result.spawnPoints[0].dialogue).toBe('Hello there!');
    expect(result.spawnPoints[0].isVendor).toBe(true);
    expect(result.spawnPoints[0].vendorInventory).toBe('swords,potions');
  });

  test('parses transition zones', () => {
    const result = parseJtonMap(MINIMAL_JTON, 'test.jton');
    expect(result.transitionZones.length).toBe(1);
    expect(result.transitionZones[0]).toEqual({
      x: 0,
      y: 64,
      width: 32,
      height: 32,
      targetMap: 'next_map',
      targetSpawnId: 'next_spawn',
    });
  });
});

// ---------------------------------------------------------------------------
// Empty cell handling
// ---------------------------------------------------------------------------

describe('parseJtonMap — empty cells', () => {
  test('fills omitted tiles with 0', () => {
    const jton = `:map: 3 3 32 32
:tileset: ts 1 t.png 96 96 32 32 3 9
:tiles: ground 1
1 1 14
]`;
    const result = parseJtonMap(jton, 'test.jton');
    const layer = result.layers[0];
    expect(layer?.data[0]).toBe(0); // (0,0) - empty
    expect(layer?.data[4]).toBe(14); // (1,1) = index 1*3+1 = 4
    expect(layer?.data[8]).toBe(0); // (2,2) - empty
  });

  test('empty collision sections produce no collision layer', () => {
    const jton = `:map: 2 2 32 32
:tileset: ts 1 t.png 64 64 32 32 2 4
]`;
    const result = parseJtonMap(jton, 'test.jton');
    const collisionLayer = result.layers.find((l) => l.name === 'collision');
    expect(collisionLayer).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Multiple layers
// ---------------------------------------------------------------------------

describe('parseJtonMap — multiple layers', () => {
  test('parses multiple tile layers in order', () => {
    const jton = `:map: 2 2 32 32
:tileset: ts 1 t.png 64 64 32 32 2 4
:tiles: ground 1
0 0 14
:tiles: walls 1
0 1 15
:tiles: decorations 0
1 1 20
]`;
    const result = parseJtonMap(jton, 'test.jton');
    expect(result.layers.length).toBe(3);
    expect(result.layers[0].name).toBe('ground');
    expect(result.layers[0].visible).toBe(true);
    expect(result.layers[1].name).toBe('walls');
    expect(result.layers[1].visible).toBe(true);
    expect(result.layers[2].name).toBe('decorations');
    expect(result.layers[2].visible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// jtonToTilemapData conversion
// ---------------------------------------------------------------------------

describe('jtonToTilemapData', () => {
  test('converts JTON result to TilemapData format', () => {
    const result = parseJtonMap(MINIMAL_JTON, 'test.jton');
    const tilemap = jtonToTilemapData(result);

    expect(tilemap.width).toBe(2);
    expect(tilemap.height).toBe(2);
    expect(tilemap.tilewidth).toBe(32);
    expect(tilemap.tileheight).toBe(32);
    expect(tilemap.tilesets.length).toBe(1);
    expect(tilemap.layers.length).toBe(2); // ground + collision
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('parseJtonMap — errors', () => {
  test('throws on empty source', () => {
    expect(() => parseJtonMap('', 'test.jton')).toThrow();
  });

  test('throws on missing map header', () => {
    const jton = `:tileset: ts 1 t.png 64 64 32 32 2 4
:tiles: ground 1
0 0 14
]`;
    expect(() => parseJtonMap(jton, 'test.jton')).toThrow();
  });

  test('throws on invalid tileset header', () => {
    const jton = `:map: 2 2 32 32
:tileset: bad
]`;
    expect(() => parseJtonMap(jton, 'test.jton')).toThrow();
  });
});
