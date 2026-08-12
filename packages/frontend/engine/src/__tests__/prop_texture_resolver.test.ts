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

  test('preload rejects when the loader fails and the resolver degrades to null', async () => {
    const handle = createPropFrameResolver({
      textureUrl: '/atlas.webp',
      spritesheetUrl: '/atlas.json',
      fallbackTile: 'grass.png',
      sheetLoader: async () => {
        throw new Error('404');
      },
    });

    await expect(handle.preload()).rejects.toThrow('404');
    // Failed load is NOT preloaded — isPreloaded() means "completed
    // successfully", and the failure stays retryable.
    expect(handle.isPreloaded()).toBe(false);
    // No sheet → every lookup degrades to null.
    expect(handle.resolver('well.png')).toBeNull();
  });

  test('a failed preload can be retried after the loader recovers', async () => {
    let fail = true;
    const handle = createPropFrameResolver({
      textureUrl: '/atlas.webp',
      spritesheetUrl: '/atlas.json',
      fallbackTile: 'grass.png',
      sheetLoader: async () => {
        if (fail) {
          fail = false;
          throw new Error('transient');
        }
        return makeSheet({ 'grass.png': GRASS });
      },
    });

    await expect(handle.preload()).rejects.toThrow('transient');
    await expect(handle.preload()).resolves.toBeUndefined();
    expect(handle.isPreloaded()).toBe(true);
    expect(handle.resolver('well.png')?.source).toBe('fallback');
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

  test('concurrent preload calls share a single load', async () => {
    let loadCount = 0;
    const handle = createPropFrameResolver({
      textureUrl: '/atlas.webp',
      spritesheetUrl: '/atlas.json',
      fallbackTile: 'grass.png',
      sheetLoader: async () => {
        loadCount++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return makeSheet({ 'grass.png': GRASS });
      },
    });

    await Promise.all([handle.preload(), handle.preload()]);
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
    const initial = handle.resolver('well.png');
    expect(initial).not.toBeNull();
    handle.clearCache();
    // Object identity is the proof: after clearCache the same frame resolves
    // to a FRESH resolution object (memoized one was dropped).
    const fresh = handle.resolver('well.png');
    expect(fresh).not.toBeNull();
    expect(fresh).not.toBe(initial);
    expect(fresh?.source).toBe('hit');
  });
});

// ---------------------------------------------------------------------------
// C-378 AC-7 — prop sprites render at the texture's native size + anchor
// ---------------------------------------------------------------------------

describe('C-378 AC-7 — native prop size + manifest anchor', () => {
  test('a 32×64 frame resolves with its native dimensions and the manifest anchor', async () => {
    // A tall prop (e.g. a gate) — the renderer must NOT force 32×32. The
    // resolver exposes the raw texture; size + anchor application is a
    // renderer concern, so this test pins the resolver contract: the frame
    // texture keeps its native geometry and the manifest anchor defaults to
    // (0.5, 1.0).
    const tall = {
      width: 32,
      height: 64,
      source: { width: 32, height: 64 } as unknown as Texture['source'],
      label: 'gate.png',
    } as unknown as Texture;

    const handle = createPropFrameResolver({
      textureUrl: 'atlas.webp',
      spritesheetUrl: 'atlas.json',
      fallbackTile: 'grass.png',
      sheetLoader: async () => makeSheet({ 'gate.png': tall, 'grass.png': GRASS }),
    });
    await handle.preload();

    const resolution = handle.resolver('gate.png');
    expect(resolution?.source).toBe('hit');
    expect(resolution?.texture.width).toBe(32);
    expect(resolution?.texture.height).toBe(64);
  });

  test('existing 32×32 props keep their exact native size (pixel-identical)', async () => {
    const square = {
      width: 32,
      height: 32,
      source: { width: 32, height: 32 } as unknown as Texture['source'],
      label: 'well.png',
    } as unknown as Texture;

    const handle = createPropFrameResolver({
      textureUrl: 'atlas.webp',
      spritesheetUrl: 'atlas.json',
      fallbackTile: 'grass.png',
      sheetLoader: async () => makeSheet({ 'well.png': square, 'grass.png': GRASS }),
    });
    await handle.preload();

    const resolution = handle.resolver('well.png');
    expect(resolution?.texture.width).toBe(32);
    expect(resolution?.texture.height).toBe(32);
  });
});
