// packages/frontend/engine/src/rendering/weather/weather_overlay.ts
// ---------------------------------------------------------------------------
// WeatherOverlay — the facade over the weather FX system.
//
// Owns three things and nothing else:
//   1. the FX clock (real time, delta-driven, clamped, freezable),
//   2. the transition state that eases worker *targets* into visual values,
//   3. the scene gate that decides whether weather is drawn at all.
//
// It does not know how rain is drawn (that is `RainRenderer`) or how haze is
// shaded (that is `AtmosphereOverlay`). Both halves take plain numbers, which
// is what makes the arithmetic in `weather_fx_math.ts` testable without a GPU.
//
// Boundary notes:
//   - The worker still owns gameplay weather (rain intensity, wind target,
//     game time). This layer only decides how those numbers *look*.
//   - Rain animates on the FX clock, never on `gameTimeSeconds`. Tying
//     precipitation speed to game time made rain accelerate when the sandbox
//     time scale changed, which is conceptually wrong — a downpour does not
//     fall faster because the world clock runs at 10x.
//   - Only the engine ticker may call `tick()`. Svelte ViewModels read worker
//     state through the bridge, never through the Pixi ticker.
// ---------------------------------------------------------------------------

import { Container, Rectangle } from 'pixi.js';
import { AtmosphereOverlay } from './atmosphere_overlay.ts';
import { RainRenderer } from './rain_renderer.ts';
import {
  ATMOSPHERE_MAX_ALPHA,
  ATMOSPHERE_START_INTENSITY,
  FROZEN_FX_TIME_SECONDS,
  MAX_FX_DELTA_MS,
  RAIN_INTENSITY_HALF_LIFE_MS,
  WEATHER_CLEAR_THRESHOLD,
  WEATHER_FX_SEED,
  WIND_HALF_LIFE_MS,
} from './weather_fx_config.ts';
import {
  clamp01,
  resolveAtmosphereStrength,
  resolveWindSlantRadians,
  smoothTowards,
} from './weather_fx_math.ts';

/** Options for {@link WeatherOverlay.create}. */
export type WeatherOverlayOptions = {
  /** The container to add the weather hierarchy to (usually the stage). */
  parent: Container;
  /**
   * Freeze the FX clock at a fixed phase and pin the transition state to the
   * worker's targets.
   *
   * The visual runner always injects `screenshot=true`; without this, repeated
   * captures of the same weather state would sample a different frame of an
   * animating system and a mid-transition intensity. With it, a capture is a
   * pure function of the worker's weather state.
   */
  frozenFxClock?: boolean;
  /** PRNG seed for drop placement. Defaults to {@link WEATHER_FX_SEED}. */
  seed?: number;
};

/**
 * Simulation state the renderer needs, as handed over by the engine.
 *
 * A small purpose-built shape rather than the environment UBO: the weather
 * visual pass has no use for ambient colour, shadow colour or ambient
 * intensity, and reading them would couple the renderer to a GPU buffer layout
 * it does not own.
 */
export type WeatherEnvironmentState = {
  /** Rain intensity target from the worker, in `[0, 1]`. */
  rainIntensity: number;
  /** Wind velocity target from the worker, in `[-1, 1]`. */
  windVelocity: number;
};

/**
 * Renderer-side weather state, published for dev tooling and the visual suite.
 *
 * Allocated per call and only read by diagnostics, never by the frame loop.
 */
export type WeatherFxDebugSnapshot = {
  targetRainIntensity: number;
  currentRainIntensity: number;
  targetWind: number;
  currentWind: number;
  farCount: number;
  nearCount: number;
  poolSize: number;
  /**
   * Mean streak length of each depth layer, in texture-scale units.
   *
   * Exposed so the near/far depth requirement can be asserted numerically —
   * "near rain is longer and brighter than far rain" is not something a vision
   * model measures reliably on a downscaled capture.
   */
  farMeanScaleY: number;
  nearMeanScaleY: number;
  atmosphereStrength: number;
  fxTimeSeconds: number;
  viewportWidth: number;
  viewportHeight: number;
  visible: boolean;
};

/**
 * Screen-space weather FX: rain particles plus an atmospheric haze pass.
 *
 * The hierarchy is added to the stage *after* the world container so it
 * composites over the scene, and is hidden entirely when there is nothing to
 * draw — a clear frame issues no weather draw calls at all.
 */
export class WeatherOverlay {
  /** Root of the weather hierarchy; visibility toggles the whole effect. */
  private readonly _root: Container;

  /** Precipitation: two pooled particle batches. */
  private readonly _rain: RainRenderer;

  /** Air: one full-screen haze mesh. */
  private readonly _atmosphere: AtmosphereOverlay;

  private readonly _parent: Container;

  private readonly _frozenFxClock: boolean;

