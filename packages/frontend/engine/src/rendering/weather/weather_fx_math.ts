// packages/frontend/engine/src/rendering/weather/weather_fx_math.ts
// ---------------------------------------------------------------------------
// Weather FX maths — the pure, GPU-free half of the weather renderer.
//
// Everything here is a total function of its arguments: no module state, no
// clock reads, no `Math.random()`, no PixiJS. That is deliberate — it is the
// part of the weather system that can be tested exhaustively without a
// renderer, and it is where every determinism guarantee actually lives.
//
// The three ideas worth knowing before reading:
//
//  1. **Analytic drop positions.** A drop is not integrated frame by frame.
//     Its position is a pure function of (seed, FX time, wind, viewport), so a
//     frozen clock yields a byte-identical frame and a long frame pause cannot
//     desynchronise the pattern.
//  2. **Wrap, never respawn.** Recycling is a modulo over an off-screen margin
//     wide enough that the wrap always happens outside the visible area — no
//     spawn/destroy churn, and no visible teleport.
//  3. **Frame-rate independence.** Transitions are exponential with a
//     half-life, so the same wall-clock duration produces the same visual
//     result at 30, 60 or 144 Hz.
// ---------------------------------------------------------------------------

import type { RainBatchProfile } from './weather_fx_config.ts';
import {
  MAX_WIND_SLANT_RADIANS,
  RAIN_WRAP_MARGIN,
  WEATHER_TRANSITION_EPSILON,
} from './weather_fx_config.ts';

// ---------------------------------------------------------------------------
// Deterministic PRNG
// ---------------------------------------------------------------------------

/**
 * Creates a seeded PRNG (mulberry32) for weather drop placement.
 *
 * A local PRNG rather than `Math.random()` because the renderer's output must
 * be reproducible: the visual suite compares screenshots of the same weather
 * state across runs, and a frame-update path that samples global randomness
 * can never satisfy that.
 *
 * The generator is created once per pool build, never per frame.
 *
 * @param seed - Any 32-bit integer. The same seed yields the same sequence.
 * @returns A function producing successive values in `[0, 1)`.
 */
export const createWeatherPrng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

// ---------------------------------------------------------------------------
// Small scalar helpers
// ---------------------------------------------------------------------------

