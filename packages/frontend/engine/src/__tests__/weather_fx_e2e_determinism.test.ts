// packages/frontend/engine/src/__tests__/weather_fx_e2e_determinism.test.ts
//
// The deterministic-E2E weather boundary, driven the way `GameWorld` drives it.
//
// In `?e2e=true` mode the engine lets exactly one ticker frame render and then
// stops the ticker. PR #371 creates the weather renderer unconditionally, so a
// worker `STATE_UPDATE` (or a map switch) arriving after that freeze used to
// move only the renderer's *target* — no future `tick()` ever applied it, and
// the rendered weather stayed frozen on the boot state.
//
// These tests reproduce that sequence at the engine boundary: create the
// controller in the frozen configuration, render the one permitted frame, then
// change weather/scene with no further tick and assert on the diagnostics an E2E
// probe actually reads (`readWeatherFxDebug`), not on private fields.

import { beforeAll, describe, expect, test } from 'bun:test';
import { type Application, Container, DOMAdapter } from 'pixi.js';
import { ENV_UBO_OFFSETS, ENVIRONMENT_UBO_SIZE } from '../environment/environment_ubo.ts';
import { readWeatherFxDebug } from '../game_world/diagnostics.ts';
import type { WeatherFxController as WeatherFxControllerType } from '../game_world/weather_fx_controller.ts';
import { FROZEN_FX_TIME_SECONDS } from '../rendering/weather/weather_fx_config.ts';

// ---------------------------------------------------------------------------
// Environment bootstrap
//
// `weather_fx_controller.ts` transitively imports `@aikami/frontend-configs`,
// whose environment singleton validates PUBLIC_APP_ID / PUBLIC_MODE at module
// load. The engine test task has no preload (unlike client), so the env is set
// here and the module is imported dynamically AFTER the vars exist — the same
// bootstrap `equipment_merge.test.ts` uses.
// ---------------------------------------------------------------------------

process.env.PUBLIC_APP_ID = 'client';
process.env.PUBLIC_MODE = 'testing';

const { WeatherFxController } = await import('../game_world/weather_fx_controller.ts');

/** Viewport used for every harness — matches the engine's default render size. */
const VIEWPORT = { width: 1280, height: 720 };

const _fakeGlContext = (): unknown => ({
  getShaderPrecisionFormat: () => ({ precision: 1, rangeMin: 127, rangeMax: 127 }),
  getExtension: () => null,
  getParameter: () => null,
  isContextLost: () => false,
  // biome-ignore lint/style/useNamingConvention: WebGL API constants.
  FRAGMENT_SHADER: 0x8b30,
  // biome-ignore lint/style/useNamingConvention: WebGL API constants.
  HIGH_FLOAT: 0x1406,
});

beforeAll(() => {
  // The atmosphere shader probes fragment precision through the DOM adapter,
  // which does not exist in Bun. Mirrors the weather-renderer test bootstrap.
  DOMAdapter.set({
    createCanvas: () =>
      ({ width: 0, height: 0, getContext: () => _fakeGlContext() }) as unknown as HTMLCanvasElement,
    createImage: () => ({}) as unknown as HTMLImageElement,
    getCanvasRenderingContext2D: () => ({}) as unknown as typeof CanvasRenderingContext2D,
    getWebGLRenderingContext: () => ({}) as unknown as typeof WebGLRenderingContext,
    getNavigator: () => ({}) as unknown as Navigator,
    getBaseUrl: () => 'http://localhost/',
    getFontFaceSet: () => ({}) as unknown as FontFaceSet,
    fetch: (url: RequestInfo | URL, init?: RequestInit) => fetch(url, init),
    parseXML: (xml: string) => new DOMParser().parseFromString(xml, 'text/xml'),
  });
});

/** The minimal `Application` surface the controller reads (`app.screen`). */
const fakeApp = (): Application =>
  ({ screen: { width: VIEWPORT.width, height: VIEWPORT.height } }) as unknown as Application;

/** Builds the environment UBO the worker sends inside a `STATE_UPDATE`. */
const environmentUbo = (rainIntensity: number, windVelocity = 0): Float32Array => {
  const ubo = new Float32Array(ENVIRONMENT_UBO_SIZE);
  ubo[ENV_UBO_OFFSETS.rainIntensity] = rainIntensity;
  ubo[ENV_UBO_OFFSETS.windVelocity] = windVelocity;
  return ubo;
};

/**
 * Creates a controller in the deterministic-E2E configuration and renders the
 * single frame the frozen ticker is allowed before it stops.
 *
 * After this returns, `tick()` is never called again — exactly the state
 * `GameWorld` is left in once `_running` goes false.
 */
const createFrozenHarness = (): WeatherFxControllerType => {
  const controller = new WeatherFxController({
    parent: new Container(),
    app: fakeApp(),
    frozenFxClock: true,
    diagnosticsEnabled: true,
  });
  controller.tick(16);
  return controller;
};

