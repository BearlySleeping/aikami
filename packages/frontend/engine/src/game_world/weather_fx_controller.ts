// packages/frontend/engine/src/game_world/weather_fx_controller.ts
//
// Owns the main-thread weather-FX wiring: creating the overlay, feeding it the
// worker's weather targets, advancing it from the engine ticker, following
// renderer resizes, gating it per scene, and publishing renderer state for dev
// tooling.
//
// Extracted from `game_world.ts` so the facade stays within its source-size
// ceiling, and so the weather wiring has exactly one home. The engine ticker
// remains the only thing that advances weather animation — this controller is
// the adapter between that ticker and the renderer, not a second clock.

import type { Application, Container } from 'pixi.js';
// The engine package cannot use the `@aikami/frontend/<name>` alias (Biome
// forbids the hyphenated form, and the slash form is not mapped in this
// package's tsconfig), so the configs package is reached relatively — the same
// path `pixi_app.ts` uses.
import { isDevelopmentModePublic } from '../../../configs/src/index.ts';
import { ENV_UBO_OFFSETS } from '../environment/environment_ubo.ts';
import { WeatherOverlay } from '../rendering/weather/weather_overlay.ts';
import { isE2ETestMode, isVisualScreenshotMode, publishWeatherFxDebug } from './diagnostics.ts';

/**
 * How often renderer weather state is republished for dev/E2E inspection.
 *
 * Four times a second: fast enough that a dev panel or a visual-suite probe
 * sees the settled state, slow enough that the per-publish snapshot allocation
 * never lands in the frame budget.
 */
const DIAGNOSTICS_INTERVAL_MS = 250;

/** Options for {@link WeatherFxController}. */
export type WeatherFxControllerOptions = {
  /** The container the weather hierarchy is added to (the Pixi stage). */
  parent: Container;
  /**
   * The renderer the FX layer follows.
   *
   * The viewport is read from `app.screen` each frame rather than passed in on
   * a resize callback: the renderer can be resized by PixiJS's own
   * `resizeTo: window` watcher without the facade ever seeing it, and rain
   * whose drop budgets drift out of step with the real viewport is worse than
   * two number comparisons per frame.
   */
  app: Application;
  /** Freeze the FX clock and transition state for deterministic captures. */
  frozenFxClock?: boolean;
  /**
   * Publish renderer weather state to `window.__AIKAMI_DEBUG__`.
   *
   * Defaults to on outside production. It is an inspection surface, never UI —
   * but it allocates, so production does not pay for it.
   */
  diagnosticsEnabled?: boolean;
  /** PRNG seed for drop placement. */
  seed?: number;
};

/**
 * Adapts the engine ticker, the worker's environment UBO and the scene context
 * onto the weather renderer.
 */
export class WeatherFxController {
  private readonly _overlay: WeatherOverlay;

  private readonly _app: Application;

  private readonly _diagnosticsEnabled: boolean;

  private _diagnosticsAccumulatorMs = 0;

  /** Last viewport the renderer was told about, so drift is detectable. */
  private _appliedViewportWidth = 0;

  private _appliedViewportHeight = 0;

  constructor(options: WeatherFxControllerOptions) {
    this._app = options.app;
    this._overlay = WeatherOverlay.create({
      parent: options.parent,
      frozenFxClock: options.frozenFxClock ?? false,
      seed: options.seed,
    });
    this._syncViewport();
    this._diagnosticsEnabled =
      options.diagnosticsEnabled ??
      (isE2ETestMode() || isVisualScreenshotMode() || isDevelopmentModePublic());
  }

  /**
   * Advances the FX clock and redraws the weather for one rendered frame.
   *
   * @param deltaMs - Frame delta from the engine ticker, in milliseconds.
   */
  tick(deltaMs: number): void {
    this._syncViewport();
    this._overlay.tick({ deltaMs });
    this._publishDiagnostics(deltaMs);
  }

  /**
   * Reads the worker's weather targets out of the environment UBO.
   *
   * Only the two weather scalars are taken: the renderer has no use for the
   * UBO's colour or intensity fields, and taking the whole buffer would couple
   * it to a GPU layout it does not own.
   *
   * @param ubo - The environment UBO received in the worker's STATE_UPDATE.
   */
  setEnvironmentFromUbo(ubo: Float32Array): void {
    this._overlay.setEnvironmentState({
      rainIntensity: ubo[ENV_UBO_OFFSETS.rainIntensity] ?? 0,
      windVelocity: ubo[ENV_UBO_OFFSETS.windVelocity] ?? 0,
    });
  }

  /**
   * Applies scene semantics the renderer must respect.
   *
   * @param options - `interior: true` suppresses all outdoor weather.
   */
  setSceneContext(options: { interior: boolean }): void {
    this._overlay.setSceneContext(options);
  }

  /** Releases the weather hierarchy and its GPU resources. Idempotent. */
  destroy(): void {
    this._overlay.destroy();
  }

  /**
   * Keeps the FX viewport in step with the renderer.
   *
   * Two number comparisons in the common case — the resize only happens on the
   * frame after the renderer's screen actually changed.
   */
  private _syncViewport(): void {
    const width = this._app.screen.width;
    const height = this._app.screen.height;
    if (width === this._appliedViewportWidth && height === this._appliedViewportHeight) {
      return;
    }
    this._appliedViewportWidth = width;
    this._appliedViewportHeight = height;
    this._overlay.resize({ width, height });
  }

  /** Republish the renderer's weather state, at most four times a second. */
  private _publishDiagnostics(deltaMs: number): void {
    if (!this._diagnosticsEnabled) {
      return;
    }
    this._diagnosticsAccumulatorMs += Number.isFinite(deltaMs) ? deltaMs : 0;
    if (this._diagnosticsAccumulatorMs < DIAGNOSTICS_INTERVAL_MS) {
      return;
    }
    this._diagnosticsAccumulatorMs = 0;
    publishWeatherFxDebug(this._overlay.getDebugSnapshot());
  }
}
