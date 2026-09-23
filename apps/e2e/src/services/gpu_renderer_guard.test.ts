// apps/e2e/src/services/gpu_renderer_guard.test.ts
//
// C-548: a capture whose PixiJS renderer fell back to Canvas2D is terrain-less
// and must fail loudly rather than masquerade as valid visual evidence.

import { describe, expect, test } from 'bun:test';
import { assertGpuRendererName } from '../visual/core/gpu_renderer_guard.ts';

describe('assertGpuRendererName', () => {
  test('accepts WebGL and WebGPU', () => {
    expect(() => assertGpuRendererName('webgl')).not.toThrow();
    expect(() => assertGpuRendererName('webgpu')).not.toThrow();
  });

  test('accepts a route with no PixiJS app', () => {
    expect(() => assertGpuRendererName(null)).not.toThrow();
  });

  test('rejects the Canvas2D fallback with an actionable message', () => {
    expect(() => assertGpuRendererName('canvas')).toThrow(/Canvas2D/);
    expect(() => assertGpuRendererName('canvas')).toThrow(/webgl-capable Chromium/i);
  });
});
