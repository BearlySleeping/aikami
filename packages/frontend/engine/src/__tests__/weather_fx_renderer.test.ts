// packages/frontend/engine/src/__tests__/weather_fx_renderer.test.ts
//
// Engine-level weather-FX lifecycle: creation, resize, clear → storm → clear
// transitions, interior gating, deterministic frozen-clock captures, wrap
// recycling, and cleanup that neither leaks nor duplicates display objects.
//
// Runs headlessly against real PixiJS scene objects (a fake `DOMAdapter` GL
// context is enough — `Shader.from` only needs a precision probe). That is
// deliberate: these guarantees are about object lifetime and numeric output,
// not about pixels, so they belong in the fast unit lane rather than the
// browser lane.

import { beforeAll, describe, expect, test } from 'bun:test';
import { Container, DOMAdapter, type ParticleContainer } from 'pixi.js';
import { AtmosphereOverlay } from '../rendering/weather/atmosphere_overlay.ts';
import { RainRenderer } from '../rendering/weather/rain_renderer.ts';
import { createRainStreakTexture } from '../rendering/weather/rain_texture.ts';
import {
  FROZEN_FX_TIME_SECONDS,
  MAX_FX_DELTA_MS,
  RAIN_STREAK_TEXTURE_HEIGHT,
  RAIN_STREAK_TEXTURE_WIDTH,
  WEATHER_FX_SEED,
} from '../rendering/weather/weather_fx_config.ts';
import { WeatherOverlay } from '../rendering/weather/weather_overlay.ts';

/** Viewport used for the budget assertions (1280x720 = 0.9216 megapixels). */
const VIEWPORT = { width: 1280, height: 720 };

/** Pool sizes at {@link VIEWPORT}, straight from the batch profiles. */
const FAR_POOL = 424;
const NEAR_POOL = 147;

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
  // `Shader.from` probes fragment precision through the DOM adapter, which does
  // not exist in Bun. This mirrors the headless bootstrap the tilemap tests use.
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

/** Creates an attached overlay plus its parent container. */
const createHarness = (options?: {
  frozenFxClock?: boolean;
}): { parent: Container; overlay: WeatherOverlay } => {
  const parent = new Container();
  const overlay = WeatherOverlay.create({
    parent,
    frozenFxClock: options?.frozenFxClock ?? false,
  });
  overlay.resize(VIEWPORT);
  return { parent, overlay };
};

/** The weather root inside the parent container. */
const weatherRoot = (parent: Container): Container => {
  const root = parent.getChildByLabel('weather-fx');
  if (!root) {
    throw new Error('weather root missing');
  }
  return root;
};

/** One rain depth batch by name. */
const rainBatch = (parent: Container, depth: 'far' | 'near'): ParticleContainer => {
  const batch = weatherRoot(parent)
    .getChildByLabel('weather-rain')
    ?.getChildByLabel(`weather-rain-${depth}`);
  if (!batch) {
    throw new Error(`rain batch ${depth} missing`);
  }
  return batch as ParticleContainer;
};

/** Live drops in a batch — those not parked outside the viewport. */
const liveParticles = (batch: ParticleContainer) =>
  batch.particleChildren.filter((particle) => particle.x > -1000);

/** Packs a drop's tint/alpha colour back into its alpha byte. */
const alphaByte = (color: number): number => (color >>> 24) & 0xff;

