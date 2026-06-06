// packages/frontend/engine/src/pixi_app.ts

import { isEmulatorModePublic } from '@aikami/frontend/configs';
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

/** Rolling-average window size for FPS calculation (in frames). */
const FPS_SAMPLE_WINDOW = 60;

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
 * Read-only debug metrics collected from the PixiJS application runtime.
 *
 * Updated every frame via the PixiJS ticker. Consumers read this snapshot
 * to display real-time telemetry without touching internal engine state.
 */
export type PixiAppDebugMetrics = {
  /** Rolling-average frames per second over the last {@link FPS_SAMPLE_WINDOW} frames. */
  readonly fps: number;
  /** Average frame duration in milliseconds over the last {@link FPS_SAMPLE_WINDOW} frames. */
  readonly frameDurationMs: number;
  /** Total frames rendered since initialization. */
  readonly totalFrames: number;
};

/**
 * A fully initialized PixiJS Application paired with a live debug
 * metrics snapshot.
 *
 * Returned by {@link createPixiApp}. The `.debug` property is a
 * plain object updated every frame — safe to read from any
 * consumer (ViewModels, dev tooling, telemetry panels).
 */
export type PixiAppInstance = {
  /** The PixiJS v8 Application instance. */
  readonly app: Application;
  /** Read-only debug metrics updated every frame. */
  readonly debug: PixiAppDebugMetrics;
};

/**
 * Internal mutable counters backing a {@link PixiAppDebugMetrics} view.
 */
type DebugCounters = {
  fps: number;
  frameDurationMs: number;
  totalFrames: number;
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
 * **Debug metrics**: A rolling-average FPS counter is attached to the
 * PixiJS ticker. The returned `debug` object is updated every frame and
 * is safe to read from any context (ViewModels, dev tooling).
 *
 * @param options - Canvas and renderer configuration.
 * @returns A fully initialized {@link PixiAppInstance} with the PixiJS
 *   Application and live debug metrics.
 */
const createPixiApp = async (options: PixiAppOptions): Promise<PixiAppInstance> => {
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

  // -- PixiJS DevTools bridge (C-047) ----------------------------------
  // Wire the official PixiJS DevTools extension bridge hooks into the
  // window scope only when running in local/emulator development modes.
  // This connects the underlying scene graph hierarchy, component
  // structures, and dirty slot state to the browser extension interface
  // without injecting analytical overhead into production builds.
  //
  // Guards:
  //   - import.meta.env.DEV: Vite compile-time constant (stripped in prod)
  //   - isEmulatorModePublic(): runtime check for emulator config
  //
  // References:
  //   - PixiJS DevTools extension: aamddddknhcagpehecnhphigffljadon
  //   - https://chromewebstore.google.com/detail/aamddddknhcagpehecnhphigffljadon
  // -------------------------------------------------------------------
  if (typeof import.meta !== 'undefined' && (import.meta.env?.DEV || isEmulatorModePublic())) {
    // Primary bridge — used by the official PixiJS DevTools extension
    (window as unknown as Record<string, unknown>).__PIXI_DEVTOOLS__ = {
      app,
      stage: app.stage,
      renderer: app.renderer,
    };

    // Legacy backup locator — used by older devtool revisions
    (window as unknown as Record<string, unknown>).__PIXI_APP__ = app;

    // Notify the devtools wrapper that the PixiJS globals are now
    // available. The extension inject script caches its initial scan
    // result, so we must explicitly reset / re-initialize after the
    // Application is ready (timing issue: inject runs before onMount).
    const devtoolsWrapper = (window as unknown as Record<string, unknown>)
      .__PIXI_DEVTOOLS_WRAPPER__ as { reset?: () => void } | undefined;
    devtoolsWrapper?.reset?.();

    const appInit = (window as unknown as Record<string, unknown>).__PIXI_APP_INIT__ as
      | ((app: unknown, version: string) => void)
      | undefined;
    appInit?.(app, '8.x');
  }

  // -- Debug metrics: rolling-average FPS via ticker -------------------
  const counters: DebugCounters = {
    fps: 0,
    frameDurationMs: 0,
    totalFrames: 0,
  };

  const frameDurations: number[] = [];
  let lastTimestamp = performance.now();

  app.ticker.add(() => {
    const now = performance.now();
    const delta = now - lastTimestamp;
    lastTimestamp = now;

    frameDurations.push(delta);
    if (frameDurations.length > FPS_SAMPLE_WINDOW) {
      frameDurations.shift();
    }

    const avgDuration = frameDurations.reduce((sum, d) => sum + d, 0) / frameDurations.length;

    counters.frameDurationMs = Math.round(avgDuration * 100) / 100;
    counters.fps = Math.round((1000 / avgDuration) * 100) / 100;
    counters.totalFrames += 1;
  });

  const debug = counters as PixiAppDebugMetrics;

  return { app, debug };
};

export { createPixiApp, DEFAULT_BACKGROUND, DEFAULT_HEIGHT, DEFAULT_WIDTH };
