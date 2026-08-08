// packages/frontend/engine/src/__tests__/prop_texture_resolver.test.ts
//
// Unit tests for the deterministic prop frame resolver (C-375 AC-1).
//
// Verifies:
//   - Resolves a frame declared in the spritesheet ('hit').
//   - Falls back to the pack's fallbackTile when the frame is missing
//     ('fallback') — never Texture.WHITE / a 1×1 placeholder.
//   - Returns null when neither the frame nor the fallback exists.
//   - Lookups are memoized (stable resolution per frame key).
//   - Preload is idempotent and the resolver is inert before preload.

import { describe, expect, test } from 'bun:test';
import { Texture } from 'pixi.js';
import {
  createPropFrameResolver,
  type PropSpritesheet,
} from '../rendering/prop_texture_resolver.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fake sheet carrying named frame textures — mirrors Spritesheet.textures. */
const makeSheet = (frames: Record<string, Texture>): PropSpritesheet => ({ textures: frames });

let textureSeq = 0;

/** A real-looking (non-white, non-empty) texture sentinel. */
const makeRealTexture = (): Texture => {
  textureSeq += 1;
  // Mock a real atlas sub-texture: width/height >= 2 so it is never
  // mistaken for the 1×1 Texture.WHITE placeholder sentinel.
  const mock = {
    width: 32,
    height: 32,
    source: { width: 32, height: 32 } as unknown as Texture['source'],
    label: `mock-frame-${textureSeq}`,
  } as unknown as Texture;
  return mock;
};

const WELL = makeRealTexture();
const GRASS = makeRealTexture();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createPropFrameResolver — frame hit', () => {
  test('resolves a declared frame with source "hit"', async () => {
    const handle = createPropFrameResolver({
      textureUrl: '/atlas.webp',
      spritesheetUrl: '/atlas.json',
      fallbackTile: 'grass.png',
      sheetLoader: async () => makeSheet({ 'well.png': WELL, 'grass.png': GRASS }),
    });

    await handle.preload();

    const resolution = handle.resolver('well.png');
    expect(resolution).not.toBeNull();
    expect(resolution?.source).toBe('hit');
    expect(resolution?.frame).toBe('well.png');
    expect(resolution?.texture).toBe(WELL);
  });
});

describe('createPropFrameResolver — fallback on missing frame', () => {
  test('renders fallbackTile with source "fallback" when the frame is absent', async () => {
    const handle = createPropFrameResolver({
      textureUrl: '/atlas.webp',
      spritesheetUrl: '/atlas.json',
      fallbackTile: 'grass.png',
      sheetLoader: async () => makeSheet({ 'grass.png': GRASS }),
    });

    await handle.preload();

    const resolution = handle.resolver('missing_chest.png');
    expect(resolution).not.toBeNull();
    expect(resolution?.source).toBe('fallback');
    expect(resolution?.texture).toBe(GRASS);
  });

  test('never returns Texture.WHITE for a missing frame when fallback exists', async () => {
    const handle = createPropFrameResolver({
      textureUrl: '/atlas.webp',
      spritesheetUrl: '/atlas.json',
      fallbackTile: 'grass.png',
      sheetLoader: async () => makeSheet({ 'grass.png': GRASS }),
    });

    await handle.preload();

    const resolution = handle.resolver('does_not_exist.png');
    expect(resolution?.texture).not.toBe(Texture.WHITE);
    expect(resolution?.texture).toBe(GRASS);
  });
});

describe('createPropFrameResolver — no sheet / no fallback', () => {
  test('returns null when the atlas failed to load (preload never ran)', () => {
    const handle = createPropFrameResolver({
      textureUrl: '/atlas.webp',
      spritesheetUrl: '/atlas.json',
      fallbackTile: 'grass.png',
      sheetLoader: async () => makeSheet({}),
    });

    // Resolver before preload → no sheet → null (caller keeps degraded state)
    expect(handle.resolver('well.png')).toBeNull();
  });

  test('returns null when neither the frame nor the fallbackTile exists', async () => {
    const handle = createPropFrameResolver({
      textureUrl: '/atlas.webp',
      spritesheetUrl: '/atlas.json',
      fallbackTile: 'missing_fallback.png',
      sheetLoader: async () => makeSheet({ 'well.png': WELL }),
    });

    await handle.preload();

    expect(handle.resolver('unknown.png')).toBeNull();
    // A frame that IS present still resolves even when fallback is absent
    expect(handle.resolver('well.png')?.source).toBe('hit');
  });
});

describe('createPropFrameResolver — memoization & lifecycle', () => {
  test('memoizes identical frames (stable resolution object)', async () => {
    const handle = createPropFrameResolver({
      textureUrl: '/atlas.webp',
      spritesheetUrl: '/atlas.json',
      fallbackTile: 'grass.png',
      sheetLoader: async () => makeSheet({ 'well.png': WELL, 'grass.png': GRASS }),
    });

    await handle.preload();

    const first = handle.resolver('well.png');
    const second = handle.resolver('well.png');
    expect(first).toBe(second);
  });

  test('preload is idempotent (second call is a no-op)', async () => {
    let loadCount = 0;
    const handle = createPropFrameResolver({
      textureUrl: '/atlas.webp',
      spritesheetUrl: '/atlas.json',
      fallbackTile: 'grass.png',
      sheetLoader: async () => {
        loadCount++;
        return makeSheet({ 'grass.png': GRASS });
      },
    });

    await handle.preload();
    await handle.preload();
    expect(loadCount).toBe(1);
    expect(handle.isPreloaded()).toBe(true);
  });

  test('clearCache drops memoized resolutions', async () => {
    const handle = createPropFrameResolver({
      textureUrl: '/atlas.webp',
      spritesheetUrl: '/atlas.json',
      fallbackTile: 'grass.png',
      sheetLoader: async () => makeSheet({ 'well.png': WELL, 'grass.png': GRASS }),
    });

    await handle.preload();
    expect(handle.resolver('well.png')).not.toBeNull();
    handle.clearCache();
    // After clear, the same frame resolves again (fresh resolution object)
    const fresh = handle.resolver('well.png');
    expect(fresh?.source).toBe('hit');
  });
});