describe('WeatherOverlay lifecycle', () => {
  test('creation attaches exactly one root with the atmosphere and two rain batches', () => {
    const { parent, overlay } = createHarness();
    expect(parent.children.length).toBe(1);

    const root = weatherRoot(parent);
    expect(root.label).toBe('weather-fx');
    // Atmosphere mesh first (haze sits behind the drops), then the rain
    // container holding the two depth batches.
    expect(root.children.length).toBe(2);
    expect(root.children[0]?.label).toBe('weather-atmosphere');
    expect(root.children[1]?.label).toBe('weather-rain');
    expect(root.children[1]?.children.length).toBe(2);

    overlay.destroy();
  });

  test('starts hidden: clear weather draws nothing', () => {
    const { overlay } = createHarness();
    overlay.tick({ deltaMs: 16 });
    const snapshot = overlay.getDebugSnapshot();
    expect(snapshot.visible).toBe(false);
    expect(snapshot.farCount).toBe(0);
    expect(snapshot.nearCount).toBe(0);
    // The pool is allocated, but nothing is live.
    expect(snapshot.poolSize).toBe(FAR_POOL + NEAR_POOL);
    overlay.destroy();
  });

  test('resize scales the pool with viewport area', () => {
    const { overlay } = createHarness();
    expect(overlay.getDebugSnapshot().poolSize).toBe(FAR_POOL + NEAR_POOL);

    overlay.resize({ width: 1920, height: 1080 });
    expect(overlay.getDebugSnapshot().poolSize).toBe(954 + 332);

    overlay.resize({ width: 1280, height: 720 });
    expect(overlay.getDebugSnapshot().poolSize).toBe(FAR_POOL + NEAR_POOL);
    overlay.destroy();
  });

  test('clear → storm → clear transitions without duplicating display objects', () => {
    const { parent, overlay } = createHarness();
    const root = weatherRoot(parent);
    const rainContainer = root.children[1];

    // Clear.
    overlay.tick({ deltaMs: 16 });
    expect(root.visible).toBe(false);

    // Storm.
    overlay.setEnvironmentState({ rainIntensity: 1, windVelocity: 0 });
    // Ease to the target.
    for (let index = 0; index < 400; index++) {
      overlay.tick({ deltaMs: 16 });
    }
    expect(root.visible).toBe(true);
    let snapshot = overlay.getDebugSnapshot();
    expect(snapshot.currentRainIntensity).toBe(1);
    expect(snapshot.farCount).toBe(FAR_POOL);
    expect(snapshot.nearCount).toBe(NEAR_POOL);

    // Back to clear.
    overlay.setEnvironmentState({ rainIntensity: 0, windVelocity: 0 });
    for (let index = 0; index < 400; index++) {
      overlay.tick({ deltaMs: 16 });
    }
    snapshot = overlay.getDebugSnapshot();
    expect(snapshot.currentRainIntensity).toBe(0);
    expect(root.visible).toBe(false);

    // The hierarchy never grew a sibling.
    expect(parent.children.length).toBe(1);
    expect(root.children.length).toBe(2);
    expect(root.children[1]).toBe(rainContainer);
    overlay.destroy();
  });

  test('a resize that does not change the budget keeps the same batches', () => {
    const { parent, overlay } = createHarness();
    const farBefore = rainBatch(parent, 'far');
    const nearBefore = rainBatch(parent, 'near');

    // Same size — must be a no-op for the pools.
    overlay.resize(VIEWPORT);
    expect(rainBatch(parent, 'far')).toBe(farBefore);
    expect(rainBatch(parent, 'near')).toBe(nearBefore);

    // Different size, same rounded budget — still no rebuild.
    overlay.resize({ width: 1281, height: 720 });
    expect(rainBatch(parent, 'far')).toBe(farBefore);

    // A real budget change rebuilds, and the old batches are gone.
    overlay.resize({ width: 1920, height: 1080 });
    expect(rainBatch(parent, 'far')).not.toBe(farBefore);
    expect(weatherRoot(parent).children[1]?.children.length).toBe(2);
    overlay.destroy();
  });

  test('the batch boundsArea tracks the viewport', () => {
    const { parent, overlay } = createHarness();
    overlay.resize({ width: 800, height: 600 });
    expect(rainBatch(parent, 'far').boundsArea?.width).toBe(800);
    expect(rainBatch(parent, 'far').boundsArea?.height).toBe(600);
    overlay.destroy();
  });

  test('the FX hierarchy is never interactive', () => {
    const { parent, overlay } = createHarness();
    const root = weatherRoot(parent);
    expect(root.eventMode).toBe('none');
    expect(root.interactiveChildren).toBe(false);
    expect(rainBatch(parent, 'far').eventMode).toBe('none');
    expect(weatherRoot(parent).children[0]?.eventMode).toBe('none');
    overlay.destroy();
  });

  test('interior scenes show no weather even at full storm', () => {
    const { parent, overlay } = createHarness();
    overlay.setSceneContext({ interior: true });
    overlay.setEnvironmentState({ rainIntensity: 1, windVelocity: 0.5 });
    for (let index = 0; index < 400; index++) {
      overlay.tick({ deltaMs: 16 });
    }
    const snapshot = overlay.getDebugSnapshot();
    // The weather is running — it is simply not drawn.
    expect(snapshot.currentRainIntensity).toBe(1);
    expect(snapshot.visible).toBe(false);
    expect(weatherRoot(parent).visible).toBe(false);

    // Returning outdoors restores it.
    overlay.setSceneContext({ interior: false });
    overlay.tick({ deltaMs: 16 });
    expect(overlay.getDebugSnapshot().visible).toBe(true);
    overlay.destroy();
  });

  test('an interior scene hides weather on the same frame it is set', () => {
    const { parent, overlay } = createHarness();
    overlay.setEnvironmentState({ rainIntensity: 1, windVelocity: 0 });
    for (let index = 0; index < 400; index++) {
      overlay.tick({ deltaMs: 16 });
    }
    expect(weatherRoot(parent).visible).toBe(true);

    // No frame of outdoor rain may leak into an interior map.
    overlay.setSceneContext({ interior: true });
    expect(weatherRoot(parent).visible).toBe(false);
    overlay.destroy();
  });

  test('destroy detaches and is idempotent', () => {
    const { parent, overlay } = createHarness();
    expect(parent.children.length).toBe(1);
    overlay.destroy();
    expect(parent.children.length).toBe(0);
    // A second destroy (or a tick after destroy) must not throw or resurrect
    // anything — repeated enable/disable cycles are a real code path.
    overlay.destroy();
    overlay.tick({ deltaMs: 16 });
    expect(parent.children.length).toBe(0);
  });

  test('detach and attach are idempotent and never duplicate the root', () => {
    const { parent, overlay } = createHarness();
    overlay.attach();
    overlay.attach();
    expect(parent.children.length).toBe(1);
    overlay.detach();
    overlay.detach();
    expect(parent.children.length).toBe(0);
    overlay.attach();
    expect(parent.children.length).toBe(1);
    overlay.destroy();
  });
});

