// packages/frontend/engine/src/__tests__/weather_fx_profiling.test.ts
//
// Profiling lane for the weather FX: per-frame CPU cost and draw-call topology
// at 720p and 1080p, for clear / light / storm.
//
// The budgets here are deliberately loose — roughly an order of magnitude above
// what the implementation costs — because this suite runs on shared CI hardware
// and a tight threshold would flake instead of informing. What it *does* catch
// is a catastrophic regression: an accidental O(n^2) update, a per-frame pool
// rebuild, or the clear path ceasing to be free. The printed numbers are the
// deliverable; the assertions are the tripwire.
//
// This measures the CPU side only. GPU cost is not observable in a headless
// lane with no GPU — the draw-call topology assertions below are the proxy for
// it, since draw calls are what the GPU actually pays for.

import { beforeAll, describe, expect, test } from 'bun:test';
import { Container, DOMAdapter, type ParticleContainer } from 'pixi.js';
import { WeatherOverlay } from '../rendering/weather/weather_overlay.ts';

/** 1280x720 = 0.92 MP — the low end of the supported presentation range. */
const VIEWPORT_720P = { width: 1280, height: 720 };

/** 1920x1080 = 2.07 MP — the high end, and 2.25x the pixel area. */
const VIEWPORT_1080P = { width: 1920, height: 1080 };

/** Weather intensities exercised by every measurement. */
const STATES = {
  clear: { rainIntensity: 0, windVelocity: 0 },
  light: { rainIntensity: 0.35, windVelocity: 0.35 },
  storm: { rainIntensity: 1, windVelocity: 0.7 },
} as const;

/** Frames discarded before timing, so JIT warm-up is not in the measurement. */
const WARMUP_FRAMES = 400;

/**
 * Frames per timed block.
 *
 * Timing one frame at a time is dominated by `performance.now()` overhead and
 * machine noise: an early version reported the 170-drop case as *slower* than
 * the 571-drop case. Timing a block and dividing amortises both.
 */
const FRAMES_PER_BLOCK = 250;

/** Timed blocks per measurement; the reported figure is their mean. */
const TIMED_BLOCKS = 24;

/**
 * Per-frame ceiling at 720p, in microseconds.
 *
 * Well above the measured cost on a development machine, so a slow CI runner
 * has headroom while a genuine regression (allocating the pool, quadratic
 * placement) still trips it.
 */
const BUDGET_US_720P = 4000;

/** Per-frame ceiling at 1080p, in microseconds (2.0x the drops of 720p). */
const BUDGET_US_1080P = 8000;

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

/** A measured frame cost distribution, in microseconds. */
type FrameProfile = {
  meanUs: number;
  p95Us: number;
  drops: number;
};

/** An overlay plus the stage container it was attached to. */
type Harness = { parent: Container; overlay: WeatherOverlay };

/** Creates an overlay at a viewport with the FX clock frozen (deterministic). */
const createOverlay = (viewport: { width: number; height: number }): Harness => {
  const parent = new Container();
  const overlay = WeatherOverlay.create({ parent, frozenFxClock: true });
  overlay.resize(viewport);
  return { parent, overlay };
};

/** The weather root inside the stage container. */
const weatherRoot = (parent: Container): Container => {
  const root = parent.getChildByLabel('weather-fx');
  if (!root) {
    throw new Error('weather root missing');
  }
  return root;
};

/**
 * Draw-call census of the visible weather hierarchy.
 *
 * Counted by label rather than duck-typing: `weather-rain` is a plain grouping
 * container and costs no draw call of its own, while each `weather-rain-*`
 * batch and the `weather-atmosphere` mesh are one each.
 */
type WeatherTopology = { batches: number; hazePasses: number; drawCalls: number };

const weatherTopology = (parent: Container): WeatherTopology => {
  const root = weatherRoot(parent);
  if (!root.visible) {
    return { batches: 0, hazePasses: 0, drawCalls: 0 };
  }
  const batches = root.children
    .flatMap((child) => child.children as Container[])
    .filter((child) => child.label.startsWith('weather-rain-')).length;
  const hazePasses = root.children.filter((child) => child.label === 'weather-atmosphere').length;
  return { batches, hazePasses, drawCalls: batches + hazePasses };
};