  /**
   * Explicit bounds for the whole hierarchy.
   *
   * Set once and mutated on resize so PixiJS never walks the weather children
   * to measure them, and so culling can never drop the effect.
   */
  private readonly _bounds = new Rectangle(0, 0, 0, 0);

  private _attached = false;

  private _destroyed = false;

  private _viewportWidth = 0;

  private _viewportHeight = 0;

  /** Real-time FX clock, in seconds. Never game time. */
  private _fxTimeSeconds = 0;

  /** Worker-owned rain target, in `[0, 1]`. */
  private _targetRainIntensity = 0;

  /** Smoothed rain intensity actually being rendered. */
  private _currentRainIntensity = 0;

  /** Worker-owned wind target, in `[-1, 1]`. */
  private _targetWind = 0;

  /** Smoothed wind actually being rendered. */
  private _currentWind = 0;

  /** Whether the loaded scene is an interior (no outdoor weather). */
  private _interior = false;

  private _atmosphereStrength = 0;

  constructor(options: WeatherOverlayOptions) {
    this._parent = options.parent;
    this._frozenFxClock = options.frozenFxClock ?? false;

    this._root = new Container();
    this._root.label = 'weather-fx';
    // Decorative layer: never hit-tested, never interactive, never sorted
    // against the world (it is added last and composites on top).
    this._root.eventMode = 'none';
    this._root.interactiveChildren = false;
    this._root.boundsArea = this._bounds;

    this._rain = new RainRenderer({ seed: options.seed ?? WEATHER_FX_SEED });
    this._atmosphere = new AtmosphereOverlay();

    // Haze sits behind the drops — rain falls *through* the atmosphere.
    this._root.addChild(this._atmosphere.mesh);
    this._root.addChild(this._rain.container);
  }

  /**
   * Attaches the weather hierarchy to the parent container.
   *
   * Idempotent, so callers do not have to track attachment state.
   */
  attach(): void {
    if (this._attached || this._destroyed) {
      return;
    }
    this._parent.addChild(this._root);
    this._attached = true;
  }

  /** Removes the weather hierarchy from the parent container. */
  detach(): void {
    if (!this._attached) {
      return;
    }
    this._parent.removeChild(this._root);
    this._attached = false;
  }

  /**
   * Records the worker's weather targets.
   *
   * Values are treated as targets, not as the rendered value: `tick()` eases
   * toward them so weather arrives and clears instead of popping.
   *
   * @param state - The latest rain intensity and wind from the worker.
   */
  setEnvironmentState(state: WeatherEnvironmentState): void {
    this._targetRainIntensity = clamp01(state.rainIntensity);
    this._targetWind = Number.isFinite(state.windVelocity)
      ? Math.max(-1, Math.min(1, state.windVelocity))
      : 0;
  }

  /**
   * Records whether the loaded scene is an interior.
   *
   * Interior maps have no sky, so screen-space precipitation is wrong there
   * regardless of the global rain intensity. The flag comes from the
   * content-pack manifest's per-map `interior` property — the same source the
   * engine already uses to pin interior lighting — rather than from a
   * UI-side special case.
   *
   * Roof-by-roof occlusion is explicitly out of scope; this is a whole-scene
   * gate, not a mask.
   *
   * @param context - Scene semantics the renderer must respect.
   */
  setSceneContext(context: { interior: boolean }): void {
    this._interior = context.interior;
    if (this._interior) {
      // Hide immediately rather than on the next tick, so a map switch into an
      // interior can never flash one frame of outdoor rain.
      this._root.visible = false;
    }
  }

  /**
   * Resizes the weather FX viewport.
   *
   * @param options - The new viewport size in CSS pixels.
   */
  resize(options: { width: number; height: number }): void {
    const width = Number.isFinite(options.width) && options.width > 0 ? options.width : 0;
    const height = Number.isFinite(options.height) && options.height > 0 ? options.height : 0;
    this._viewportWidth = width;
    this._viewportHeight = height;
    this._rain.resize({ width, height });
    // The haze quad is expressed in NDC and needs no geometry change; the
    // bounds are kept in step so nothing ever measures the hierarchy.
    this._bounds.width = width;
    this._bounds.height = height;
  }

  /**
   * Advances the weather FX by one rendered frame.
   *
   * Must be called from the engine ticker only, once per frame.
   *
   * @param options - `deltaMs` from the ticker.
   */
  tick(options: { deltaMs: number }): void {
    if (this._destroyed) {
      return;
    }
    const deltaMs = this._clampDelta(options.deltaMs);
    this._advanceClock(deltaMs);
    this._advanceTransitions(deltaMs);
    this._applyFrame();
  }

