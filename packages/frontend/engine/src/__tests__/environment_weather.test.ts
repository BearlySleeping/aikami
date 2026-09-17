// packages/frontend/engine/src/__tests__/environment_weather.test.ts
//
// Worker-side weather policy — the part of the environment system that
// produces the *targets* the renderer consumes.
//
// Covers the three defects this refactor fixed in `environment_system.ts`:
//   1. a fixed per-tick decay that made rain clear at a speed that depended on
//      the frame rate (and never cleared at all at very low frame rates),
//   2. `Math.random()` drift that made the simulation unreproducible,
//   3. no separation between explicit dev/sandbox settings and the automatic
//      cycle, so a slider value was silently fought by the simulation.

import { beforeEach, describe, expect, test } from 'bun:test';
import {
  getEnvironmentState,
  resetEnvironmentTracking,
  setEnvironmentConfig,
  stepEnvironment,
} from '../systems/environment_system.ts';

/** Steps the simulation for a total wall-clock duration at a fixed frame rate. */
const runFor = (options: {
  totalMs: number;
  frameMs: number;
}): { rainIntensity: number; windVelocity: number; gameTimeSeconds: number } => {
  const steps = Math.round(options.totalMs / options.frameMs);
  let state = stepEnvironment({ deltaMs: 0 });
  for (let index = 0; index < steps; index++) {
    state = stepEnvironment({ deltaMs: options.frameMs });
  }
  return {
    rainIntensity: state.rainIntensity,
    windVelocity: state.windVelocity,
    gameTimeSeconds: state.gameTimeSeconds,
  };
};

describe('environment weather modes', () => {
  beforeEach(() => {
    resetEnvironmentTracking();
  });

  test('manual mode keeps an explicit setting exactly where it was put', () => {
    setEnvironmentConfig({ weatherMode: 'manual', rainIntensity: 0.7, windVelocity: -0.4 });
    // Ten seconds of frames: long enough for the old decay/drift to erase the
    // setting entirely.
    const state = runFor({ totalMs: 10_000, frameMs: 16 });
    expect(state.rainIntensity).toBe(0.7);
    expect(state.windVelocity).toBe(-0.4);
  });

  test('switching to manual adopts the requested weather immediately', () => {
    // Configure while dynamic (target only) …
    setEnvironmentConfig({ rainIntensity: 0.6, windVelocity: 0.3 });
    expect(getEnvironmentState().rainIntensity).toBe(0);
    // … then take manual control: no easing period the user never asked for.
    setEnvironmentConfig({ weatherMode: 'manual' });
    expect(getEnvironmentState().rainIntensity).toBe(0.6);
    expect(getEnvironmentState().windVelocity).toBe(0.3);
  });

  test('dynamic mode treats a configured value as a target and eases toward it', () => {
    setEnvironmentConfig({ rainIntensity: 1 });
    const oneFrame = stepEnvironment({ deltaMs: 16 });
    expect(oneFrame.rainIntensity).toBeCloseTo(0.0056, 6);
    expect(oneFrame.rainIntensity).toBeLessThan(1);

    const settled = runFor({ totalMs: 6000, frameMs: 16 });
    expect(settled.rainIntensity).toBe(1);
  });

  test('dynamic mode returns rain to clear once the target is cleared', () => {
    setEnvironmentConfig({ rainIntensity: 0.5 });
    runFor({ totalMs: 3000, frameMs: 16 });
    expect(getEnvironmentState().rainIntensity).toBe(0.5);

    setEnvironmentConfig({ rainIntensity: 0 });
    const settled = runFor({ totalMs: 3000, frameMs: 16 });
    expect(settled.rainIntensity).toBe(0);
  });

  test('the default mode is dynamic, preserving production behaviour', () => {
    // Nothing is set, so the automatic cycle holds rain at zero — the same
    // state a fresh production world has always been in.
    const state = runFor({ totalMs: 5000, frameMs: 16 });
    expect(state.rainIntensity).toBe(0);
  });
});

