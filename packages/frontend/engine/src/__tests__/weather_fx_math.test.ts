// packages/frontend/engine/src/__tests__/weather_fx_math.test.ts
//
// Pure weather-FX maths — density/budget mapping, the deterministic PRNG,
// wind/slant derivation, wrap/recycle behaviour, frame-rate-independent
// smoothing, and the atmosphere transition policy.
//
// Deliberately GPU-free and PixiJS-free: these are the guarantees that make
// the renderer reproducible, so they must be provable without a renderer.

import { describe, expect, test } from 'bun:test';
import {
  ATMOSPHERE_MAX_ALPHA,
  ATMOSPHERE_START_INTENSITY,
  FAR_RAIN_PROFILE,
  MAX_WIND_SLANT_RADIANS,
  NEAR_RAIN_PROFILE,
  RAIN_STREAK_TEXTURE_HEIGHT,
  RAIN_WRAP_MARGIN,
  WEATHER_TRANSITION_EPSILON,
} from '../rendering/weather/weather_fx_config.ts';
import {
  buildRainDropParams,
  clamp01,
  createWeatherPrng,
  resolveAtmosphereStrength,
  resolveLateralSpeed,
  resolveRainAlphaScale,
  resolveRainBatchCount,
  resolveRainPoolSize,
  resolveRainWrapGeometry,
  resolveWindSlantRadians,
  smoothTowards,
  wrapRange,
} from '../rendering/weather/weather_fx_math.ts';

const REFERENCE_VIEWPORT = { viewportWidth: 1280, viewportHeight: 720 };
const FULL_HD_VIEWPORT = { viewportWidth: 1920, viewportHeight: 1080 };