describe('deterministic E2E weather after the ticker freezes', () => {
  test('a worker STATE_UPDATE still reaches the rendered weather', () => {
    const controller = createFrozenHarness();

    // No tick after this point: the ticker is stopped. Clear -> storm.
    controller.setEnvironmentFromUbo(environmentUbo(1, 0.5));

    const snapshot = readWeatherFxDebug();
    expect(snapshot.targetRainIntensity).toBe(1);
    expect(snapshot.currentRainIntensity).toBe(1);
    expect(snapshot.visible).toBe(true);
    expect(snapshot.farCount).toBeGreaterThan(0);
    expect(snapshot.nearCount).toBeGreaterThan(0);
    // Deterministic captures stay pinned: applying a frame never advances the
    // FX clock, so a repeat capture samples the same drop arrangement.
    expect(snapshot.fxTimeSeconds).toBe(FROZEN_FX_TIME_SECONDS);

    controller.destroy();
  });

  test('storm -> clear after the freeze hides weather and zeroes the counts', () => {
    const controller = createFrozenHarness();
    controller.setEnvironmentFromUbo(environmentUbo(1, 0));
    const storm = readWeatherFxDebug();
    expect(storm.visible).toBe(true);
    const poolSize = storm.poolSize;

    controller.setEnvironmentFromUbo(environmentUbo(0, 0));

    const clear = readWeatherFxDebug();
    expect(clear.visible).toBe(false);
    expect(clear.farCount).toBe(0);
    expect(clear.nearCount).toBe(0);
    expect(clear.atmosphereStrength).toBe(0);
    // The pool survives the transition — no rebuild, no churn.
    expect(clear.poolSize).toBe(poolSize);

    controller.destroy();
  });

  test('interior -> outdoor after the freeze restores the storm', () => {
    const controller = createFrozenHarness();
    controller.setEnvironmentFromUbo(environmentUbo(1, 0.3));
    expect(readWeatherFxDebug().visible).toBe(true);

    // Outdoor -> interior hides the weather on the spot.
    controller.setSceneContext({ interior: true });
    const interior = readWeatherFxDebug();
    expect(interior.visible).toBe(false);
    expect(interior.farCount).toBe(0);

    // Interior -> outdoor must restore the deterministic storm without a ticker
    // resume; the scene-context change alone is not enough to become visible.
    controller.setSceneContext({ interior: false });
    const outdoor = readWeatherFxDebug();
    expect(outdoor.visible).toBe(true);
    expect(outdoor.currentRainIntensity).toBe(1);
    expect(outdoor.farCount).toBeGreaterThan(0);
    expect(outdoor.nearCount).toBeGreaterThan(0);

    controller.destroy();
  });

  test('deterministic updates publish diagnostics with no intervening tick', () => {
    const controller = createFrozenHarness();

    // A Playwright probe reads the published record. With the ticker stopped
    // there is no future frame to flush the 4 Hz throttle, so the update itself
    // has to publish.
    controller.setEnvironmentFromUbo(environmentUbo(0.8, 0));
    const snapshot = readWeatherFxDebug();
    // The UBO is a Float32Array, so compare with tolerance.
    expect(snapshot.targetRainIntensity).toBeCloseTo(0.8, 6);
    expect(snapshot.currentRainIntensity).toBeCloseTo(0.8, 6);

    controller.destroy();
  });

  test('the same deterministic storm publishes identical state every run', () => {
    // Determinism sanity check for the frozen path: same seed and viewport, so
    // two independent clear -> storm updates must agree field-for-field.
    const snapshotFor = () => {
      const controller = createFrozenHarness();
      controller.setEnvironmentFromUbo(environmentUbo(1, 0.4));
      const snapshot = { ...readWeatherFxDebug() };
      controller.destroy();
      return snapshot;
    };

    const first = snapshotFor();
    const second = snapshotFor();
    expect(second).toEqual(first);
    // …and the clock is still pinned, so a repeat capture samples the same
    // drop arrangement rather than a later frame of an animating system.
    expect(first.fxTimeSeconds).toBe(FROZEN_FX_TIME_SECONDS);
    expect(first.farCount).toBeGreaterThan(0);
  });

  test('a live clock is untouched: the deterministic path does not leak', () => {
    // Regression guard for ordinary gameplay — the deterministic apply must not
    // turn the live path's easing into a pop.
    const controller = new WeatherFxController({
      parent: new Container(),
      app: fakeApp(),
      frozenFxClock: false,
      diagnosticsEnabled: true,
    });
    controller.tick(16);
    controller.setEnvironmentFromUbo(environmentUbo(1, 0));
    // One more rendered frame: the live path eases toward the target and the
    // accumulated delta flushes the throttled diagnostics.
    controller.tick(300);

    const snapshot = readWeatherFxDebug();
    expect(snapshot.targetRainIntensity).toBe(1);
    expect(snapshot.currentRainIntensity).toBeGreaterThan(0);
    expect(snapshot.currentRainIntensity).toBeLessThan(1);

    controller.destroy();
  });
});