describe('environment weather is frame-rate independent', () => {
  beforeEach(() => {
    resetEnvironmentTracking();
  });

  test('one second of easing is identical at 60 fps and at 10 fps', () => {
    const at60 = (() => {
      resetEnvironmentTracking();
      setEnvironmentConfig({ rainIntensity: 1 });
      return runFor({ totalMs: 1000, frameMs: 1000 / 60 });
    })();
    const at10 = (() => {
      resetEnvironmentTracking();
      setEnvironmentConfig({ rainIntensity: 1 });
      return runFor({ totalMs: 1000, frameMs: 100 });
    })();
    const at144 = (() => {
      resetEnvironmentTracking();
      setEnvironmentConfig({ rainIntensity: 1 });
      return runFor({ totalMs: 1000, frameMs: 1000 / 144 });
    })();

    // The old implementation subtracted a fixed amount per tick, so rain
    // cleared six times faster at 60 fps than at 10.
    expect(at60.rainIntensity).toBeCloseTo(at10.rainIntensity, 6);
    expect(at144.rainIntensity).toBeCloseTo(at60.rainIntensity, 6);
    expect(at60.rainIntensity).toBeCloseTo(0.35, 6);
  });

  test('game time advances by the same amount regardless of frame pacing', () => {
    const at60 = (() => {
      resetEnvironmentTracking();
      return runFor({ totalMs: 1000, frameMs: 1000 / 60 });
    })();
    const at20 = (() => {
      resetEnvironmentTracking();
      return runFor({ totalMs: 1000, frameMs: 50 });
    })();
    expect(at60.gameTimeSeconds).toBeCloseTo(at20.gameTimeSeconds, 3);
  });
});

describe('environment weather is deterministic', () => {
  beforeEach(() => {
    resetEnvironmentTracking();
  });

  test('the same tick sequence produces the same weather, run to run', () => {
    // The old wind drift called `Math.random()` once per tick, so no two runs
    // — and therefore no two screenshots — ever matched.
    const sequence = (): number[] => {
      resetEnvironmentTracking();
      setEnvironmentConfig({ rainIntensity: 0.6, windVelocity: 0.4 });
      const samples: number[] = [];
      for (let index = 0; index < 240; index++) {
        const state = stepEnvironment({ deltaMs: 16 });
        samples.push(state.rainIntensity, state.windVelocity);
      }
      return samples;
    };

    expect(sequence()).toEqual(sequence());
  });

  test('dynamic wind stays near its target and never wanders without bound', () => {
    setEnvironmentConfig({ windVelocity: 0.2 });
    // Skip the initial approach transient — this asserts the *wander*, which
    // must stay a subtle texture rather than a visible automatic swing that
    // would change how the game plays.
    for (let index = 0; index < 250; index++) {
      stepEnvironment({ deltaMs: 16 });
    }

    let maxDeviation = 0;
    for (let index = 0; index < 4000; index++) {
      const state = stepEnvironment({ deltaMs: 16 });
      maxDeviation = Math.max(maxDeviation, Math.abs(state.windVelocity - 0.2));
    }
    expect(maxDeviation).toBeLessThan(0.1);
  });
});

describe('environment weather input handling', () => {
  beforeEach(() => {
    resetEnvironmentTracking();
  });

  test('clamps out-of-range values instead of trusting the caller', () => {
    setEnvironmentConfig({ weatherMode: 'manual', rainIntensity: 9, windVelocity: -9 });
    const state = getEnvironmentState();
    expect(state.rainIntensity).toBe(1);
    expect(state.windVelocity).toBe(-1);
  });

  test('rejects a non-finite wind value rather than poisoning the UBO', () => {
    setEnvironmentConfig({ weatherMode: 'manual', windVelocity: Number.NaN });
    expect(getEnvironmentState().windVelocity).toBe(0);
  });

  test('jumping to an hour keeps the weather settings intact', () => {
    setEnvironmentConfig({ weatherMode: 'manual', rainIntensity: 0.5, windVelocity: 0.25 });
    setEnvironmentConfig({ startHour: 0 });
    stepEnvironment({ deltaMs: 16 });
    const state = getEnvironmentState();
    expect(state.gameHour).toBe(0);
    expect(state.rainIntensity).toBe(0.5);
    expect(state.windVelocity).toBe(0.25);
  });
});
