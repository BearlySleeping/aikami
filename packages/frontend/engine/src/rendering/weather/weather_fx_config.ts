// packages/frontend/engine/src/rendering/weather/weather_fx_config.ts
// ---------------------------------------------------------------------------
// Weather FX tuning constants — the single art-direction surface for rain.
//
// Everything here is cosmetic and lives on the main thread. Nothing in this
// file is simulation state: the worker owns rain intensity, wind and game
// time (see `systems/environment_system.ts`); the renderer owns how that
// state *looks*.
//
// Split into three groups:
//   - clock / determinism constants
//   - rain streak texture geometry
//   - far/near rain batch profiles (the art direction)
//
// The profiles are deliberately expressed as per-batch numbers rather than
// derived from one global value, because "far rain is shorter, slower and
// fainter than near rain" is an art decision, not a formula.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Clock & determinism
// ---------------------------------------------------------------------------

/**
 * Fixed PRNG seed for drop placement.
 *
 * The FX layer must never call `Math.random()` in a frame-update path: a
 * fixed seed makes every capture of the same weather state pixel-identical,
 * which is what the visual suite compares against.
 */
export const WEATHER_FX_SEED = 0x5eed_1a71;

/**
 * FX clock value used when the renderer runs with a frozen clock.
 *
 * The visual runner always injects `screenshot=true`; freezing the clock at a
 * fixed phase means repeated captures of the same weather state land on the
 * same drop positions, streak angles and haze — instead of a random sample of
 * an animating system. Non-integer so the streaks are mid-flight rather than
 * resting on a wrap boundary.
 */
export const FROZEN_FX_TIME_SECONDS = 4.375;

/**
 * Largest real delta the FX clock will accept in one frame, in milliseconds.
 *
 * Returning from a backgrounded tab hands the ticker a multi-second delta.
 * The rain positions are analytic in FX time, so a huge delta would teleport
 * every drop; clamping keeps the motion continuous at the cost of the FX
 * clock running slower than wall-clock after a resume (which is invisible —
 * rain is ambient, not something gameplay can be timed against).
 */
export const MAX_FX_DELTA_MS = 100;

// ---------------------------------------------------------------------------
// Rain streak texture
// ---------------------------------------------------------------------------

/** Width of the generated rain streak texture, in pixels. */
export const RAIN_STREAK_TEXTURE_WIDTH = 2;

/** Height of the generated rain streak texture, in pixels. */
export const RAIN_STREAK_TEXTURE_HEIGHT = 32;

/**
 * Per-column opacity of the streak texture, left to right.
 *
 * Two columns: a slightly softer edge and a solid core. With nearest-neighbour
 * sampling and a scale near 1 this resolves to a crisp 2px line at the far
 * depth and a 3-4px line at the near depth — thin enough to read as
 * precipitation rather than as a sprite.
 */
export const RAIN_STREAK_COLUMN_ALPHA: readonly number[] = [0.66, 1];

/**
 * Exponent of the vertical alpha envelope (0 = tail, 1 = head).
 *
 * The leading edge of a falling drop is the brightest part and the trail
 * behind it fades — that asymmetry is what reads as *motion* in a single
 * frame. `> 1` biases the energy toward the head.
 */
export const RAIN_STREAK_HEAD_EXPONENT = 1.6;

/** Where the head feather starts, as a fraction of the texture height. */
export const RAIN_STREAK_HEAD_FEATHER_START = 0.85;

/** How much of the alpha the head feather removes at the very tip. */
export const RAIN_STREAK_HEAD_FEATHER_DEPTH = 0.85;

// ---------------------------------------------------------------------------
// Batch profiles
// ---------------------------------------------------------------------------

/**
 * One rain depth layer's art direction.
 *
 * `densityPerMegapixel` is the number of live drops at full intensity for a
 * 1,000,000-pixel viewport; `maxCount` caps the pool for large displays.
 * Sizes are in CSS pixels and deliberately do *not* scale with resolution —
 * a raindrop is the same size on a 720p and a 1080p display, only the count
 * changes.
 */
export type RainBatchProfile = {
  /** Drops per megapixel of viewport at full intensity. */
  densityPerMegapixel: number;
  /** Hard cap on pooled drops, regardless of viewport size. */
  maxCount: number;
  /**
   * Exponent applied to intensity before scaling the count.
   *
   * `1` is linear. `> 1` keeps the layer absent until the rain is genuinely
   * heavy, which is how the near layer stays sparse at Light and only fills
   * in at Heavy/Storm.
   */
  countExponent: number;
  /** Fall speed in CSS pixels per second, at the centre of the variation. */
  fallSpeed: number;
  /** Fractional spread applied to `fallSpeed` (± this / 2). */
  fallSpeedSpread: number;
  /** Horizontal texture scale at the centre of the variation. */
  scaleX: number;
  /** Vertical texture scale at the centre of the variation. */
  scaleY: number;
  /** Fractional spread applied to `scaleX` and `scaleY` (± this / 2). */
  scaleSpread: number;
  /** Per-drop alpha at full intensity, at the centre of the variation. */
  alpha: number;
  /** Fractional spread applied to `alpha` (± this / 2). */
  alphaSpread: number;
  /** Colour multiplied into the white streak texture. */
  tint: number;
};

