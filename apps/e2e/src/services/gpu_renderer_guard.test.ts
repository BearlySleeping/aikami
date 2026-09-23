// apps/e2e/src/services/gpu_renderer_guard.test.ts
//
// C-548: a capture whose PixiJS renderer fell back to Canvas2D is terrain-less
// and must fail loudly rather than masquerade as valid visual evidence.

import { describe, expect, test } from 'bun:test';
import {
  assertGpuRendererName,
  resolveCaptureRendererMode,
} from '../visual/core/gpu_renderer_guard.ts';

describe('assertGpuRendererName', () => {
  test('accepts WebGL and WebGPU', () => {
    expect(() => assertGpuRendererName('webgl', 'pixi')).not.toThrow();
    expect(() => assertGpuRendererName('webgpu', 'pixi')).not.toThrow();
  });

  test('accepts a route with no PixiJS app', () => {
    expect(() => assertGpuRendererName(null, 'dom')).not.toThrow();
    expect(() => assertGpuRendererName(null, 'pixi')).toThrow(/no renderer/);
  });

  test('rejects the Canvas2D fallback with an actionable message', () => {
    expect(() => assertGpuRendererName('canvas', 'pixi')).toThrow(/Canvas2D/);
    expect(() => assertGpuRendererName('canvas', 'pixi')).toThrow(/webgl-capable Chromium/i);
    expect(() => assertGpuRendererName('canvas', 'dom')).toThrow(/Canvas2D/);
  });
});

describe('resolveCaptureRendererMode', () => {
  test('pixi_loaded is always a Pixi capture', () => {
    expect(
      resolveCaptureRendererMode({
        waitCondition: 'pixi_loaded',
        screenshotSelector: '[data-testid="dialogue-overlay"]',
        canvasCount: 1,
      }),
    ).toBe('pixi');
  });

  test('an explicit canvas target is a Pixi capture', () => {
    expect(
      resolveCaptureRendererMode({ waitCondition: 'game_ready', screenshotSelector: 'canvas' }),
    ).toBe('pixi');
    expect(
      resolveCaptureRendererMode({ waitCondition: 'game_ready', canvasSelector: 'canvas' }),
    ).toBe('pixi');
  });

  test('an explicit non-canvas target is a DOM capture even when the page has a canvas', () => {
    // The dev-sandbox shell renders its own canvas, so "a canvas exists" is not
    // a reliable Pixi signal on its own.
    expect(
      resolveCaptureRendererMode({
        waitCondition: 'game_ready',
        screenshotSelector: '[data-testid="dialogue-overlay"]',
        canvasCount: 1,
      }),
    ).toBe('dom');
    expect(
      resolveCaptureRendererMode({
        waitCondition: 'game_ready',
        screenshotSelector: 'body',
        canvasCount: 1,
      }),
    ).toBe('dom');
  });

  test('with no explicit selector, a canvas infers Pixi', () => {
    expect(resolveCaptureRendererMode({ waitCondition: 'game_ready', canvasCount: 1 })).toBe(
      'pixi',
    );
    expect(resolveCaptureRendererMode({ waitCondition: 'game_ready', canvasCount: 0 })).toBe('dom');
  });
});