/** Number of particles actually allocated across both depth batches. */
const allocatedParticles = (parent: Container): number =>
  (weatherRoot(parent).children as Container[])
    .flatMap((child) => child.children as ParticleContainer[])
    .filter((child) => child.label.startsWith('weather-rain-'))
    .reduce((sum, batch) => sum + (batch.particleChildren?.length ?? 0), 0);

/**
 * Times `TIMED_FRAMES` ticks of a settled weather state on a fresh overlay.
 *
 * A fresh harness per state is deliberate: measuring three states on one
 * overlay leaves the first transition after a hidden frame in the warm-up of
 * the second state, which showed up as a spurious 1.7x cost on the light case.
 *
 * `frozenFxClock` makes the state settle immediately, so every timed frame does
 * the full per-drop write — the number reported is the steady-state frame cost,
 * not an average over a transition.
 */
const profileFrames = (
  viewport: { width: number; height: number },
  state: { rainIntensity: number; windVelocity: number },
): FrameProfile & { harness: Harness } => {
  const harness = createOverlay(viewport);
  const { overlay } = harness;
  overlay.setEnvironmentState(state);
  for (let frame = 0; frame < WARMUP_FRAMES; frame += 1) {
    overlay.tick({ deltaMs: 16.67 });
  }

  const blockMeans = new Float64Array(TIMED_BLOCKS);
  for (let block = 0; block < TIMED_BLOCKS; block += 1) {
    const startedAt = performance.now();
    for (let frame = 0; frame < FRAMES_PER_BLOCK; frame += 1) {
      overlay.tick({ deltaMs: 16.67 });
    }
    blockMeans[block] = ((performance.now() - startedAt) * 1000) / FRAMES_PER_BLOCK;
  }

  const sorted = Array.from(blockMeans).sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const snapshot = overlay.getDebugSnapshot();
  return {
    meanUs: total / TIMED_BLOCKS,
    p95Us: sorted[Math.floor(TIMED_BLOCKS * 0.95)] ?? 0,
    drops: snapshot.farCount + snapshot.nearCount,
    harness,
  };
};

