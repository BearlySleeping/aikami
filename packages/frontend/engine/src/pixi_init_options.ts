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
  return !!(window as unknown as Record<string, unknown>).__AIKAMI_E2E_TEST_MODE__;
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
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
    backgroundColor = DEFAULT_BACKGROUND,
    antialias = false,
    backgroundAlpha = 1,
  } = options;
  const dpr =
    runtime.devicePixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  // Clamp to [1, 2]: `??` does not catch an explicitly injected 0, which
  // would otherwise yield a degenerate resolution of 0 (C-377 AC-2).
  const resolution = Math.max(1, Math.min(dpr, 2));
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
