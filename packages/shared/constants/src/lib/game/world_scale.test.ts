// packages/shared/constants/src/lib/game/world_scale.test.ts
//
// C-497 — Verifies the named framing-scale policy: the base scale is a named
// constant (not a bare literal) and `computeWorldScale` derives the scale for
// a given tile size and viewport.

import { describe, expect, test } from 'bun:test';
import {
  BASE_TILE_SCREEN_SIZE,
  BASE_WORLD_SCALE,
  computeWorldScale,
  DEFAULT_MAP_WORLD_HEIGHT,
  DEFAULT_MAP_WORLD_WIDTH,
  DEFAULT_TILE_SIZE,
} from './world_scale.ts';

describe('world_scale policy (C-497)', () => {
  test('base scale is a named constant rendering a 32px tile at 128 CSS px', () => {
    expect(BASE_WORLD_SCALE).toBe(4);
    expect(DEFAULT_TILE_SIZE).toBe(32);
    expect(BASE_TILE_SCREEN_SIZE).toBe(DEFAULT_TILE_SIZE * BASE_WORLD_SCALE);
    expect(BASE_TILE_SCREEN_SIZE).toBe(128);
  });

  test('returns the base scale when no map extent is known', () => {
    expect(
      computeWorldScale({ tileSize: DEFAULT_TILE_SIZE, viewport: { width: 1920, height: 1080 } }),
    ).toBe(BASE_WORLD_SCALE);
  });

  test('derives a scale that fits the whole map when it exceeds the viewport', () => {
    // A 800×800 world-pixel map in a 1920×1080 viewport.
    const scale = computeWorldScale({
      tileSize: DEFAULT_TILE_SIZE,
      viewport: { width: 1920, height: 1080 },
      mapSize: { width: 800, height: 800 },
    });
    // fitY = 1080 / 800 = 1.35, fitX = 1920 / 800 = 2.4 → min = 1.35.
    expect(scale).toBeCloseTo(1.35, 4);
    expect(scale).toBeLessThan(BASE_WORLD_SCALE);
  });

  test('never zooms past the base scale', () => {
    // A tiny map should still render at (or below) the base scale — never past it.
    const scale = computeWorldScale({
      tileSize: DEFAULT_TILE_SIZE,
      viewport: { width: 1920, height: 1080 },
      mapSize: { width: 640, height: 480 },
    });
    expect(scale).toBeLessThanOrEqual(BASE_WORLD_SCALE);
  });

  test('default map extents are positive and tile-derived', () => {
    expect(DEFAULT_MAP_WORLD_WIDTH).toBeGreaterThan(0);
    expect(DEFAULT_MAP_WORLD_HEIGHT).toBeGreaterThan(0);
    expect(DEFAULT_MAP_WORLD_WIDTH % DEFAULT_TILE_SIZE).toBe(0);
    expect(DEFAULT_MAP_WORLD_HEIGHT % DEFAULT_TILE_SIZE).toBe(0);
  });
});
