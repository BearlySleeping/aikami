// packages/frontend/engine/src/pixi_init_options.ts
//
// Contract C-377 AC-2 — PixiJS application init options resolution.
//
// Extracted from pixi_app.ts into a config-free module so engine tests
// (which have no PUBLIC_* env bootstrap) can assert the exact options
// object passed to Application.init: HiDPI resolution, autoDensity,
// disabled antialias, and E2E-gated preserveDrawingBuffer.

import type { PixiAppOptions } from './pixi_app.ts';

/** Default canvas dimensions used when no explicit size is provided. */
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;

/**
 * WebKit refuses to allocate a canvas backing store whose area exceeds
 * 2^28 pixels, logging `Canvas area exceeds the maximum limit` and leaving
 * the canvas at its 300x150 default — a blank render with no thrown error.
 */
const MAX_CANVAS_AREA = 268_435_456;

/** Per-axis ceiling enforced by every major engine's canvas allocator. */
const MAX_CANVAS_DIMENSION = 16_384;

/** Default background color (dark slate). */
const DEFAULT_BACKGROUND = 0x1a1a2e;

/**
 * The resolved PixiJS application init options (C-377 AC-2).
 */
export type PixiInitOptions = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  backgroundColor: number;
  antialias: boolean;
  backgroundAlpha: number;
  resizeTo?: HTMLElement | Window;
  preference: 'webgpu' | 'webgl';
  resolution: number;
  autoDensity: boolean;
  preserveDrawingBuffer: boolean;
};

/**
 * Detects whether the engine is running in E2E visual test mode.
 *
 * Matches GameWorld._isE2ETestMode: URL search param `?e2e=true` or the
 * global `window.__AIKAMI_E2E_TEST_MODE__` flag set by Playwright.
 * Enables `preserveDrawingBuffer` so readPixels/screenshot capture keeps
 * working in the deterministic test path (C-377 AC-2).
 */
export const isE2ETestMode = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('e2e') === 'true') {
      return true;
    }
  } catch {
    // window.location may be unavailable (SSR)
  }
  return !!(window as unknown as Record<string, unknown>).__AIKAMI_E2E_TEST_MODE__; // guard-ignore lint/type-safety/casting: E2E test mode flag on window, not in Window type
};

/**
 * Coerces one canvas axis into a value the renderer can actually allocate.
 *
 * `canvas.width` / `canvas.height` are IDL `unsigned long`: assigning a
 * negative number wraps it modulo 2^32 (e.g. -134880 becomes 4294832416),
 * which blows past {@link MAX_CANVAS_AREA} and makes WebKit silently
 * refuse the allocation. Some WebKitGTK hosts report exactly that kind of
 * garbage from every DOM viewport-measurement API (negative
 * `window.innerWidth`, billions-scale `documentElement.clientWidth`), so
 * anything non-finite, zero, or negative falls back to a sane default
 * rather than reaching the canvas.
 *
 * @param value - The measured dimension, from any source.
 * @param fallback - Used when `value` is not a usable dimension.
 */
export const sanitizeCanvasDimension = (value: number | undefined, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), MAX_CANVAS_DIMENSION);
};

/**
 * Caps `resolution` so `width * height * resolution^2` stays within
 * {@link MAX_CANVAS_AREA}. With both axes already clamped to
 * {@link MAX_CANVAS_DIMENSION} the result never drops below 1, so this is
 * a safety net for oversized-but-valid viewports, not a quality knob.
 *
 * @param options - Sanitized canvas dimensions and the desired resolution.
 */
export const clampResolutionToCanvasArea = (options: {
  width: number;
  height: number;
  resolution: number;
}): number => {
  const { width, height, resolution } = options;
  const area = width * height;
  if (area <= 0) {
    return resolution;
  }
  return Math.min(resolution, Math.sqrt(MAX_CANVAS_AREA / area));
};

/**
 * Resolves the options object passed to {@link Application.init}.
 *
 * Pure and unit-testable (C-377 AC-2): the game canvas renders at native
 * device resolution (`devicePixelRatio`, clamped to 2), `autoDensity` is
 * enabled so the CSS size matches the container, antialiasing is off, and
 * `preserveDrawingBuffer` is enabled only in E2E test mode.
 *
 * @param options - The {@link PixiAppOptions} to resolve.
 * @param runtime - Environment values, injectable for tests.
 */
export const resolvePixiInitOptions = (
  options: PixiAppOptions,
  runtime: { isE2E: boolean; devicePixelRatio?: number },
): PixiInitOptions => {
  const {
    canvas,
    backgroundColor = DEFAULT_BACKGROUND,
    antialias = false,
    backgroundAlpha = 1,
  } = options;
  // Never trust a measured dimension — see sanitizeCanvasDimension.
  const width = sanitizeCanvasDimension(options.width, DEFAULT_WIDTH);
  const height = sanitizeCanvasDimension(options.height, DEFAULT_HEIGHT);
  const rawDpr =
    runtime.devicePixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  // devicePixelRatio is garbage on the same hosts that corrupt innerWidth
  // (observed: -0.0104). A non-finite dpr would propagate NaN into
  // canvas.width and allocate a 0-sized backing store.
  const dpr = Number.isFinite(rawDpr) ? rawDpr : 1;
  // Clamp to [1, 2]: `??` does not catch an explicitly injected 0, which
  // would otherwise yield a degenerate resolution of 0 (C-377 AC-2).
  const resolution = clampResolutionToCanvasArea({
    width,
    height,
    resolution: Math.max(1, Math.min(dpr, 2)),
  });
  return {
    canvas,
    width,
    height,
    backgroundColor,
    antialias,
    backgroundAlpha,
    resizeTo: options.resizeTo,
    preference: options.rendererPreference ?? 'webgl',
    resolution,
    autoDensity: true,
    preserveDrawingBuffer: runtime.isE2E,
  };
};