/** Clamps a value into `[0, 1]`. */
export const clamp01 = (value: number): number => {
  if (Number.isNaN(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
};

/**
 * Wraps a value into `[min, max)`.
 *
 * Unlike `%`, this is correct for negative inputs — which matters because
 * wind can drive a drop's horizontal travel negative, and `%` would return a
 * negative remainder and place the drop outside the wrap window.
 *
 * @param options - The value and the half-open range to wrap it into.
 * @returns The wrapped value, or `min` when the range is degenerate.
 */
export const wrapRange = (options: { value: number; min: number; max: number }): number => {
  const { value, min, max } = options;
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) {
    return min;
  }
  if (!Number.isFinite(value)) {
    return min;
  }
  const offset = value - min;
  return min + (offset - Math.floor(offset / span) * span);
};

/**
 * Eases `current` toward `target` with an exponential, half-life-based curve.
 *
 * Frame-rate independent by construction: two half-lives of elapsed time move
 * the value three quarters of the way regardless of how many frames that took.
 * A fixed per-frame lerp would instead make the transition speed depend on the
 * frame rate.
 *
 * @param options - Current value, target value, elapsed time and half-life.
 * @returns The eased value, snapped exactly onto `target` once the remaining
 *          difference is below {@link WEATHER_TRANSITION_EPSILON}.
 */
export const smoothTowards = (options: {
  current: number;
  target: number;
  deltaMs: number;
  halfLifeMs: number;
}): number => {
  const { current, target, deltaMs, halfLifeMs } = options;
  if (!Number.isFinite(current)) {
    return target;
  }
  if (!Number.isFinite(target)) {
    return current;
  }
  const remaining = target - current;
  if (remaining === 0) {
    return target;
  }
  if (
    !Number.isFinite(deltaMs) ||
    deltaMs <= 0 ||
    !Number.isFinite(halfLifeMs) ||
    halfLifeMs <= 0
  ) {
    return current;
  }
  // 1 - 2^(-dt / halfLife) — the fraction of the remaining distance covered.
  const factor = 1 - 2 ** (-deltaMs / halfLifeMs);
  const next = current + remaining * factor;
  // Snap so the transition terminates instead of asymptoting forever: a value
  // that never quite arrives would keep re-uploading GPU attributes every
  // frame, and would make a screenshot depend on when the capture happened.
  return Math.abs(target - next) <= WEATHER_TRANSITION_EPSILON ? target : next;
};

// ---------------------------------------------------------------------------
// Wind
// ---------------------------------------------------------------------------

/**
 * Converts the worker's scalar wind into the streak tilt it produces.
 *
 * Wind is `-1..1` with the sign carrying direction. The returned angle is used
 * for two things that must agree or the rain looks like it is sliding
 * sideways: the drawn streak's rotation, and (via {@link resolveLateralSpeed})
 * the drop's actual horizontal velocity.
 *
 * @param wind - Wind velocity in `[-1, 1]`. Values outside are clamped.
 * @returns Tilt in radians; positive tilts the streak's head toward +x.
 */
export const resolveWindSlantRadians = (wind: number): number => {
  const clamped = Number.isFinite(wind) ? Math.max(-1, Math.min(1, wind)) : 0;
  return clamped * MAX_WIND_SLANT_RADIANS;
};

/**
 * Horizontal speed implied by a fall speed and a streak tilt.
 *
 * @param options - Vertical speed in px/s and the tilt in radians.
 * @returns Horizontal speed in px/s, signed the same way as the tilt.
 */
export const resolveLateralSpeed = (options: { fallSpeed: number; slantRadians: number }): number =>
  options.fallSpeed * Math.tan(options.slantRadians);

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

/** Largest pool a profile may allocate for a viewport, before intensity. */
export const resolveRainPoolSize = (options: {
  profile: RainBatchProfile;
  viewportWidth: number;
  viewportHeight: number;
}): number => {
  const { profile, viewportWidth, viewportHeight } = options;
  if (!(viewportWidth > 0) || !(viewportHeight > 0)) {
    return 0;
  }
  const megapixels = (viewportWidth * viewportHeight) / 1_000_000;
  const scaled = Math.round(profile.densityPerMegapixel * megapixels);
  return Math.max(0, Math.min(profile.maxCount, scaled));
};

/**
 * Live drop count for a profile at a given intensity.
 *
 * Density scales with viewport *area* (a bigger window needs more drops to
 * look equally wet) while streak sizes stay in fixed CSS pixels, so the count
 * — not the size — is what responds to resolution.
 *
 * @param options - Batch profile, viewport size and rain intensity.
 * @returns Number of live drops, always within `[0, poolSize]`.
 */
export const resolveRainBatchCount = (options: {
  profile: RainBatchProfile;
  viewportWidth: number;
  viewportHeight: number;
  intensity: number;
}): number => {
  const { profile, intensity } = options;
  const poolSize = resolveRainPoolSize(options);
  if (poolSize === 0) {
    return 0;
  }
  const shaped = clamp01(intensity) ** profile.countExponent;
  return Math.max(0, Math.min(poolSize, Math.round(poolSize * shaped)));
};

// ---------------------------------------------------------------------------
// Wrap geometry
// ---------------------------------------------------------------------------

/**
 * The off-screen wrap window a rain batch recycles through.
 *
 * `margin` is chosen to clear the largest possible streak extent at that depth
 * (including the horizontal reach of a fully wind-tilted streak) so a drop's
 * wrap always happens entirely outside the viewport. Getting this wrong is
 * what makes naive particle rain visibly "pop" back to the top of the screen.
 */
export type RainWrapGeometry = {
  /** Vertical margin above and below the viewport, in CSS pixels. */
  marginY: number;
  /** Horizontal margin either side of the viewport, in CSS pixels. */
  marginX: number;
  /** Total vertical wrap span (`viewportHeight + 2 * marginY`). */
  spanY: number;
  /** Total horizontal wrap span (`viewportWidth + 2 * marginX`). */
  spanX: number;
};

/**
 * Resolves the wrap window for a batch at a given viewport size.
 *
 * @param options - Batch profile, viewport size and texture height.
 */
export const resolveRainWrapGeometry = (options: {
  profile: RainBatchProfile;
  viewportWidth: number;
  viewportHeight: number;
  textureHeight: number;
}): RainWrapGeometry => {
  const { profile, viewportWidth, viewportHeight, textureHeight } = options;
  const maxScaleY = profile.scaleY * (1 + profile.scaleSpread / 2);
  const halfLength = (maxScaleY * textureHeight) / 2;
  // A tilted streak reaches sideways by its half-length times sin(tilt), plus
  // its own half-width. Both are covered by the same margin budget.
  const horizontalReach = halfLength * Math.sin(Math.abs(MAX_WIND_SLANT_RADIANS));
  const marginY = Math.max(RAIN_WRAP_MARGIN, Math.ceil(halfLength) + 2);
  const marginX = Math.max(RAIN_WRAP_MARGIN, Math.ceil(horizontalReach) + 2);
  return {
    marginY,
    marginX,
    spanY: Math.max(1, viewportHeight + marginY * 2),
    spanX: Math.max(1, viewportWidth + marginX * 2),
  };
};

// ---------------------------------------------------------------------------
// Per-drop parameters
// ---------------------------------------------------------------------------

/**
 * Fixed, per-drop parameters for one rain batch.
 *
 * Positions are stored as *fractions* of the wrap span rather than pixels so
 * the pool survives a viewport change without re-deriving randomness — only
 * the span is recomputed. Every array is allocated once, when the pool is
 * built, and never again.
 */
export type RainDropParams = {
  /** Horizontal start, as a fraction of the horizontal wrap span. */
  x0Fraction: Float32Array;
  /** Vertical start, as a fraction of the vertical wrap span. */
  y0Fraction: Float32Array;
  /** Fall speed in CSS pixels per second. */
  fallSpeed: Float32Array;
  /** Horizontal texture scale. */
  scaleX: Float32Array;
  /** Vertical texture scale — the streak length. */
  scaleY: Float32Array;
  /** Per-drop alpha at full intensity, before the intensity scale. */
  alpha: Float32Array;
};

/**
 * Derives deterministic per-drop parameters for a batch.
 *
 * Values are drawn in a fixed order per index, so a pool grown from N to N+M
 * keeps drops `0..N-1` byte-identical — resizing a window never reshuffles the
 * rain that is already on screen.
 *
 * @param options - Batch profile, seed and drop count.
 * @returns Parallel typed arrays, one entry per drop.
 */
export const buildRainDropParams = (options: {
  profile: RainBatchProfile;
  seed: number;
  count: number;
}): RainDropParams => {
  const { profile, seed, count } = options;
  const size = Math.max(0, Math.floor(count));
  const params: RainDropParams = {
    x0Fraction: new Float32Array(size),
    y0Fraction: new Float32Array(size),
    fallSpeed: new Float32Array(size),
    scaleX: new Float32Array(size),
    scaleY: new Float32Array(size),
    alpha: new Float32Array(size),
  };
  const random = createWeatherPrng(seed);
  for (let index = 0; index < size; index++) {
    params.x0Fraction[index] = random();
    params.y0Fraction[index] = random();
    params.fallSpeed[index] = profile.fallSpeed * spreadFactor(random(), profile.fallSpeedSpread);
    params.scaleX[index] = profile.scaleX * spreadFactor(random(), profile.scaleSpread);
    params.scaleY[index] = profile.scaleY * spreadFactor(random(), profile.scaleSpread);
    params.alpha[index] = profile.alpha * spreadFactor(random(), profile.alphaSpread);
  }
  return params;
};

/**
 * Maps a `[0, 1)` sample onto a symmetric spread around 1.
 *
 * @param sample - Uniform sample in `[0, 1)`.
 * @param spread - Total width of the band, e.g. `0.5` for ±25%.
 * @returns A multiplier in `[1 - spread/2, 1 + spread/2)`.
 */
const spreadFactor = (sample: number, spread: number): number =>
  1 - spread / 2 + sample * Math.max(0, spread);

// ---------------------------------------------------------------------------
// Atmosphere & intensity shaping
// ---------------------------------------------------------------------------

/**
 * Alpha scale applied to every drop as rain intensity rises.
 *
 * Light rain is faint as well as sparse — otherwise a handful of full-strength
 * streaks reads as heavier weather than it is.
 */
export const resolveRainAlphaScale = (intensity: number): number => 0.5 + 0.5 * clamp01(intensity);

/**
 * Opacity of the full-screen atmosphere pass for a given intensity.
 *
 * Zero below {@link ATMOSPHERE_START_INTENSITY} so light rain is untouched,
 * then a smoothstep ramp to the (deliberately low) peak. This is the only
 * place atmosphere strength is decided — the shader just renders what it is
 * handed, which keeps the policy unit-testable.
 *
 * @param intensity - Rain intensity in `[0, 1]`.
 * @param startIntensity - Intensity below which haze is absent.
 * @param maxAlpha - Peak alpha at full intensity.
 * @returns Alpha in `[0, maxAlpha]`.
 */
export const resolveAtmosphereStrength = (options: {
  intensity: number;
  startIntensity: number;
  maxAlpha: number;
}): number => {
  const { intensity, startIntensity, maxAlpha } = options;
  const clamped = clamp01(intensity);
  const span = 1 - startIntensity;
  if (span <= 0) {
    return clamped > 0 ? maxAlpha : 0;
  }
  const t = clamp01((clamped - startIntensity) / span);
  const eased = t * t * (3 - 2 * t);
  return maxAlpha * eased;
};