describe('WeatherOverlay determinism', () => {
  test('the frozen clock pins the FX phase', () => {
    const { overlay } = createHarness({ frozenFxClock: true });
    overlay.setEnvironmentState({ rainIntensity: 1, windVelocity: 0.4 });
    overlay.tick({ deltaMs: 16 });
    expect(overlay.getDebugSnapshot().fxTimeSeconds).toBe(FROZEN_FX_TIME_SECONDS);
    // Advancing time does not advance the clock.
    overlay.tick({ deltaMs: 5000 });
    expect(overlay.getDebugSnapshot().fxTimeSeconds).toBe(FROZEN_FX_TIME_SECONDS);
    overlay.destroy();
  });

  test('the frozen clock makes repeated captures identical', () => {
    const positions = (deltas: number[]): number[] => {
      const parent = new Container();
      const overlay = WeatherOverlay.create({ parent, frozenFxClock: true });
      overlay.resize(VIEWPORT);
      overlay.setEnvironmentState({ rainIntensity: 0.85, windVelocity: -0.6 });
      for (const deltaMs of deltas) {
        overlay.tick({ deltaMs });
      }
      const batch = rainBatch(parent, 'far');
      const values: number[] = [];
      for (const particle of liveParticles(batch)) {
        values.push(particle.x, particle.y, particle.rotation, particle.color);
      }
      overlay.destroy();
      return values;
    };

    const first = positions([16, 16, 16, 16, 16]);
    const second = positions([8, 33, 21, 16, 11]);
    expect(first.length).toBeGreaterThan(0);
    expect(first).toEqual(second);
  });

  test('the live clock advances and moves the drops', () => {
    const { parent, overlay } = createHarness();
    overlay.setEnvironmentState({ rainIntensity: 1, windVelocity: 0 });
    overlay.tick({ deltaMs: 16 });
    const before = liveParticles(rainBatch(parent, 'far')).map((particle) => particle.y);

    overlay.tick({ deltaMs: 100 });
    const after = liveParticles(rainBatch(parent, 'far')).map((particle) => particle.y);
    expect(after).not.toEqual(before);
    overlay.destroy();
  });

  test('a pathological delta is clamped rather than teleporting the field', () => {
    const { overlay } = createHarness();
    overlay.setEnvironmentState({ rainIntensity: 1, windVelocity: 0 });
    overlay.tick({ deltaMs: 16 });
    const before = overlay.getDebugSnapshot().fxTimeSeconds;

    // 5 seconds away from a backgrounded tab.
    overlay.tick({ deltaMs: 5000 });
    const after = overlay.getDebugSnapshot().fxTimeSeconds;
    expect(after - before).toBeCloseTo(MAX_FX_DELTA_MS / 1000, 6);
    overlay.destroy();
  });

  test('the same seed reproduces the same drop layout', () => {
    const layout = (seed: number): number[] => {
      const parent = new Container();
      const overlay = WeatherOverlay.create({ parent, seed, frozenFxClock: true });
      overlay.resize(VIEWPORT);
      overlay.setEnvironmentState({ rainIntensity: 1, windVelocity: 0.2 });
      overlay.tick({ deltaMs: 16 });
      const values = liveParticles(rainBatch(parent, 'far')).flatMap((particle) => [
        particle.x,
        particle.y,
      ]);
      overlay.destroy();
      return values;
    };

    expect(layout(WEATHER_FX_SEED)).toEqual(layout(WEATHER_FX_SEED));
    expect(layout(1)).not.toEqual(layout(2));
  });
});

