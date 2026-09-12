// apps/frontend/hub/src/lib/views/map_studio/__tests__/sample_manifest.test.ts
//
// The sample manifest is the studio's zero-network boot content: it must load
// through the engine's map loader on first paint. These guards pin the fields
// `normalizeTilemap` actually requires — a tileset missing `tileheight` is a
// real failure the studio surfaced once the preview started normalizing raw
// Tiled JSON instead of casting it.

import { describe, expect, test } from 'bun:test';
import { SAMPLE_MANIFEST_TEXT } from '../sample_manifest.ts';

const manifest = JSON.parse(SAMPLE_MANIFEST_TEXT) as Record<string, unknown>;

const MAP_WIDTH = 12;
const MAP_HEIGHT = 9;

describe('sample manifest — loader contract', () => {
  test('is valid JSON', () => {
    expect(() => JSON.parse(SAMPLE_MANIFEST_TEXT)).not.toThrow();
  });

  test('carries the map dimensions and tile size the loader requires', () => {
    expect(manifest.width).toBe(MAP_WIDTH);
    expect(manifest.height).toBe(MAP_HEIGHT);
    expect(manifest.tilewidth).toBe(32);
    expect(manifest.tileheight).toBe(32);
  });

  test('carries a tileset with every field normalizeTilemap requires', () => {
    const tilesets = manifest.tilesets as Record<string, unknown>[];
    expect(Array.isArray(tilesets)).toBe(true);
    expect(tilesets.length).toBe(1);

    const tileset = tilesets[0] as Record<string, unknown>;
    // `tileheight` is the one that bit us — _parseTileset throws without it.
    expect(tileset.tileheight).toBe(32);
    expect(tileset.tilewidth).toBe(32);
    expect(tileset.firstgid).toBe(1);
    expect(tileset.tilecount).toBe(4);
    expect(tileset.columns).toBe(4);
    expect(typeof tileset.name).toBe('string');
  });

  test('references the tileset image by game-data path, not by tag', () => {
    const tilesets = manifest.tilesets as Record<string, unknown>[];
    const image = (tilesets[0] as Record<string, unknown>).image as string;
    // The studio's resolver matches this shape against catalog entries.
    expect(image.startsWith('/game-data/')).toBe(true);
    expect(image.endsWith('.png')).toBe(true);
  });

  test('declares a ground tile layer with a full data array', () => {
    const layers = manifest.layers as Record<string, unknown>[];
    const ground = layers.find((layer) => layer.name === 'ground');
    expect(ground).toBeDefined();
    if (!ground) {
      return;
    }
    expect(ground.type).toBe('tilelayer');
    expect((ground.data as number[]).length).toBe(MAP_WIDTH * MAP_HEIGHT);
  });

  test('declares a collision layer the adapter treats as non-visual', () => {
    const layers = manifest.layers as Record<string, unknown>[];
    const collision = layers.find((layer) => layer.name === 'collision');
    expect(collision).toBeDefined();
    if (!collision) {
      return;
    }
    expect(collision.type).toBe('tilelayer');
    expect((collision.data as number[]).length).toBe(MAP_WIDTH * MAP_HEIGHT);
    // A border ring of blocking cells — the overlay is meaningful, not empty.
    expect((collision.data as number[]).some((cell) => cell !== 0)).toBe(true);
  });

  test('keeps every layer a tile layer — no objectgroup breaks the adapter', () => {
    const layers = manifest.layers as Record<string, unknown>[];
    expect(layers.every((layer) => layer.type === 'tilelayer')).toBe(true);
  });
});
