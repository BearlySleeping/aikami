// packages/frontend/engine/src/pixi_app.ts
import { Application } from 'pixi.js';
import { initLpcShaders } from './rendering/sprite_composer.ts';

// ---------------------------------------------------------------------------
// PixiJS v8 Application wrapper
// ---------------------------------------------------------------------------

/** Default canvas dimensions used when no explicit size is provided. */
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;

/** Default background color (dark slate). */
const DEFAULT_BACKGROUND = 0x1a1a2e;

/**
 * Options for creating a PixiJS application.
 */
export type PixiAppOptions = {
  /** Target HTML canvas element. PixiJS binds its WebGL/WebGPU context to this. */
  canvas: HTMLCanvasElement;
  /** Canvas width in CSS pixels. Defaults to 800. */
  width?: number;
  /** Canvas height in CSS pixels. Defaults to 600. */
  height?: number;
  /** Background color as a hex number. Defaults to `0x1a1a2e`. */
  backgroundColor?: number;
  /** Whether to use antialiasing. Defaults to `true`. */
  antialias?: boolean;
  /** Background alpha (0 = fully transparent, 1 = fully opaque). Defaults to `1`. */
  backgroundAlpha?: number;
};

/**
 * Creates and initializes a PixiJS v8 {@link Application} bound to the
 * given canvas element.
 *
 * This wrapper exists so the rest of the game engine never imports PixiJS
 * directly — centralizing the initialization logic and making canvas mock
 * substitution easier in tests.
 *
 * **Pipeline initialization hook**: After the PixiJS renderer context is
 * live, {@link initLpcShaders} compiles the LPC GLSL shader programs.
 * This gate ensures headless import paths (bun test, CI) never execute
 * `GlProgram` / `GpuProgram` constructors at module top-level, where no
 * WebGL context exists. {@link LpcBatchManager} instances attach their
 * structural view dependencies (UBO buffers, uniform groups) exclusively
 * inside the application target viewport container tree — never at
 * module scope.
 *
 * @returns A fully initialized PixiJS Application ready for use with ticker
 *   and stage operations.
 */
const createPixiApp = async (options: PixiAppOptions): Promise<Application> => {
  const {
    canvas,
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
    backgroundColor = DEFAULT_BACKGROUND,
    antialias = true,
    backgroundAlpha = 1,
  } = options;

  const app = new Application();

  await app.init({
    canvas,
    width,
    height,
    backgroundColor,
    antialias,
    backgroundAlpha,
    // PixiJS v8 auto-detects WebGPU first, falls back to WebGL
    preference: 'webgpu',
  });

  // Pipeline gate: compile LPC shaders now that the renderer context
  // is live. Headless environments skip this path — compilation is
  // deferred to first use via lazy getters.
  initLpcShaders();

  return app;
};

export { createPixiApp, DEFAULT_BACKGROUND, DEFAULT_HEIGHT, DEFAULT_WIDTH };