describe('WeatherOverlay rain behaviour', () => {
  test('wind tilts every live streak to the same angle', () => {
    const { parent, overlay } = createHarness({ frozenFxClock: true });
    overlay.setEnvironmentState({ rainIntensity: 1, windVelocity: 0.7 });
    overlay.tick({ deltaMs: 16 });
    const rotations = liveParticles(rainBatch(parent, 'far')).map((particle) => particle.rotation);
    expect(rotations.length).toBe(FAR_POOL);
    const expected = rotations[0] ?? Number.NaN;
    expect(expected).toBeGreaterThan(0);
    for (const rotation of rotations) {
      expect(rotation).toBe(expected);
    }
    overlay.destroy();
  });

  test('wind reverses the streak tilt', () => {
    const tiltFor = (windVelocity: number): number => {
      const parent = new Container();
      const overlay = WeatherOverlay.create({ parent, frozenFxClock: true });
      overlay.resize(VIEWPORT);
      overlay.setEnvironmentState({ rainIntensity: 1, windVelocity });
      overlay.tick({ deltaMs: 16 });
      const rotation = liveParticles(rainBatch(parent, 'far'))[0]?.rotation ?? 0;
      overlay.destroy();
      return rotation;
    };
    expect(tiltFor(0)).toBe(0);
    expect(tiltFor(1)).toBeGreaterThan(0);
    expect(tiltFor(-1)).toBeLessThan(0);
  });

  test('drops recycle inside an off-screen margin, never outside it', () => {
    const { parent, overlay } = createHarness();
    overlay.setEnvironmentState({ rainIntensity: 1, windVelocity: 1 });
    // Sample a long window of FX time so every drop wraps many times.
    for (let index = 0; index < 300; index++) {
      overlay.tick({ deltaMs: 100 });
    }
    for (const depth of ['far', 'near'] as const) {
      const batch = rainBatch(parent, depth);
      const marginY = RAIN_STREAK_TEXTURE_HEIGHT * 2;
      for (const particle of liveParticles(batch)) {
        // Generous bounds: the exact wrap margins are unit-tested separately;
        // this asserts no drop ever escapes the window the recycler uses.
        expect(particle.y).toBeGreaterThan(-marginY - 32);
        expect(particle.y).toBeLessThan(VIEWPORT.height + marginY + 32);
        expect(particle.x).toBeGreaterThan(-VIEWPORT.width);
        expect(particle.x).toBeLessThan(VIEWPORT.width * 2);
      }
    }
    overlay.destroy();
  });

  test('inactive drops are parked outside the viewport with zero alpha', () => {
    const { parent, overlay } = createHarness({ frozenFxClock: true });
    // Light rain: the near layer is almost empty, so most of its pool is parked.
    overlay.setEnvironmentState({ rainIntensity: 0.3, windVelocity: 0 });
    overlay.tick({ deltaMs: 16 });

    const near = rainBatch(parent, 'near');
    const parked = near.particleChildren.filter((particle) => particle.x < -1000);
    expect(parked.length).toBe(NEAR_POOL - 17);
    for (const particle of parked) {
      // Parked, not deleted: the batch's buffers are never re-uploaded.
      expect(particle.y).toBeLessThan(-1000);
      expect(alphaByte(particle.color)).toBe(0);
    }

    // Active drops carry a visible alpha.
    for (const particle of liveParticles(near)) {
      expect(alphaByte(particle.color)).toBeGreaterThan(0);
    }
    overlay.destroy();
  });

  test('near rain is longer and brighter than far rain', () => {
    const { parent, overlay } = createHarness({ frozenFxClock: true });
    overlay.setEnvironmentState({ rainIntensity: 1, windVelocity: 0 });
    overlay.tick({ deltaMs: 16 });

    const meanScaleY = (batch: ParticleContainer): number => {
      const values = liveParticles(batch).map((particle) => particle.scaleY);
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    };
    const meanAlpha = (batch: ParticleContainer): number => {
      const values = liveParticles(batch).map((particle) => alphaByte(particle.color));
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    };

    const far = rainBatch(parent, 'far');
    const near = rainBatch(parent, 'near');
    expect(meanScaleY(near)).toBeGreaterThan(meanScaleY(far));
    expect(meanAlpha(near)).toBeGreaterThan(meanAlpha(far));
    // Both layers share one base texture, which is what keeps the effect at
    // two draw calls.
    expect(far.texture).toBe(near.texture);
    overlay.destroy();
  });

  test('a clear frame does no per-drop work', () => {
    const { parent, overlay } = createHarness();
    overlay.setEnvironmentState({ rainIntensity: 1, windVelocity: 0.3 });
    for (let index = 0; index < 400; index++) {
      overlay.tick({ deltaMs: 16 });
    }

    overlay.setEnvironmentState({ rainIntensity: 0, windVelocity: 0 });
    for (let index = 0; index < 400; index++) {
      overlay.tick({ deltaMs: 16 });
    }
    expect(overlay.getDebugSnapshot().visible).toBe(false);

    // Hidden means the per-drop loop is skipped entirely, so no particle may
    // move — the whole hierarchy leaves the render at zero cost.
    const snapshot = (): number[] => {
      const values: number[] = [];
      for (const particle of rainBatch(parent, 'far').particleChildren) {
        values.push(particle.x, particle.y, particle.color);
      }
      return values;
    };
    const before = snapshot();
    for (let index = 0; index < 200; index++) {
      overlay.tick({ deltaMs: 16 });
    }
    expect(snapshot()).toEqual(before);
    overlay.destroy();
  });
});

