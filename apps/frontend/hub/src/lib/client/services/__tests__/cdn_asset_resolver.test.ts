// apps/frontend/hub/src/lib/client/services/__tests__/cdn_asset_resolver.test.ts
//
// Regression guards for the CDN asset resolver's game-data path lookup.
//
// Map manifests (Tiled JSON / JTON) reference tileset images by game-data
// path (`/game-data/sprites/tilesets/debug_tiles.png`), while catalog entries
// are keyed by tag. The map studio enables `resolveGameDataPaths` so pasted
// manifests resolve real published textures instead of falling back to
// diagnostics — these tests pin that behavior, including the default-off
// guarantee for every other caller (walk sandbox).

import { describe, expect, test } from 'bun:test';
import type { CatalogAssetEntry } from '@aikami/schemas';
import { createCdnAssetResolver, normalizeGameDataPath } from '../cdn_asset_resolver.ts';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const entry = (overrides: Partial<CatalogAssetEntry> & { tag: string }): CatalogAssetEntry =>
  ({
    hash: HASH_A,
    sizeBytes: 1024,
    category: 'tilesets',
    ext: '.png',
    licenses: ['CC-BY-SA 4.0'],
    authors: ['Someone'],
    sourceUrls: [],
    ...overrides,
  }) as CatalogAssetEntry;

const TILESET = entry({ tag: 'sprites:tilesets:debug_tiles', hash: HASH_A });
const MAP = entry({
  tag: 'maps:sandbox_combat',
  hash: HASH_B,
  category: 'maps',
  ext: '.json',
  licenses: [],
  authors: [],
});

const ORIGIN = 'https://cdn.example.test';

describe('normalizeGameDataPath', () => {
  test('strips the leading slash', () => {
    expect(normalizeGameDataPath('/sprites/tilesets/atlas.webp')).toBe('sprites/tilesets/atlas.webp');
  });

  test('strips the game-data prefix', () => {
    expect(normalizeGameDataPath('game-data/sprites/tilesets/atlas.webp')).toBe(
      'sprites/tilesets/atlas.webp',
    );
  });

  test('strips both the leading slash and the game-data prefix', () => {
    expect(normalizeGameDataPath('/game-data/sprites/tilesets/atlas.webp')).toBe(
      'sprites/tilesets/atlas.webp',
    );
  });

  test('leaves an already-relative path untouched', () => {
    expect(normalizeGameDataPath('sprites/tilesets/atlas.webp')).toBe('sprites/tilesets/atlas.webp');
  });
});

describe('createCdnAssetResolver — tag lookup', () => {
  test('resolves a tag to its content-addressed URL', () => {
    const resolver = createCdnAssetResolver({ originUrl: ORIGIN, entries: [TILESET] });
    expect(resolver.resolve('sprites:tilesets:debug_tiles')).toBe(
      `${ORIGIN}/assets/aa/${HASH_A}.png`,
    );
  });

  test('returns null for an unknown tag', () => {
    const resolver = createCdnAssetResolver({ originUrl: ORIGIN, entries: [TILESET] });
    expect(resolver.resolve('sprites:tilesets:missing')).toBeNull();
  });

  test('normalizes a trailing slash on the origin', () => {
    const resolver = createCdnAssetResolver({ originUrl: `${ORIGIN}/`, entries: [TILESET] });
    expect(resolver.resolve('sprites:tilesets:debug_tiles')).toBe(
      `${ORIGIN}/assets/aa/${HASH_A}.png`,
    );
  });

  test('resolveLicenses reads the entry license strings verbatim', () => {
    const resolver = createCdnAssetResolver({ originUrl: ORIGIN, entries: [TILESET] });
    expect(resolver.resolveLicenses?.('sprites:tilesets:debug_tiles')).toEqual(['CC-BY-SA 4.0']);
  });
});

describe('createCdnAssetResolver — game-data path lookup', () => {
  test('path lookup is OFF by default (sandbox behavior unchanged)', () => {
    const resolver = createCdnAssetResolver({ originUrl: ORIGIN, entries: [TILESET] });
    expect(resolver.resolve('/game-data/sprites/tilesets/debug_tiles.png')).toBeNull();
  });

  test('resolves a manifest tileset image path when enabled', () => {
    const resolver = createCdnAssetResolver({
      originUrl: ORIGIN,
      entries: [TILESET],
      resolveGameDataPaths: true,
    });
    expect(resolver.resolve('/game-data/sprites/tilesets/debug_tiles.png')).toBe(
      `${ORIGIN}/assets/aa/${HASH_A}.png`,
    );
  });

  test('accepts the path with and without the game-data prefix', () => {
    const resolver = createCdnAssetResolver({
      originUrl: ORIGIN,
      entries: [TILESET],
      resolveGameDataPaths: true,
    });
    const expected = `${ORIGIN}/assets/aa/${HASH_A}.png`;
    expect(resolver.resolve('sprites/tilesets/debug_tiles.png')).toBe(expected);
    expect(resolver.resolve('game-data/sprites/tilesets/debug_tiles.png')).toBe(expected);
  });

  test('tag lookup keeps priority over path lookup', () => {
    const resolver = createCdnAssetResolver({
      originUrl: ORIGIN,
      entries: [TILESET, MAP],
      resolveGameDataPaths: true,
    });
    expect(resolver.resolve('maps:sandbox_combat')).toBe(`${ORIGIN}/assets/bb/${HASH_B}.json`);
  });

  test('resolves a published map by its game-data path too', () => {
    const resolver = createCdnAssetResolver({
      originUrl: ORIGIN,
      entries: [TILESET, MAP],
      resolveGameDataPaths: true,
    });
    expect(resolver.resolve('/game-data/maps/sandbox_combat.json')).toBe(
      `${ORIGIN}/assets/bb/${HASH_B}.json`,
    );
  });

  test('returns null for a path with no matching entry', () => {
    const resolver = createCdnAssetResolver({
      originUrl: ORIGIN,
      entries: [TILESET],
      resolveGameDataPaths: true,
    });
    expect(resolver.resolve('/game-data/sprites/tilesets/not_in_catalog.png')).toBeNull();
  });
});