/**
 * Background rain: short, slow, faint, cool, dense.
 *
 * This is the layer that carries the "it is raining" read across the whole
 * frame. It is intentionally numerous and individually almost invisible.
 */
export const FAR_RAIN_PROFILE: RainBatchProfile = {
  densityPerMegapixel: 460,
  maxCount: 1200,
  countExponent: 1,
  fallSpeed: 560,
  fallSpeedSpread: 0.5,
  scaleX: 1,
  scaleY: 0.36,
  scaleSpread: 0.6,
  alpha: 0.26,
  alphaSpread: 0.6,
  tint: 0xaec6e8,
};

/**
 * Foreground rain: long, fast, brighter, sparse.
 *
 * Reads as drops close to the camera. It stays nearly empty at Light rain so
 * the depth separation is a *difference in density*, not just in brightness.
 */
export const NEAR_RAIN_PROFILE: RainBatchProfile = {
  densityPerMegapixel: 160,
  maxCount: 420,
  countExponent: 1.8,
  fallSpeed: 900,
  fallSpeedSpread: 0.5,
  scaleX: 1.6,
  scaleY: 1.15,
  scaleSpread: 0.7,
  alpha: 0.62,
  alphaSpread: 0.6,
  tint: 0xdfe9ff,
};

/**
 * Largest streak tilt produced by full wind, in radians (~24°).
 *
 * Wind is a scalar in [-1, 1]; this is the angle at |wind| = 1. The same angle
 * drives both the streak's rotation and its lateral velocity, so the drawn
 * slant always matches the direction the drop actually travels.
 */
export const MAX_WIND_SLANT_RADIANS = 0.42;

/** Extra off-screen margin around the viewport that drops wrap through, in CSS pixels. */
export const RAIN_WRAP_MARGIN = 24;

// ---------------------------------------------------------------------------
// Transition policy
// ---------------------------------------------------------------------------

/**
 * Half-life of the visual rain-intensity transition, in milliseconds.
 *
 * The worker's `rainIntensity` is a *target*; the renderer eases toward it so
 * weather arrives and clears instead of popping. Exponential smoothing with a
 * half-life is frame-rate independent, which a fixed per-frame lerp is not.
 */
export const RAIN_INTENSITY_HALF_LIFE_MS = 420;

/** Half-life of the visual wind transition, in milliseconds. */
export const WIND_HALF_LIFE_MS = 620;

/** Below this remaining distance the transition snaps, so it terminates exactly. */
export const WEATHER_TRANSITION_EPSILON = 0.001;

/**
 * Smoothed intensity at or below which the weather hierarchy is hidden.
 *
 * Clear weather must cost nothing: hiding the root container takes the two
 * particle batches and the atmosphere mesh out of the render entirely, so a
 * clear frame issues zero weather draw calls.
 */
export const WEATHER_CLEAR_THRESHOLD = 0.004;

// ---------------------------------------------------------------------------
// Atmosphere policy
// ---------------------------------------------------------------------------

/**
 * Intensity below which the atmosphere pass contributes nothing at all.
 *
 * Light rain should be almost imperceptible — haze belongs to heavy weather.
 */
export const ATMOSPHERE_START_INTENSITY = 0.12;

/**
 * Peak alpha of the atmosphere pass, at full intensity and the densest part of
 * the frame.
 *
 * Deliberately low: this is a full-screen quad, so every 0.01 of alpha is a
 * visible veil. The value is tuned to read as "the air is thick with rain"
 * without washing out tile and sprite contrast — and it is depth-weighted, so
 * the effective peak at the top of the frame is ~15% higher than this.
 */
export const ATMOSPHERE_MAX_ALPHA = 0.2;

/**
 * Vertical haze weighting, bottom to top of the screen.
 *
 * Distant geometry (the top of the frame) sits behind more atmosphere than the
 * foreground. The gradient is what sells depth in a top-down view — a flat
 * wash at the same mean alpha just reads as a dirty screen, which is the
 * "opaque blue-grey veil" failure mode.
 */
export const ATMOSPHERE_DEPTH_MIN = 0.45;
export const ATMOSPHERE_DEPTH_MAX = 1.5;

/**
 * Haze noise cell size, in CSS pixels.
 *
 * Fixed in pixels rather than UV so the haze has the same physical scale on
 * every display, and derived from both viewport axes so the cells stay square
 * regardless of aspect ratio (square UV cells on a 16:9 viewport become
 * visibly stretched rectangles).
 */
export const ATMOSPHERE_NOISE_CELL_PX = 720 / 2.2;

/**
 * How much the haze noise modulates opacity, as `floor + range * noise`.
 *
 * A little variation stops the haze reading as a uniform tint; too much turns
 * it into a visible pattern.
 */
export const ATMOSPHERE_NOISE_FLOOR = 0.6;
export const ATMOSPHERE_NOISE_RANGE = 0.4;

/** Dark and light endpoints of the haze colour ramp. */
export const ATMOSPHERE_HAZE_DARK: readonly number[] = [0.13, 0.15, 0.2];
export const ATMOSPHERE_HAZE_LIGHT: readonly number[] = [0.26, 0.3, 0.4];

/** How fast the haze noise drifts, in noise cells per second. */
export const ATMOSPHERE_DRIFT_PER_SECOND = 0.02;