  /**
   * Snapshot of the renderer's live weather state.
   *
   * Exists for dev diagnostics and the visual suite — it reports what is
   * actually being drawn, not what the worker asked for. Allocates, so it is
   * never called from the frame loop.
   */
  getDebugSnapshot(): WeatherFxDebugSnapshot {
    return {
      targetRainIntensity: this._targetRainIntensity,
      currentRainIntensity: this._currentRainIntensity,
      targetWind: this._targetWind,
      currentWind: this._currentWind,
      farCount: this._rain.farCount,
      nearCount: this._rain.nearCount,
      poolSize: this._rain.poolSize,
      farMeanScaleY: this._rain.farMeanScaleY,
      nearMeanScaleY: this._rain.nearMeanScaleY,
      atmosphereStrength: this._atmosphereStrength,
      fxTimeSeconds: this._fxTimeSeconds,
      viewportWidth: this._viewportWidth,
      viewportHeight: this._viewportHeight,
      visible: this._root.visible,
    };
  }

  /**
   * Releases the hierarchy and every GPU resource beneath it.
   *
   * Idempotent. Must run before the PixiJS application is destroyed — the
   * particle batches and quad geometry are stage descendants, and destroying
   * the app first would null their buffers out from under them.
   */
  destroy(): void {
    if (this._destroyed) {
      return;
    }
    this._destroyed = true;
    this.detach();
    this._rain.destroy();
    this._atmosphere.destroy();
    this._root.destroy({ children: false, texture: false, textureSource: false });
  }

  // -----------------------------------------------------------------------
  // Static factory
  // -----------------------------------------------------------------------

  /**
   * Creates a WeatherOverlay and attaches it to the given parent container.
   *
   * @param options - Parent container, clock/determinism and seed options.
   */
  static create(options: WeatherOverlayOptions): WeatherOverlay {
    const overlay = new WeatherOverlay(options);
    overlay.attach();
    return overlay;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Clamps a ticker delta.
   *
   * Resuming a backgrounded tab hands the ticker a multi-second delta. Because
   * drop positions are analytic in FX time, an unclamped delta would teleport
   * the entire rain field in one frame; clamping trades that for the FX clock
   * briefly running slower than wall-clock, which is invisible for ambient
   * weather.
   */
  private _clampDelta(deltaMs: number): number {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
      return 0;
    }
    return Math.min(deltaMs, MAX_FX_DELTA_MS);
  }

  /** Advances the FX clock — frozen at a fixed phase in screenshot mode. */
  private _advanceClock(deltaMs: number): void {
    if (this._frozenFxClock) {
      this._fxTimeSeconds = FROZEN_FX_TIME_SECONDS;
      return;
    }
    this._fxTimeSeconds += deltaMs / 1000;
  }

  /**
   * Eases the visual weather state toward the worker's targets.
   *
   * In frozen-clock mode the targets are adopted verbatim: a capture must be a
   * pure function of the worker's weather state, and an in-flight exponential
   * would make the rendered intensity depend on when the screenshot happened.
   */
  private _advanceTransitions(deltaMs: number): void {
    if (this._frozenFxClock) {
      this._currentRainIntensity = this._targetRainIntensity;
      this._currentWind = this._targetWind;
      return;
    }
    this._currentRainIntensity = smoothTowards({
      current: this._currentRainIntensity,
      target: this._targetRainIntensity,
      deltaMs,
      halfLifeMs: RAIN_INTENSITY_HALF_LIFE_MS,
    });
    this._currentWind = smoothTowards({
      current: this._currentWind,
      target: this._targetWind,
      deltaMs,
      halfLifeMs: WIND_HALF_LIFE_MS,
    });
  }

  /** Writes the current state into the two rendering halves. */
  private _applyFrame(): void {
    const intensity = this._currentRainIntensity;
    this._atmosphereStrength = resolveAtmosphereStrength({
      intensity,
      startIntensity: ATMOSPHERE_START_INTENSITY,
      maxAlpha: ATMOSPHERE_MAX_ALPHA,
    });

    // Clear weather costs nothing: no drops to place and no haze to shade, so
    // the whole hierarchy leaves the render.
    const visible =
      !this._interior && (intensity > WEATHER_CLEAR_THRESHOLD || this._atmosphereStrength > 0);
    this._root.visible = visible;
    if (!visible) {
      return;
    }

    this._rain.update({
      fxTimeSeconds: this._fxTimeSeconds,
      intensity,
      slantRadians: resolveWindSlantRadians(this._currentWind),
    });

    this._atmosphere.update({
      fxTimeSeconds: this._fxTimeSeconds,
      rainIntensity: intensity,
      wind: this._currentWind,
      atmosphereStrength: this._atmosphereStrength,
      viewportWidth: this._viewportWidth,
      viewportHeight: this._viewportHeight,
    });
  }
}
