// packages/frontend/engine/src/pixi_init_options.test.ts
//
// Blank-canvas regression guard. `canvas.width` is IDL `unsigned long`, so a
// negative measurement wraps modulo 2^32 into a multi-gigapixel backing store
// that WebKit refuses to allocate — the canvas silently keeps its 300x150
// default and the game renders black. Some WebKitGTK hosts report exactly that
// from every DOM viewport API, so no measured dimension may reach the renderer
// unsanitized.

import { describe, expect, test } from 'bun:test';
import {
  clampResolutionToCanvasArea,
  resolvePixiInitOptions,
  sanitizeCanvasDimension,
} from './pixi_init_options.ts';

/** Stand-in for the canvas element — resolve never touches its members. */
const canvas = {} as HTMLCanvasElement;

const resolve = (
  options: { width?: number; height?: number } = {},
  devicePixelRatio?: number,
): ReturnType<typeof resolvePixiInitOptions> =>
  resolvePixiInitOptions({ canvas, ...options }, { isE2E: false, devicePixelRatio });

/** WebKit's ceiling: width * height must not exceed 2^28. */
const MAX_CANVAS_AREA = 268_435_456;

describe('sanitizeCanvasDimension', () => {
  test('passes a normal measurement through', () => {
    expect(sanitizeCanvasDimension(1445, 800)).toBe(1445);
  });

  test('falls back on the negative values WebKitGTK reports', () => {
    expect(sanitizeCanvasDimension(-134880, 800)).toBe(800);
  });

  test('falls back on zero, NaN, Infinity and undefined', () => {
    expect(sanitizeCanvasDimension(0, 800)).toBe(800);
    expect(sanitizeCanvasDimension(Number.NaN, 800)).toBe(800);
    expect(sanitizeCanvasDimension(Number.POSITIVE_INFINITY, 800)).toBe(800);
    expect(sanitizeCanvasDimension(undefined, 800)).toBe(800);
  });

  test('caps the billions-scale clientWidth garbage at the axis limit', () => {
    expect(sanitizeCanvasDimension(1_405_000_003, 800)).toBe(16_384);
  });

  test('floors fractional measurements', () => {
    expect(sanitizeCanvasDimension(1444.7, 800)).toBe(1444);
  });
});

describe('clampResolutionToCanvasArea', () => {
  test('leaves a normal viewport untouched', () => {
    expect(clampResolutionToCanvasArea({ width: 1445, height: 1432, resolution: 2 })).toBe(2);
  });

  test('caps resolution so the backing store fits the area limit', () => {
    const width = 12_000;
    const height = 10_000;
    const resolution = clampResolutionToCanvasArea({ width, height, resolution: 2 });
    expect(resolution).toBeLessThan(2);
    expect(width * resolution * (height * resolution)).toBeLessThanOrEqual(MAX_CANVAS_AREA);
  });
});

describe('resolvePixiInitOptions', () => {
  test('never emits a canvas area WebKit would refuse', () => {
    const { width, height, resolution } = resolve({ width: -134880, height: -100320 }, -0.0104);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(width * resolution * (height * resolution)).toBeLessThanOrEqual(MAX_CANVAS_AREA);
  });

  test('substitutes defaults for negative dimensions', () => {
    expect(resolve({ width: -134880, height: -100320 })).toMatchObject({
      width: 800,
      height: 600,
    });
  });

  test('keeps a negative devicePixelRatio from reaching resolution', () => {
    expect(resolve({ width: 1445, height: 1432 }, -0.0104).resolution).toBe(1);
  });

  test('keeps a NaN devicePixelRatio from reaching resolution', () => {
    expect(resolve({ width: 1445, height: 1432 }, Number.NaN).resolution).toBe(1);
  });

  test('still honours a real viewport and HiDPI ratio (C-377 AC-2)', () => {
    expect(resolve({ width: 1445, height: 1432 }, 2)).toMatchObject({
      width: 1445,
      height: 1432,
      resolution: 2,
      autoDensity: true,
      antialias: false,
    });
  });

  test('still clamps devicePixelRatio to 2 (C-377 AC-2)', () => {
    expect(resolve({ width: 1445, height: 1432 }, 3).resolution).toBe(2);
  });
});