describe('Weather FX profiling — frame cost', () => {
  test('720p: clear is free, storm stays inside the frame budget', () => {
    const clear = profileFrames(VIEWPORT_720P, STATES.clear);
    const light = profileFrames(VIEWPORT_720P, STATES.light);
    const storm = profileFrames(VIEWPORT_720P, STATES.storm);

    // biome-ignore lint/suspicious/noConsole: profiling output is the deliverable.
    console.log(
      `[weather-fx 720p] clear ${clear.meanUs.toFixed(1)}us (${clear.drops} drops) | ` +
        `light ${light.meanUs.toFixed(1)}us (${light.drops} drops) | ` +
        `storm ${storm.meanUs.toFixed(1)}us (${storm.drops} drops, p95 ${storm.p95Us.toFixed(1)}us)`,
    );

    expect(storm.drops).toBeGreaterThan(0);
    expect(storm.meanUs).toBeLessThan(BUDGET_US_720P);
    expect(storm.p95Us).toBeLessThan(BUDGET_US_720P * 2);

    // The clear path skips both the particle write and the haze pass, so it
    // must be materially cheaper than a frame that draws every drop.
    expect(clear.meanUs).toBeLessThan(storm.meanUs * 0.5);

    // More rain must cost more — otherwise the profile is not being applied.
    expect(light.drops).toBeLessThan(storm.drops);
    for (const profile of [clear, light, storm]) {
      profile.harness.overlay.destroy();
      profile.harness.parent.destroy();
    }
  });

  test('1080p: cost scales linearly with drops, not quadratically', () => {
    const high = profileFrames(VIEWPORT_1080P, STATES.storm);
    const low = profileFrames(VIEWPORT_720P, STATES.storm);

    // biome-ignore lint/suspicious/noConsole: profiling output is the deliverable.
    console.log(
      `[weather-fx 1080p] storm ${high.meanUs.toFixed(1)}us ` +
        `(${high.drops} drops, p95 ${high.p95Us.toFixed(1)}us) | ` +
        `720p ${low.meanUs.toFixed(1)}us (${low.drops} drops)`,
    );

    expect(high.drops).toBeGreaterThan(low.drops);
    expect(high.meanUs).toBeLessThan(BUDGET_US_1080P);

    // Per-drop cost must not grow with the drop count: that is the signature of
    // a quadratic placement or a per-frame rebuild of the pool.
    const perDrop1080 = high.meanUs / high.drops;
    const perDrop720 = low.meanUs / low.drops;
    expect(perDrop1080).toBeLessThan(perDrop720 * 3);

    for (const profile of [high, low]) {
      profile.harness.overlay.destroy();
      profile.harness.parent.destroy();
    }
  });

  test('pool is stable across 5000 frames — no growth, no leak', () => {
    const { parent, overlay } = createOverlay(VIEWPORT_720P);
    overlay.setEnvironmentState(STATES.storm);
    for (let frame = 0; frame < WARMUP_FRAMES; frame += 1) {
      overlay.tick({ deltaMs: 16.67 });
    }
    const allocatedAfterWarmup = allocatedParticles(parent);
    const poolAfterWarmup = overlay.getDebugSnapshot().poolSize;

    for (let frame = 0; frame < 5000; frame += 1) {
      overlay.tick({ deltaMs: 16.67 });
    }

    // Neither the live count nor the allocated capacity may drift: the pool is
    // sized once from the viewport and recycled by wrapping, never respawned.
    expect(overlay.getDebugSnapshot().poolSize).toBe(poolAfterWarmup);
    expect(allocatedParticles(parent)).toBe(allocatedAfterWarmup);
    overlay.destroy();
    parent.destroy();
  });
});

describe('Weather FX profiling — draw-call topology', () => {
  test('clear issues no weather draw calls at all', () => {
    const { parent, overlay } = createOverlay(VIEWPORT_720P);
    overlay.setEnvironmentState(STATES.storm);
    overlay.tick({ deltaMs: 16.67 });
    expect(weatherTopology(parent).drawCalls).toBeGreaterThan(0);

    overlay.setEnvironmentState(STATES.clear);
    overlay.tick({ deltaMs: 16.67 });
    expect(overlay.getDebugSnapshot().visible).toBe(false);
    // Hidden root: the renderer walks past the whole weather hierarchy.
    expect(weatherTopology(parent).drawCalls).toBe(0);
    overlay.destroy();
    parent.destroy();
  });

  test('storm is two particle batches plus one haze pass', () => {
    const { parent, overlay } = createOverlay(VIEWPORT_720P);
    overlay.setEnvironmentState(STATES.storm);
    overlay.tick({ deltaMs: 16.67 });
    const topology = weatherTopology(parent);

    // biome-ignore lint/suspicious/noConsole: profiling output is the deliverable.
    console.log(
      `[weather-fx topology] storm: ${topology.batches} particle batches + ` +
        `${topology.hazePasses} haze pass = ${topology.drawCalls} draw calls`,
    );

    expect(topology.batches).toBe(2);
    expect(topology.hazePasses).toBe(1);
    overlay.destroy();
    parent.destroy();
  });

  test('interior suppresses every weather draw call', () => {
    const { parent, overlay } = createOverlay(VIEWPORT_720P);
    overlay.setEnvironmentState(STATES.storm);
    overlay.tick({ deltaMs: 16.67 });
    overlay.setSceneContext({ interior: true });
    overlay.tick({ deltaMs: 16.67 });

    expect(overlay.getDebugSnapshot().visible).toBe(false);
    expect(weatherTopology(parent).drawCalls).toBe(0);
    overlay.destroy();
    parent.destroy();
  });
});
