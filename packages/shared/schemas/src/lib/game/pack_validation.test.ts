// packages/shared/schemas/src/lib/game/pack_validation.test.ts
//
// Contract: C-381 Content Pipeline Hardening — AC-5
// Tests for validatePack, isHostileString, and the structured validation result shape.

import { describe, expect, test } from 'bun:test';
import type { ContentPackManifest } from './content_pack.ts';
import { validatePack, isHostileString } from './pack_validation.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const minimalManifest = (overrides?: Partial<ContentPackManifest>): ContentPackManifest => ({
  id: 'test-pack',
  name: 'Test Pack',
  version: '1.0.0',
  updatedAt: '2026-01-01T00:00:00Z',
  startingMapId: 'start_map',
  maps: {
    start_map: { file: 'maps/start.json', name: 'Start' },
  },
  npcs: {},
  items: {},
  dialogues: {},
  ...overrides,
});

// ---------------------------------------------------------------------------
// AC-5: validatePack returns structured results
// ---------------------------------------------------------------------------

describe('validatePack — AC-5: structured validation', () => {
  test('returns { errors, warnings, autoFixes } with packId', () => {
    const result = validatePack(minimalManifest());
    expect(result).toHaveProperty('packId');
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('warnings');
    expect(result).toHaveProperty('autoFixes');
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.autoFixes)).toBe(true);
  });

  test('passes a valid minimal manifest', () => {
    const result = validatePack(minimalManifest());
    expect(result.errors).toHaveLength(0);
  });

  test('detects missing id', () => {
    const result = validatePack(minimalManifest({ id: '' as unknown as undefined }));
    expect(result.errors.some((e) => e.code === 'manifest.missing-id')).toBe(true);
  });

  test('detects missing version', () => {
    const result = validatePack(minimalManifest({ version: '' as unknown as undefined }));
    expect(result.errors.some((e) => e.code === 'manifest.missing-version')).toBe(true);
  });

  test('detects missing startingMapId', () => {
    const result = validatePack(minimalManifest({ startingMapId: '' as unknown as undefined }));
    expect(result.errors.some((e) => e.code === 'manifest.missing-starting-map')).toBe(true);
  });

  test('detects starting map not in maps block', () => {
    const result = validatePack(
      minimalManifest({ startingMapId: 'nonexistent', maps: { other: { file: 'other.json', name: 'Other' } } }),
    );
    expect(result.errors.some((e) => e.code === 'manifest.map-entry-not-found')).toBe(true);
  });

  test('errors have stable machine codes and JSON-pointer paths', () => {
    const result = validatePack(minimalManifest({ id: '' as unknown as undefined }));
    for (const err of result.errors) {
      expect(typeof err.code).toBe('string');
      expect(err.code).toMatch(/^[a-z]+\.[a-z-]+$/);
      expect(typeof err.path).toBe('string');
      expect(err.path.startsWith('/')).toBe(true);
      expect(typeof err.message).toBe('string');
      expect(typeof err.hint).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// AC-1: Provenance checks
// ---------------------------------------------------------------------------

describe('validatePack — AC-1: provenance', () => {
  test('warns when pack credits mention LPC content', () => {
    const result = validatePack(
      minimalManifest({
        credits: {
          art: ['Liberated Pixel Cup (LPC) asset contributors'],
          design: [],
          writing: [],
          music: [],
          thanks: [],
        },
      }),
    );
    expect(result.warnings.some((w) => w.code === 'asset.share-alike-mismatch')).toBe(true);
  });

  test('passes without warnings for non-LPC credits', () => {
    const result = validatePack(
      minimalManifest({
        credits: {
          art: ['Original studio art'],
          design: ['Designer'],
          writing: ['Writer'],
          music: ['Composer'],
          thanks: [],
        },
      }),
    );
    expect(result.warnings.filter((w) => w.code === 'asset.share-alike-mismatch')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC-2: Hostile manifest detection
// ---------------------------------------------------------------------------

describe('validatePack — AC-2: hostile manifest', () => {
  test('rejects absolute URL in atlas textureUrl', () => {
    const result = validatePack(
      minimalManifest({
        atlas: {
          textureUrl: 'https://evil.example.com/tileset.png',
        },
      }),
    );
    expect(result.errors.some((e) => e.code === 'asset.absolute-url')).toBe(true);
  });

  test('rejects path traversal in atlas textureUrl', () => {
    const result = validatePack(
      minimalManifest({
        atlas: {
          textureUrl: '../../etc/passwd',
        },
      }),
    );
    expect(result.errors.some((e) => e.code === 'asset.path-traversal')).toBe(true);
  });

  test('rejects data: scheme in atlas textureUrl', () => {
    const result = validatePack(
      minimalManifest({
        atlas: {
          textureUrl: 'data:image/png;base64,iVBORw0KGgo=',
        },
      }),
    );
    expect(result.errors.some((e) => e.code === 'asset.data-scheme')).toBe(true);
  });

  test('rejects javascript: scheme in atlas textureUrl', () => {
    const result = validatePack(
      minimalManifest({
        atlas: {
          textureUrl: 'javascript:alert(1)',
        },
      }),
    );
    expect(result.errors.some((e) => e.code === 'asset.javascript-scheme')).toBe(true);
  });

  test('rejects multiple hostile patterns simultaneously', () => {
    const result = validatePack(
      minimalManifest({
        atlas: {
          textureUrl: 'https://evil.com/tileset.png',
          spritesheetUrl: '../../escape.json',
        },
      }),
    );
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain('asset.absolute-url');
    expect(codes).toContain('asset.path-traversal');
  });

  test('passes relative paths without hostile patterns', () => {
    const result = validatePack(
      minimalManifest({
        atlas: {
          textureUrl: 'sprites/tileset.png',
          spritesheetUrl: 'sprites/atlas.json',
        },
      }),
    );
    expect(result.errors.filter((e) => e.code.startsWith('asset.'))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC-2: isHostileString
// ---------------------------------------------------------------------------

describe('isHostileString — AC-2', () => {
  test('detects absolute URLs', () => {
    expect(isHostileString('https://example.com/file.png')).toBe(true);
    expect(isHostileString('http://example.com/file.png')).toBe(true);
  });

  test('detects path traversal', () => {
    expect(isHostileString('../file.png')).toBe(true);
    expect(isHostileString('foo/../../bar')).toBe(true);
  });

  test('detects data: scheme', () => {
    expect(isHostileString('data:text/plain;base64,SGVsbG8=')).toBe(true);
  });

  test('detects javascript: scheme', () => {
    expect(isHostileString('javascript:void(0)')).toBe(true);
  });

  test('allows safe relative paths', () => {
    expect(isHostileString('sprites/tileset.png')).toBe(false);
    expect(isHostileString('lpc/hat/magic/hat.webp')).toBe(false);
  });

  test('allows empty string', () => {
    expect(isHostileString('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-5: Performance — under 100ms for Emberwatch-sized pack
// ---------------------------------------------------------------------------

describe('validatePack — AC-5: performance', () => {
  test('completes in under 100ms for a large manifest', () => {
    // Build a manifest with ~100 tiles, ~50 props, ~20 maps
    const tiles: Record<string, { name: string; frame: string; isWalkable: boolean }> = {};
    for (let i = 1; i <= 100; i++) {
      tiles[String(i)] = { name: `tile_${i}`, frame: `tile_${i}.png`, isWalkable: true };
    }
    const props: Record<string, { name: string; frame: string; isWalkable: boolean }> = {};
    for (let i = 1; i <= 50; i++) {
      props[`prop_${i}`] = { name: `prop_${i}`, frame: `prop_${i}.png`, isWalkable: false };
    }
    // Include start_map so startingMapId resolves
    const maps: Record<string, { file: string; name: string }> = {
      start_map: { file: 'maps/start.json', name: 'Start' },
    };
    for (let i = 1; i <= 20; i++) {
      maps[`map_${i}`] = { file: `maps/map_${i}.json`, name: `Map ${i}` };
    }

    const manifest = minimalManifest({
      tiles: tiles as unknown as ContentPackManifest['tiles'],
      props: props as unknown as ContentPackManifest['props'],
      maps: maps as unknown as ContentPackManifest['maps'],
    });

    const start = performance.now();
    const result = validatePack(manifest);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100);
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Type import for test
// ---------------------------------------------------------------------------

type ContentPackMapEntry = {
  file: string;
  name: string;
  defaultSpawnId?: string;
  defaultX?: number;
  defaultY?: number;
  interior?: boolean;
};
