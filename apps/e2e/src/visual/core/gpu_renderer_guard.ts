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
 * `null` means the route has no PixiJS app (DOM-only suites), which is fine.
 *
 * @param renderer - `window.__PIXI_APP__.renderer.name`, or null when absent.
 */
export const assertGpuRendererName = (renderer: string | null): void => {
  if (renderer === null || renderer === 'webgl' || renderer === 'webgpu') {
    return;
  }
  throw new Error(
    `C-548: PixiJS initialized the "${renderer}" renderer, not WebGL/WebGPU. ` +
      'Custom-shader tilemap meshes do not render on Canvas2D, so this capture would be ' +
      'terrain-less. Launch a WebGL-capable Chromium (the full build under ' +
      'PLAYWRIGHT_BROWSERS_PATH, e.g. `--use-angle=swiftshader --enable-unsafe-swiftshader`).',
  );
};
