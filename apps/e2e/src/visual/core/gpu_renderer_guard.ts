// apps/e2e/src/visual/core/gpu_renderer_guard.ts
//
// C-548: refuse visual evidence captured on a non-GPU renderer.
//
// A headless browser without a WebGL context (Playwright's default
// `chromium_headless_shell` has none) makes PixiJS fall back to Canvas2D.
// Canvas2D silently drops every custom-shader `Mesh` — the ENTIRE tilemap
// (autotiled terrain AND the baked ground/decor/overhead bands). The capture
// still looks like a valid screenshot, just with the whole map missing, which
// is exactly how terrain-less Emberwatch evidence was produced.
//
// Kept dependency-free so it is unit-testable without launching a browser.

/**
 * Throws when a PixiJS renderer name is neither WebGL nor WebGPU.
 *
 * `null` is only valid for DOM-only captures; a missing PixiJS renderer fails closed.
 *
 * @param renderer - `window.__PIXI_APP__.renderer.name`, or null when absent.
 * @param mode - Whether the capture expects PixiJS or a DOM-only surface.
 */
export const assertGpuRendererName = (renderer: string | null, mode: 'pixi' | 'dom'): void => {
  if ((renderer === null && mode === 'dom') || renderer === 'webgl' || renderer === 'webgpu') {
    return;
  }
  if (renderer === null) {
    throw new Error('C-548: PixiJS capture has no renderer; refusing to capture missing terrain.');
  }
  throw new Error(
    `C-548: PixiJS initialized the "${renderer}" renderer, not WebGL/WebGPU. ` +
      'Custom-shader tilemap meshes do not render on Canvas2D, so this capture would be ' +
      'terrain-less. Launch a WebGL-capable Chromium (the full build under ' +
      'PLAYWRIGHT_BROWSERS_PATH, e.g. `--use-angle=swiftshader --enable-unsafe-swiftshader`).',
  );
};

/** The selectors and readiness signal that decide whether a capture is Pixi or DOM. */
export type CaptureRendererInputs = {
  /** The suite's `waitCondition`. */
  waitCondition: 'pixi_loaded' | 'game_ready' | 'hub_ready';
  /** The case's explicit `canvasSelector`, if any. */
  canvasSelector?: string;
  /** The case's explicit `screenshotSelector`, if any. */
  screenshotSelector?: string;
  /** How many `canvas` elements the page actually has. Only consulted when no
   * explicit selector is set (the default canvas clip). */
  canvasCount?: number;
};

/**
 * Decides whether a capture is a Pixi capture (subject to the WebGL guard) or a
 * DOM capture.
 *
 * The previous heuristic ("a `<canvas>` exists somewhere on the page") is too
 * coarse: the dev-sandbox shell renders its own canvas, so a DOM-only suite
 * that captures an explicit DOM selector was classified `pixi` and then failed
 * the guard with "no renderer" even though it never renders the game surface.
 * Intent is the reliable signal: a case that explicitly targets a non-canvas
 * selector is a DOM capture, and only a default canvas clip infers `pixi` from
 * the presence of a canvas.
 */
export const resolveCaptureRendererMode = (inputs: CaptureRendererInputs): 'pixi' | 'dom' => {
  if (inputs.waitCondition === 'pixi_loaded') {
    return 'pixi';
  }
  if (inputs.screenshotSelector !== undefined) {
    return inputs.screenshotSelector === 'canvas' ? 'pixi' : 'dom';
  }
  if (inputs.canvasSelector !== undefined) {
    return inputs.canvasSelector === 'canvas' ? 'pixi' : 'dom';
  }
  return (inputs.canvasCount ?? 0) > 0 ? 'pixi' : 'dom';
};
