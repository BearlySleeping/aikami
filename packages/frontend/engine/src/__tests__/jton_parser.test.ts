// packages/frontend/engine/src/__tests__/jton_parser.test.ts

import { describe, expect, test } from 'bun:test';
import {
  jtonToTilemapData,
  parseJtonMap,
  SPAWN_STRIDE,
  TRANSITION_STRIDE,
} from '../assets/jton_parser.ts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** A valid minimal JTON map source (2×2 with tiles, collision, spawn, transition). */
const MINIMAL_JTON = `\
:map: 2 2 32 32
:tileset: test_tileset 1 test.png 128 128 32 32 4 16
:tiles: ground 1 (x, y, tileId)
0,0,14
1,0,15
:collision: (x, y)
0,0
:spawn: 32 32 player town_spawn (x, y, type, spawnId)
:transition: 0 64 32 32 next_map next_spawn (x, y, w, h, targetMap, targetSpawnId)
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
    expect(ts.columns).toBe(4);
    expect(ts.tilecount).toBe(16);
  });

  test('parses tile layers with correct tile placement', () => {
    const result = parseJtonMap(MINIMAL_JTON, 'test.jton');
    const groundLayer = result.layers.find((l) => l.name === 'ground');
    expect(groundLayer).toBeDefined();
    expect(groundLayer?.data[0]).toBe(14);
    expect(groundLayer?.data[1]).toBe(15);
    expect(groundLayer?.data[2]).toBe(0);
    expect(groundLayer?.data[3]).toBe(0);
  });

  test('parses collision layer', () => {
    const result = parseJtonMap(MINIMAL_JTON, 'test.jton');
    const collisionLayer = result.layers.find((l) => l.name === 'collision');
    expect(collisionLayer).toBeDefined();
    expect(collisionLayer?.data[0]).toBe(1);
  });

  test('parses spawn points into zero-allocation buffer', () => {
    const result = parseJtonMap(MINIMAL_JTON, 'test.jton');
    expect(result.spawnCount).toBe(1);
    expect(result.spawnBuffer[0]).toBe(32); // x
    expect(result.spawnBuffer[1]).toBe(32); // y
  });

  test('parses NPC spawn into zero-allocation buffer', () => {
    const jton = `:map: 2 2 32 32
:tileset: ts 1 t.png 64 64 32 32 2 4
:spawn: 64 32 npc merchant_1 Hello_there! 1 swords_potions (x, y, type, spawnId, dialogue, isVendor, vendorInventory)
]`;
    const result = parseJtonMap(jton, 'test.jton');
    expect(result.spawnCount).toBe(1);
    const offset = 0 * SPAWN_STRIDE;
    expect(result.spawnBuffer[offset]).toBe(64); // x
    expect(result.spawnBuffer[offset + 1]).toBe(32); // y
    expect(result.spawnBuffer[offset + 6]).toBe(1); // isVendor
  });

  test('parses transition zones into zero-allocation buffer', () => {
    const result = parseJtonMap(MINIMAL_JTON, 'test.jton');
    expect(result.transitionCount).toBe(1);
    const offset = 0 * TRANSITION_STRIDE;
    expect(result.transitionBuffer[offset]).toBe(0); // x
    expect(result.transitionBuffer[offset + 1]).toBe(64); // y
    expect(result.transitionBuffer[offset + 2]).toBe(32); // w
    expect(result.transitionBuffer[offset + 3]).toBe(32); // h
  });
});

// ---------------------------------------------------------------------------
// Column hints are ignored
// ---------------------------------------------------------------------------

describe('parseJtonMap — column hints', () => {
  test('ignores column hints in :tiles: header', () => {
    const jton = `:map: 2 2 32 32
:tileset: ts 1 t.png 64 64 32 32 2 4
:tiles: ground 1 (x, y, tileId)
0,0,14
]`;
    const result = parseJtonMap(jton, 'test.jton');
    expect(result.layers[0].name).toBe('ground');
    expect(result.layers[0].data[0]).toBe(14);
  });

  test('ignores column hints in :spawn: header', () => {
    const jton = `:map: 2 2 32 32
:tileset: ts 1 t.png 64 64 32 32 2 4
:spawn: 0 0 player start (x, y, type, spawnId)
]`;
    const result = parseJtonMap(jton, 'test.jton');
    expect(result.spawnCount).toBe(1);
    expect(result.spawnBuffer[0]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Empty cell handling
// ---------------------------------------------------------------------------

describe('parseJtonMap — empty cells', () => {
  test('fills omitted tiles with 0', () => {
    const jton = `:map: 3 3 32 32
:tileset: ts 1 t.png 96 96 32 32 3 9
:tiles: ground 1 (x, y, tileId)
1,1,14
]`;
    const result = parseJtonMap(jton, 'test.jton');
    const layer = result.layers[0];
    expect(layer?.data[4]).toBe(14); // (1,1) = index 4
    expect(layer?.data[0]).toBe(0); // (0,0) empty
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
:tiles: ground 1 (x, y, tileId)
0,0,14
:tiles: walls 1 (x, y, tileId)
0,1,15
:tiles: decorations 0 (x, y, tileId)
1,1,20
]`;
    const result = parseJtonMap(jton, 'test.jton');
    expect(result.layers.length).toBe(3);
    expect(result.layers[0].name).toBe('ground');
    expect(result.layers[1].name).toBe('walls');
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
    expect(tilemap.tilesets.length).toBe(1);
    expect(tilemap.layers.length).toBe(2);
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
:tiles: ground 1 (x, y, tileId)
0,0,14
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