describe('RainRenderer and AtmosphereOverlay resource ownership', () => {
  test('the streak texture is a small, nearest-sampled, premultiplied atlas', () => {
    const texture = createRainStreakTexture();
    expect(texture.width).toBe(RAIN_STREAK_TEXTURE_WIDTH);
    expect(texture.height).toBe(RAIN_STREAK_TEXTURE_HEIGHT);
    expect(texture.source.scaleMode).toBe('nearest');
    expect(texture.source.alphaMode).toBe('premultiplied-alpha');
    // Regression guard: a bare `TextureSource` leaves this at `'unknown'`, so no
    // GL/WebGPU uploader matches and every particle silently renders fully
    // transparent. Asserting the id here catches that headlessly.
    expect(texture.source.uploadMethodId).toBe('buffer');
    texture.destroy(true);
  });

  test('RainRenderer frees its texture and leaves no display objects behind', () => {
    const renderer = new RainRenderer({});
    renderer.resize(VIEWPORT);
    expect(renderer.poolSize).toBe(FAR_POOL + NEAR_POOL);
    expect(renderer.container.children.length).toBe(2);
    renderer.destroy();
    expect(renderer.container.children.length).toBe(0);
    // Idempotent.
    renderer.destroy();
  });

  test('AtmosphereOverlay is hidden until it has strength, and destroys once', () => {
    const atmosphere = new AtmosphereOverlay();
    expect(atmosphere.mesh.visible).toBe(false);

    atmosphere.update({
      fxTimeSeconds: 1,
      rainIntensity: 1,
      wind: 0,
      atmosphereStrength: 0,
      viewportWidth: 1280,
      viewportHeight: 720,
    });
    expect(atmosphere.mesh.visible).toBe(false);

    atmosphere.update({
      fxTimeSeconds: 1,
      rainIntensity: 1,
      wind: 0,
      atmosphereStrength: 0.16,
      viewportWidth: 1280,
      viewportHeight: 720,
    });
    expect(atmosphere.mesh.visible).toBe(true);

    atmosphere.destroy();
    atmosphere.destroy();
  });
});