describe('createWeatherPrng', () => {
  test('is deterministic for a given seed', () => {
    const first = createWeatherPrng(1234);
    const second = createWeatherPrng(1234);
    const firstValues = Array.from({ length: 16 }, () => first());
    const secondValues = Array.from({ length: 16 }, () => second());
    expect(firstValues).toEqual(secondValues);
  });

  test('produces different streams for different seeds', () => {
    const a = createWeatherPrng(1);
    const b = createWeatherPrng(2);
    expect(Array.from({ length: 8 }, () => a())).not.toEqual(Array.from({ length: 8 }, () => b()));
  });

  test('stays inside [0, 1)', () => {
    const random = createWeatherPrng(99);
    for (let index = 0; index < 500; index++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('clamp01', () => {
  test('clamps, and treats non-finite input as zero', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('wrapRange', () => {
  test('wraps positive values into the range', () => {
    expect(wrapRange({ value: 5, min: 0, max: 10 })).toBe(5);
    expect(wrapRange({ value: 10, min: 0, max: 10 })).toBe(0);
    expect(wrapRange({ value: 25, min: 0, max: 10 })).toBe(5);
  });

  test('wraps negative travel (negative wind) correctly', () => {
    // `%` would return -1 here and place the drop outside the wrap window —
    // which is the bug this helper exists to avoid.
    expect(wrapRange({ value: -1, min: 0, max: 10 })).toBe(9);
    expect(wrapRange({ value: -25, min: 0, max: 10 })).toBe(5);
  });

  test('handles a non-zero lower bound', () => {
    expect(wrapRange({ value: 12, min: 10, max: 20 })).toBe(12);
    expect(wrapRange({ value: 22, min: 10, max: 20 })).toBe(12);
    expect(wrapRange({ value: 8, min: 10, max: 20 })).toBe(18);
  });

  test('degrades to the lower bound on a degenerate range or non-finite input', () => {
    expect(wrapRange({ value: 5, min: 0, max: 0 })).toBe(0);
    expect(wrapRange({ value: Number.NaN, min: 0, max: 10 })).toBe(0);
  });
});

describe('smoothTowards', () => {
  test('is frame-rate independent: one long step matches two half steps', () => {
    const halfLifeMs = 420;
    const oneStep = smoothTowards({
      current: 0,
      target: 1,
      deltaMs: 32,
      halfLifeMs,
    });

    const firstHalf = smoothTowards({ current: 0, target: 1, deltaMs: 16, halfLifeMs });
    const twoSteps = smoothTowards({
      current: firstHalf,
      target: 1,
      deltaMs: 16,
      halfLifeMs,
    });

    expect(Math.abs(oneStep - twoSteps)).toBeLessThan(1e-3);
  });

  test('covers half the distance in one half-life', () => {
    const value = smoothTowards({ current: 0, target: 1, deltaMs: 420, halfLifeMs: 420 });
    expect(value).toBeCloseTo(0.5, 5);
  });

  test('snaps exactly onto the target so a transition terminates', () => {
    // 40 half-lives of remaining distance would otherwise leave the value
    // asymptotically short of the target forever, re-uploading GPU attributes
    // every frame and making a screenshot depend on capture timing.
    let value = 0;
    // ~4.4s of 60fps frames: comfortably past the point the remaining
    // difference falls under the snap threshold.
    for (let index = 0; index < 400; index++) {
      value = smoothTowards({ current: value, target: 1, deltaMs: 16, halfLifeMs: 420 });
    }
    expect(value).toBe(1);
  });

  test('is a no-op for a zero or negative delta', () => {
    expect(smoothTowards({ current: 0.25, target: 1, deltaMs: 0, halfLifeMs: 420 })).toBe(0.25);
    expect(smoothTowards({ current: 0.25, target: 1, deltaMs: -5, halfLifeMs: 420 })).toBe(0.25);
  });

  test('recovers from non-finite state instead of propagating NaN', () => {
    expect(smoothTowards({ current: Number.NaN, target: 0.5, deltaMs: 16, halfLifeMs: 420 })).toBe(
      0.5,
    );
    expect(smoothTowards({ current: 0.25, target: Number.NaN, deltaMs: 16, halfLifeMs: 420 })).toBe(
      0.25,
    );
  });

  test('the snap threshold is small enough to be invisible', () => {
    expect(WEATHER_TRANSITION_EPSILON).toBeLessThan(0.01);
  });
});

describe('wind slant', () => {
  test('maps wind onto a bounded tilt with the sign preserved', () => {
    expect(resolveWindSlantRadians(0)).toBe(0);
    expect(resolveWindSlantRadians(1)).toBe(MAX_WIND_SLANT_RADIANS);
    expect(resolveWindSlantRadians(-1)).toBe(-MAX_WIND_SLANT_RADIANS);
  });

  test('clamps out-of-range and non-finite wind', () => {
    expect(resolveWindSlantRadians(5)).toBe(MAX_WIND_SLANT_RADIANS);
    expect(resolveWindSlantRadians(Number.NaN)).toBe(0);
  });

  test('the tilt is a believable rain angle, not a horizontal streak', () => {
    // ~24 degrees: clearly directional, still unmistakably falling.
    expect(MAX_WIND_SLANT_RADIANS).toBeGreaterThan(0.2);
    expect(MAX_WIND_SLANT_RADIANS).toBeLessThan(Math.PI / 6);
  });

  test('lateral speed is derived from the same tilt the streak is drawn at', () => {
    const slant = resolveWindSlantRadians(0.5);
    const lateral = resolveLateralSpeed({ fallSpeed: 560, slantRadians: slant });
    // The drop's trajectory must match the painted slant, or rain appears to
    // slide sideways instead of falling along its streak.
    expect(lateral).toBeCloseTo(560 * Math.tan(slant), 6);
    expect(resolveLateralSpeed({ fallSpeed: 560, slantRadians: 0 })).toBe(0);
    expect(resolveLateralSpeed({ fallSpeed: 560, slantRadians: -slant })).toBeCloseTo(-lateral, 6);
  });
});

describe('rain budgets', () => {
  test('scales density with viewport area and caps large displays', () => {
    const reference = resolveRainPoolSize({ profile: FAR_RAIN_PROFILE, ...REFERENCE_VIEWPORT });
    const fullHd = resolveRainPoolSize({ profile: FAR_RAIN_PROFILE, ...FULL_HD_VIEWPORT });
    const huge = resolveRainPoolSize({
      profile: FAR_RAIN_PROFILE,
      viewportWidth: 3840,
      viewportHeight: 2160,
    });

    expect(reference).toBe(424);
    expect(fullHd).toBe(954);
    expect(fullHd).toBeGreaterThan(reference);
    // 8.3 megapixels would be ~3800 drops uncapped.
    expect(huge).toBe(FAR_RAIN_PROFILE.maxCount);
  });

  test('keeps the total budget restrained at a normal viewport', () => {
    const far = resolveRainPoolSize({ profile: FAR_RAIN_PROFILE, ...REFERENCE_VIEWPORT });
    const near = resolveRainPoolSize({ profile: NEAR_RAIN_PROFILE, ...REFERENCE_VIEWPORT });
    expect(far + near).toBe(571);
    // "Restrained rather than thousands of drops."
    expect(far + near).toBeLessThan(1000);
  });

  test('is zero for a degenerate viewport', () => {
    expect(
      resolveRainPoolSize({ profile: FAR_RAIN_PROFILE, viewportWidth: 0, viewportHeight: 720 }),
    ).toBe(0);
    expect(
      resolveRainPoolSize({ profile: FAR_RAIN_PROFILE, viewportWidth: 1280, viewportHeight: -1 }),
    ).toBe(0);
  });

  test('live count is zero when clear and the full pool at full intensity', () => {
    const options = { profile: FAR_RAIN_PROFILE, ...REFERENCE_VIEWPORT };
    expect(resolveRainBatchCount({ ...options, intensity: 0 })).toBe(0);
    expect(resolveRainBatchCount({ ...options, intensity: 1 })).toBe(resolveRainPoolSize(options));
  });

  test('grows monotonically with intensity', () => {
    const options = { profile: NEAR_RAIN_PROFILE, ...REFERENCE_VIEWPORT };
    const counts = [0, 0.15, 0.3, 0.5, 0.7, 0.85, 1].map((intensity) =>
      resolveRainBatchCount({ ...options, intensity }),
    );
    for (let index = 1; index < counts.length; index++) {
      expect(counts[index] ?? 0).toBeGreaterThanOrEqual(counts[index - 1] ?? 0);
    }
  });

  test('light rain is sparse, and the near layer stays sparse longer', () => {
    const far = resolveRainBatchCount({
      profile: FAR_RAIN_PROFILE,
      ...REFERENCE_VIEWPORT,
      intensity: 0.3,
    });
    const near = resolveRainBatchCount({
      profile: NEAR_RAIN_PROFILE,
      ...REFERENCE_VIEWPORT,
      intensity: 0.3,
    });
    const farPool = resolveRainPoolSize({ profile: FAR_RAIN_PROFILE, ...REFERENCE_VIEWPORT });
    const nearPool = resolveRainPoolSize({ profile: NEAR_RAIN_PROFILE, ...REFERENCE_VIEWPORT });

    expect(far).toBe(127);
    expect(near).toBe(17);
    // Depth separation is a difference in density, not only in brightness:
    // at Light rain the near layer is proportionally far emptier than the far
    // layer, and at Storm both are full.
    expect(near / nearPool).toBeLessThan(far / farPool);
    expect(
      resolveRainBatchCount({ profile: NEAR_RAIN_PROFILE, ...REFERENCE_VIEWPORT, intensity: 1 }),
    ).toBe(nearPool);
  });

  test('never exceeds the pool, even for out-of-range intensity', () => {
    const options = { profile: FAR_RAIN_PROFILE, ...REFERENCE_VIEWPORT };
    const pool = resolveRainPoolSize(options);
    expect(resolveRainBatchCount({ ...options, intensity: 4 })).toBe(pool);
    expect(resolveRainBatchCount({ ...options, intensity: -2 })).toBe(0);
    expect(resolveRainBatchCount({ ...options, intensity: Number.NaN })).toBe(0);
  });
});

describe('rain wrap geometry', () => {
  test('margins clear the largest streak extent so wraps happen off-screen', () => {
    for (const profile of [FAR_RAIN_PROFILE, NEAR_RAIN_PROFILE]) {
      const geometry = resolveRainWrapGeometry({
        profile,
        ...REFERENCE_VIEWPORT,
        textureHeight: RAIN_STREAK_TEXTURE_HEIGHT,
      });
      const maxScaleY = profile.scaleY * (1 + profile.scaleSpread / 2);
      const halfLength = (maxScaleY * RAIN_STREAK_TEXTURE_HEIGHT) / 2;
      expect(geometry.marginY).toBeGreaterThanOrEqual(halfLength);
      expect(geometry.marginX).toBeGreaterThanOrEqual(RAIN_WRAP_MARGIN);
      expect(geometry.spanY).toBe(REFERENCE_VIEWPORT.viewportHeight + geometry.marginY * 2);
      expect(geometry.spanX).toBe(REFERENCE_VIEWPORT.viewportWidth + geometry.marginX * 2);
    }
  });

  test('the horizontal margin covers a fully wind-tilted streak', () => {
    const geometry = resolveRainWrapGeometry({
      profile: NEAR_RAIN_PROFILE,
      ...REFERENCE_VIEWPORT,
      textureHeight: RAIN_STREAK_TEXTURE_HEIGHT,
    });
    const maxScaleY = NEAR_RAIN_PROFILE.scaleY * (1 + NEAR_RAIN_PROFILE.scaleSpread / 2);
    const horizontalReach =
      ((maxScaleY * RAIN_STREAK_TEXTURE_HEIGHT) / 2) * Math.sin(MAX_WIND_SLANT_RADIANS);
    expect(geometry.marginX).toBeGreaterThan(horizontalReach);
  });
});

describe('buildRainDropParams', () => {
  test('is deterministic for a given seed and count', () => {
    const first = buildRainDropParams({ profile: FAR_RAIN_PROFILE, seed: 7, count: 32 });
    const second = buildRainDropParams({ profile: FAR_RAIN_PROFILE, seed: 7, count: 32 });
    expect(Array.from(first.x0Fraction)).toEqual(Array.from(second.x0Fraction));
    expect(Array.from(first.fallSpeed)).toEqual(Array.from(second.fallSpeed));
    expect(Array.from(first.alpha)).toEqual(Array.from(second.alpha));
  });

  test('growing the pool preserves the existing drops', () => {
    // A resize that raises the budget must not reshuffle the rain already on
    // screen — parameters are positional, drawn in a fixed order per index.
    const small = buildRainDropParams({ profile: FAR_RAIN_PROFILE, seed: 7, count: 32 });
    const large = buildRainDropParams({ profile: FAR_RAIN_PROFILE, seed: 7, count: 64 });
    expect(Array.from(large.x0Fraction.slice(0, 32))).toEqual(Array.from(small.x0Fraction));
    expect(Array.from(large.fallSpeed.slice(0, 32))).toEqual(Array.from(small.fallSpeed));
  });

  test('different seeds produce different patterns', () => {
    const a = buildRainDropParams({ profile: FAR_RAIN_PROFILE, seed: 1, count: 32 });
    const b = buildRainDropParams({ profile: FAR_RAIN_PROFILE, seed: 2, count: 32 });
    expect(Array.from(a.x0Fraction)).not.toEqual(Array.from(b.x0Fraction));
  });

  test('positions are fractions of the wrap span', () => {
    const params = buildRainDropParams({ profile: FAR_RAIN_PROFILE, seed: 3, count: 64 });
    for (let index = 0; index < params.x0Fraction.length; index++) {
      expect(params.x0Fraction[index] ?? -1).toBeGreaterThanOrEqual(0);
      expect(params.x0Fraction[index] ?? 2).toBeLessThan(1);
      expect(params.y0Fraction[index] ?? -1).toBeGreaterThanOrEqual(0);
      expect(params.y0Fraction[index] ?? 2).toBeLessThan(1);
    }
  });

  test('varies speed, length and alpha within the profile spread', () => {
    const params = buildRainDropParams({ profile: NEAR_RAIN_PROFILE, seed: 11, count: 128 });
    const speeds = Array.from(params.fallSpeed);
    const lengths = Array.from(params.scaleY);
    expect(Math.min(...speeds)).toBeLessThan(NEAR_RAIN_PROFILE.fallSpeed);
    expect(Math.max(...speeds)).toBeGreaterThan(NEAR_RAIN_PROFILE.fallSpeed);
    expect(Math.min(...lengths)).toBeLessThan(NEAR_RAIN_PROFILE.scaleY);
    expect(Math.max(...lengths)).toBeGreaterThan(NEAR_RAIN_PROFILE.scaleY);
    // Within the declared ± spread.
    for (const speed of speeds) {
      expect(speed).toBeGreaterThanOrEqual(
        NEAR_RAIN_PROFILE.fallSpeed * (1 - NEAR_RAIN_PROFILE.fallSpeedSpread / 2),
      );
      expect(speed).toBeLessThanOrEqual(
        NEAR_RAIN_PROFILE.fallSpeed * (1 + NEAR_RAIN_PROFILE.fallSpeedSpread / 2),
      );
    }
  });

  test('near drops are longer, faster and brighter than far drops on average', () => {
    const far = buildRainDropParams({ profile: FAR_RAIN_PROFILE, seed: 5, count: 256 });
    const near = buildRainDropParams({ profile: NEAR_RAIN_PROFILE, seed: 5, count: 256 });
    const mean = (values: Float32Array): number =>
      Array.from(values).reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean(near.scaleY)).toBeGreaterThan(mean(far.scaleY));
    expect(mean(near.fallSpeed)).toBeGreaterThan(mean(far.fallSpeed));
    expect(mean(near.alpha)).toBeGreaterThan(mean(far.alpha));
  });

  test('allocates empty arrays for a zero count', () => {
    const params = buildRainDropParams({ profile: FAR_RAIN_PROFILE, seed: 1, count: 0 });
    expect(params.x0Fraction.length).toBe(0);
  });
});

describe('intensity shaping', () => {
  test('drop alpha rises with intensity but never reaches zero', () => {
    expect(resolveRainAlphaScale(0)).toBeCloseTo(0.5, 6);
    expect(resolveRainAlphaScale(1)).toBeCloseTo(1, 6);
    expect(resolveRainAlphaScale(0.5)).toBeCloseTo(0.75, 6);
    expect(resolveRainAlphaScale(5)).toBeCloseTo(1, 6);
  });

  test('atmosphere is absent below the start intensity', () => {
    const options = {
      startIntensity: ATMOSPHERE_START_INTENSITY,
      maxAlpha: ATMOSPHERE_MAX_ALPHA,
    };
    expect(resolveAtmosphereStrength({ intensity: 0, ...options })).toBe(0);
    expect(resolveAtmosphereStrength({ intensity: ATMOSPHERE_START_INTENSITY, ...options })).toBe(
      0,
    );
  });

  test('atmosphere is almost imperceptible at light rain', () => {
    const strength = resolveAtmosphereStrength({
      intensity: 0.3,
      startIntensity: ATMOSPHERE_START_INTENSITY,
      maxAlpha: ATMOSPHERE_MAX_ALPHA,
    });
    // A full-screen quad: even a few percent alpha is a visible veil, so light
    // rain must sit far below the storm peak — under a sixth of it.
    expect(strength).toBeGreaterThan(0);
    expect(strength / ATMOSPHERE_MAX_ALPHA).toBeLessThan(0.15);
  });

  test('atmosphere peaks at full intensity and stays subtle', () => {
    const strength = resolveAtmosphereStrength({
      intensity: 1,
      startIntensity: ATMOSPHERE_START_INTENSITY,
      maxAlpha: ATMOSPHERE_MAX_ALPHA,
    });
    expect(strength).toBeCloseTo(ATMOSPHERE_MAX_ALPHA, 6);
    // Subtle darkening, never an opaque blue-grey veil.
    expect(ATMOSPHERE_MAX_ALPHA).toBeLessThan(0.25);
  });

  test('atmosphere strength is monotonic in intensity', () => {
    const options = {
      startIntensity: ATMOSPHERE_START_INTENSITY,
      maxAlpha: ATMOSPHERE_MAX_ALPHA,
    };
    let previous = -1;
    for (let intensity = 0; intensity <= 1.0001; intensity += 0.05) {
      const strength = resolveAtmosphereStrength({ intensity, ...options });
      expect(strength).toBeGreaterThanOrEqual(previous);
      previous = strength;
    }
  });
});
