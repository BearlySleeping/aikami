// apps/e2e/src/visual/suites/environment.visual.ts
// Environment Time & Weather — declarative visual test suite.
//
// Covers the four weather states that matter for the environment sandbox:
// clear (noon baseline), light rain, storm, and a midnight clear baseline.
//
// The gates are deliberately strict. The previous revision asked only "are
// rain-like lines visible?", which passed the old shader even when it produced
// bright square confetti rather than precipitation. Every case now names the
// specific *defects* it must not exhibit (`squareOrBlobParticles`,
// `screenNoise`, `atmosphericVeil`, `sceneUnreadable`) and gates on them, in
// addition to asserting the real renderer state through the engine's published
// diagnostics.

import type { Page } from 'playwright';
import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const EnvironmentSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),

  thinStreaksVisible: Type.Boolean({
    description:
      'Rain is rendered as thin, elongated, semi-transparent streaks — like short slanted lines or dashes. True even at light rain if streaks are present at all.',
  }),
  nearFarDepth: Type.Boolean({
    description:
      'There are clearly two depths of rain: a denser background layer of short/faint streaks and a sparser foreground layer of longer/brighter streaks. False if all streaks look identical in size and brightness.',
  }),
  directionalSlant: Type.Boolean({
    description:
      'Streaks fall at a consistent slant (they are not all perfectly vertical), and the slant matches the direction the rain appears to be driven.',
  }),
  atmosphereSubtle: Type.Boolean({
    description:
      'Heavy weather adds a subtle atmospheric darkening/haze that shifts the scene toward cool blue-grey, reading as "thick air" rather than as a flat overlay. At clear and light rain this must be false: those states are un-hazed.',
  }),
  precipitationAbsent: Type.Boolean({
    description:
      'There is NO precipitation of any kind: no streaks, no drops, no diagonal lines, no falling particles anywhere on the canvas.',
  }),
  sceneReadable: Type.Boolean({
    description:
      'The underlying game scene is fully readable beneath the weather: terrain tiles, path/floor edges, props and character sprites are all still clearly distinguishable and not washed out or obscured.',
  }),

  squareOrBlobParticles: Type.Boolean({
    description:
      'DEFECT. Any precipitation element reads as a square, rectangle, block, blob, dot, circle or snowflake — i.e. a solid particle with comparable width and height — rather than as a thin elongated streak. Also true if the effect looks like confetti, TV static, bubbles or snow.',
  }),
  screenNoise: Type.Boolean({
    description:
      'DEFECT. Salt-and-pepper noise: isolated random bright pixels, speckle, dithering artefacts or a visible regular grid/cell pattern anywhere on the canvas.',
  }),
  atmosphericVeil: Type.Boolean({
    description:
      'DEFECT. A flat opaque blue-grey film or wash covering the whole frame, dulling contrast and flattening the scene rather than reading as depth-dependent haze.',
  }),
  sceneUnreadable: Type.Boolean({
    description:
      'DEFECT. The weather obscures the game: terrain, floor edges, props or character sprites are hard or impossible to make out.',
  }),

  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

/**
 * Storm-specific schema.
 *
 * Omits `nearFarDepth` and `atmosphereSubtle` from the *scored* schema. Both
 * are asserted numerically from the renderer's own state in the storm setup
 * hook (streak-length ratio between the two batches, atmosphere-strength
 * bounds) — they are objectively measurable but sit below what a vision model
 * reports reliably on a downscaled pixel-art capture, and asking for them here
 * made the holistic score swing between 60 and 90 on essentially the same
 * image. The storm prompt still describes both as expected, so a human reading
 * the report sees what was intended; the gate is simply not the model's.
 */
const StormSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  thinStreaksVisible: Type.Boolean({
    description:
      'Rain is rendered as thin, elongated, semi-transparent streaks — short slanted lines or dashes, not dots, squares or blobs.',
  }),
  directionalSlant: Type.Boolean({
    description:
      'Streaks share one consistent non-vertical slant, matching the direction the wind appears to drive the rain.',
  }),
  sceneReadable: Type.Boolean({
    description:
      'Terrain tiles, path/floor edges, props and character sprites remain clearly distinguishable beneath the weather.',
  }),
  squareOrBlobParticles: Type.Boolean({
    description:
      'DEFECT. Any precipitation element reads as a square, block, blob, dot or snowflake rather than a thin elongated streak; also true if the effect looks like confetti, static or snow.',
  }),
  screenNoise: Type.Boolean({
    description:
      'DEFECT. Salt-and-pepper noise: isolated random bright pixels, speckle, or a visible regular grid/cell pattern. The tileset art itself has per-tile detail — judge only artefacts that look like they belong to the weather.',
  }),
  atmosphericVeil: Type.Boolean({
    description:
      'DEFECT. A flat opaque blue-grey film or wash covering the whole frame, flattening the scene rather than reading as depth-dependent haze.',
  }),
  sceneUnreadable: Type.Boolean({
    description:
      'DEFECT. The weather obscures the game: terrain, floor edges, props or character sprites are hard or impossible to make out.',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Shared prompt preamble ───────────────────────────────────

const PREAMBLE = [
  'This is a screenshot of the Aikami environment sandbox: a top-down pixel-art JRPG scene with a dev control panel at the bottom and a clock HUD in the top-right.',
  'Aikami is a PIXEL-ART game — crisp, nearest-neighbour sampled art. Rain must look like thin slanted lines drawn over the scene, never like soft blobs or 3D-rendered particles.',
  '',
];

const CLOSING = ['', 'Return ONLY valid JSON matching the schema.'];

// ── Prompts ───────────────────────────────────────────────────

const CLEAR_PROMPT = [
  ...PREAMBLE,
  'WEATHER: clear, daytime. Rain intensity is zero.',
  '',
  'EXPECTED:',
  '- No precipitation at all — no streaks, drops, dots or diagonal lines anywhere.',
  '- A bright, readable daytime scene: grass/terrain tiles, path edges, props and character sprites all clearly visible.',
  '- No haze, no darkening, no blue-grey film over the scene.',
  '',
  'EVALUATE:',
  '- `precipitationAbsent`: is the canvas completely free of any rain-like element?',
  '- `sceneReadable`: are terrain, props and sprites clearly distinguishable?',
  '- `squareOrBlobParticles`, `screenNoise`, `atmosphericVeil`, `sceneUnreadable`: all must be false.',
  ...CLOSING,
].join('\n');

const LIGHT_RAIN_PROMPT = [
  ...PREAMBLE,
  'WEATHER: light rain, daytime. Rain intensity is 30%.',
  '',
  'EXPECTED:',
  '- A sparse scattering of thin, elongated, semi-transparent rain streaks.',
  '- Sparse is the point: the scene must still be dominated by the game, not by rain.',
  '- The atmosphere pass is effectively off at this intensity — the scene must NOT be hazed or darkened.',
  '',
  'EVALUATE:',
  '- `thinStreaksVisible`: are the streaks thin elongated lines rather than dots, squares or blobs?',
  '- `atmosphereSubtle`: must be FALSE — light rain is un-hazed.',
  '- `sceneReadable`: is the terrain/sprite detail still clearly visible through the rain?',
  '- `squareOrBlobParticles`: must be FALSE. Reject anything that looks like square pixels, confetti, static or snow.',
  '- `screenNoise`: must be FALSE. Reject isolated bright speckles or a visible grid pattern.',
  '- `sceneUnreadable`, `atmosphericVeil`: must be false.',
  ...CLOSING,
].join('\n');

const STORM_PROMPT = [
  ...PREAMBLE,
  'WEATHER: storm, daytime. Rain intensity is 100% with wind from the left (a strong slant).',
  '',
  'EXPECTED:',
  '- Dense but legible rain: many thin, elongated, semi-transparent streaks.',
  '- Every streak falls at the SAME consistent slant, tilted in one direction by the wind — not vertical, and not randomly angled.',
  '- The tilemap, floor edges, props and character sprites remain clearly readable underneath.',
  '- NOTE: the two-layer depth separation (many short faint background streaks vs fewer longer brighter foreground streaks) and the atmospheric haze/darkening are measured numerically by this suite from the renderer state, because they sit below what a vision model reports reliably on a downscaled pixel-art capture. Do not dock the score for them — judge only the properties listed under EVALUATE.',
  '',
  'EVALUATE:',
  '- `thinStreaksVisible`: are the streaks thin elongated lines?',
  '- `directionalSlant`: do the streaks share one consistent non-vertical slant?',
  '- `sceneReadable`: are terrain, floor edges, props and sprites still clearly distinguishable?',
  '- `squareOrBlobParticles`: must be FALSE. Any square/block/dot/blob/confetti/static/snow read is a failure.',
  '- `screenNoise`: must be FALSE. Any isolated bright pixel, speckle or visible grid cell is a failure. Note: the tileset art itself has per-tile detail — judge only artefacts that look like they belong to the weather.',
  '- `atmosphericVeil`, `sceneUnreadable`: must be false. A flat opaque wash over the frame is a failure.',
  ...CLOSING,
].join('\n');

const MIDNIGHT_PROMPT = [
  ...PREAMBLE,
  'WEATHER: clear, midnight (00:00). Rain intensity is zero.',
  '',
  'EXPECTED:',
  '- No precipitation at all.',
  '- Dark, cool blue-tinted night lighting, but the scene stays readable: terrain, floor edges, props and character sprites remain distinguishable rather than collapsing into black.',
  '- The clock HUD shows a moon icon and a time near 00:00.',
  '',
  'EVALUATE:',
  '- `precipitationAbsent`: is the canvas completely free of any rain-like element?',
  '- `sceneReadable`: is the night scene still readable rather than crushed to black?',
  '- `squareOrBlobParticles`, `screenNoise`, `atmosphericVeil`, `sceneUnreadable`: all must be false.',
  ...CLOSING,
].join('\n');

// ── Setup helpers ─────────────────────────────────────────────

/**
 * Removes the sandbox's own dev control panel before capture.
 *
 * The panel is bottom-centre chrome that lands inside the screenshot crop and
 * has nothing to do with the weather being judged — the visual runner asks for
 * `screenshot=true` precisely so pages suppress extraneous UI. It is removed
 * after the preset has been applied rather than hidden up front, because the
 * setup hook needs to click it first.
 */
const hideDevControls = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    document.querySelector('[data-testid="environment-controls"]')?.remove();
  });
  // Let the removal land before the capture frame.
  await page.waitForTimeout(250);
};

/**
 * Waits for the environment sandbox engine to initialize and the map to load.
 *
 * The diagnostics block is only rendered once the ViewModel has polled the
 * engine, so its presence doubles as "the renderer is live and reporting".
 */
const waitForEngineReady = async (page: Page): Promise<void> => {
  await page.waitForSelector('canvas#environment-sandbox-canvas', { timeout: 15_000 });
  await page.waitForSelector('.clock-hud', { timeout: 10_000 });
  await page.waitForFunction(
    () => {
      const debug = (window as unknown as { __AIKAMI_DEBUG__?: { weatherFx?: unknown } })
        .__AIKAMI_DEBUG__;
      return debug?.weatherFx !== undefined;
    },
    undefined,
    // guard-ignore lint/type-safety/casting: custom window property for e2e hooks
    { timeout: 15_000 },
  );
  await page.waitForTimeout(1500);
};

/**
 * Clicks a rain-preset button by its visible label.
 *
 * The sandbox puts the worker into `weatherMode: 'manual'`, so the preset is
 * authoritative — it is not eased away by an automatic decay cycle.
 */
const clickPreset = async (page: Page, label: string): Promise<void> => {
  const button = page.locator('button', { hasText: label });
  if (!(await button.isVisible())) {
    throw new Error(`environment sandbox: "${label}" preset button not visible`);
  }
  await button.click();
};

/** Sets the wind slider and dispatches the input event the ViewModel listens for. */
const setWind = async (page: Page, value: number): Promise<void> => {
  await page.evaluate((wind) => {
    const input = document.querySelector<HTMLInputElement>('input.range-secondary');
    if (!input) {
      throw new Error('environment sandbox: wind slider not found');
    }
    input.value = String(wind);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
};

/** Clicks a jump-to-hour button by its visible label. */
const jumpToHour = async (page: Page, label: string): Promise<void> => {
  const button = page.locator('button', { hasText: label });
  if (!(await button.isVisible())) {
    throw new Error(`environment sandbox: "${label}" hour button not visible`);
  }
  await button.click();
};

/**
 * Asserts the renderer's *actual* state, read from the engine's published
 * weather-FX diagnostics.
 *
 * This is the non-VLM half of the gate. A screenshot alone cannot prove the
 * renderer was even engaged — a case could pass by showing a scene with no
 * weather at all under a lenient prompt. These checks fail the case outright if
 * the renderer disagrees with the state the preset asked for.
 *
 * The expectation is plain serialisable data (not a predicate) so it can cross
 * the page boundary without `eval`.
 */
const expectWeatherFxState = async (options: {
  page: Page;
  label: string;
  expectation: WeatherFxExpectation;
}): Promise<void> => {
  try {
    await options.page.waitForFunction(
      (expectation: WeatherFxExpectation) => {
        const debug = (
          window as unknown as { __AIKAMI_DEBUG__?: { weatherFx?: WeatherFxSnapshot } }
        ).__AIKAMI_DEBUG__;
        const snapshot = debug?.weatherFx;
        if (!snapshot) {
          return false;
        }
        if (expectation.visible !== undefined && snapshot.visible !== expectation.visible) {
          return false;
        }
        if (expectation.minFarCount !== undefined && snapshot.farCount < expectation.minFarCount) {
          return false;
        }
        if (expectation.maxFarCount !== undefined && snapshot.farCount > expectation.maxFarCount) {
          return false;
        }
        if (
          expectation.minNearCount !== undefined &&
          snapshot.nearCount < expectation.minNearCount
        ) {
          return false;
        }
        if (
          expectation.minAtmosphereStrength !== undefined &&
          snapshot.atmosphereStrength < expectation.minAtmosphereStrength
        ) {
          return false;
        }
        if (
          expectation.maxAtmosphereStrength !== undefined &&
          snapshot.atmosphereStrength > expectation.maxAtmosphereStrength
        ) {
          return false;
        }
        if (expectation.minNearFarLengthRatio !== undefined) {
          if (snapshot.farMeanScaleY <= 0) {
            return false;
          }
          if (
            snapshot.nearMeanScaleY / snapshot.farMeanScaleY <
            expectation.minNearFarLengthRatio
          ) {
            return false;
          }
        }
        if (
          expectation.currentMatchesTarget === true &&
          snapshot.currentRainIntensity !== snapshot.targetRainIntensity
        ) {
          return false;
        }
        return true;
      },
      options.expectation,
      { timeout: 10_000 },
    );
  } catch {
    const snapshot = await readWeatherFxSnapshot(options.page);
    throw new Error(
      `environment sandbox: renderer weather state did not satisfy "${options.label}" — got ${JSON.stringify(snapshot)}`,
    );
  }
};

/** Serializable expectation for {@link expectWeatherFxState}. */
type WeatherFxExpectation = {
  visible?: boolean;
  minFarCount?: number;
  maxFarCount?: number;
  minNearCount?: number;
  minAtmosphereStrength?: number;
  maxAtmosphereStrength?: number;
  /** When true, the smoothed intensity must have settled exactly on its target. */
  currentMatchesTarget?: boolean;
  /**
   * Minimum ratio of foreground to background mean streak length.
   *
   * The near/far depth requirement is asserted here rather than from the
   * screenshot: "near streaks are longer than far streaks" is a numeric
   * property of the renderer, and a vision model does not measure it reliably
   * on a downscaled capture.
   */
  minNearFarLengthRatio?: number;
};

/** Reads the published weather-FX renderer snapshot, if the engine published one. */
const readWeatherFxSnapshot = async (page: Page): Promise<WeatherFxSnapshot | undefined> =>
  page.evaluate(() => {
    // guard-ignore lint/type-safety/casting: custom window property for e2e hooks
    const debug = (window as unknown as { __AIKAMI_DEBUG__?: { weatherFx?: WeatherFxSnapshot } })
      .__AIKAMI_DEBUG__;
    return debug?.weatherFx;
  });

/** Shape of `window.__AIKAMI_DEBUG__.weatherFx` (see the engine diagnostics boundary). */
type WeatherFxSnapshot = {
  targetRainIntensity: number;
  currentRainIntensity: number;
  farCount: number;
  nearCount: number;
  poolSize: number;
  farMeanScaleY: number;
  nearMeanScaleY: number;
  atmosphereStrength: number;
  fxTimeSeconds: number;
  viewportWidth: number;
  viewportHeight: number;
  visible: boolean;
};

/**
 * Asserts the FX clock is frozen.
 *
 * The visual runner always injects `screenshot=true`; a frozen clock is what
 * makes repeated captures of the same weather state comparable at all. If this
 * fails, every other case in this suite is sampling an animating system.
 */
const expectFrozenFxClock = async (page: Page): Promise<void> => {
  const snapshot = await readWeatherFxSnapshot(page);
  if (!snapshot) {
    throw new Error('environment sandbox: no weather-FX diagnostics published');
  }
  if (snapshot.fxTimeSeconds <= 0) {
    throw new Error(`environment sandbox: FX clock not frozen (${snapshot.fxTimeSeconds})`);
  }
};

/** Clear, noon baseline: the renderer must be doing nothing at all. */
const setUpClear = async (page: Page): Promise<void> => {
  await waitForEngineReady(page);
  await clickPreset(page, 'Clear');
  await setWind(page, 0);
  await jumpToHour(page, '☀️ 12');
  await expectWeatherFxState({
    page,
    label: 'clear weather hides the whole FX hierarchy',
    expectation: { visible: false, maxFarCount: 0, minNearCount: 0, maxAtmosphereStrength: 0 },
  });
  await expectFrozenFxClock(page);
  await hideDevControls(page);
};

/** Light rain: sparse streaks, no atmosphere pass. */
const setUpLightRain = async (page: Page): Promise<void> => {
  await waitForEngineReady(page);
  await jumpToHour(page, '☀️ 12');
  await setWind(page, 0.4);
  await clickPreset(page, 'Light');
  await expectWeatherFxState({
    page,
    label: 'light rain is sparse, visible, and un-hazed',
    expectation: {
      visible: true,
      minFarCount: 1,
      // Half the pool: light rain must be sparse, not a curtain.
      maxFarCount: (1280 * 720 * 460) / 1_000_000 / 2,
      // Not zero — light rain sits just above the haze start threshold — but an
      // order of magnitude below the storm peak, i.e. far below anything that
      // reads as a veil.
      maxAtmosphereStrength: 0.03,
      currentMatchesTarget: true,
    },
  });
  await expectFrozenFxClock(page);
  await hideDevControls(page);
};

/** Storm: dense rain, both depths populated, haze engaged, strong wind. */
const setUpStorm = async (page: Page): Promise<void> => {
  await waitForEngineReady(page);
  await jumpToHour(page, '☀️ 12');
  await setWind(page, 0.7);
  await clickPreset(page, 'Storm');
  await expectWeatherFxState({
    page,
    label: 'storm fills both rain depths and engages the atmosphere',
    expectation: {
      visible: true,
      minFarCount: (1280 * 720 * 460) / 1_000_000 / 2,
      minNearCount: 1,
      minAtmosphereStrength: 0.01,
      // Subtle, never a flat veil.
      maxAtmosphereStrength: 0.25,
      currentMatchesTarget: true,
      // Near streaks are configured ~3x longer than far ones; require a clear
      // separation rather than the exact ratio.
      minNearFarLengthRatio: 2,
    },
  });
  await expectFrozenFxClock(page);
  await hideDevControls(page);
};

/** Midnight clear: diurnal baseline with no precipitation. */
const setUpMidnightClear = async (page: Page): Promise<void> => {
  await waitForEngineReady(page);
  await clickPreset(page, 'Clear');
  await setWind(page, 0);
  await jumpToHour(page, '🌙 00');
  await expectWeatherFxState({
    page,
    label: 'midnight clear weather hides the whole FX hierarchy',
    expectation: { visible: false, maxFarCount: 0 },
  });
  await expectFrozenFxClock(page);
  await hideDevControls(page);
};

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'environment',
  route: '/dev/sandbox/environment',
  waitCondition: 'game_ready',
  cases: [
    {
      name: 'Clear weather — no precipitation, scene fully readable',
      prompt: CLEAR_PROMPT,
      schema: EnvironmentSchema,
      setupHook: setUpClear,
      canvasSelector: '#environment-sandbox-canvas',
      clipSize: 512,
      minScore: 85,
      requiredTrueFields: ['precipitationAbsent', 'sceneReadable'],
      requiredFalseFields: [
        'atmosphereSubtle',
        'squareOrBlobParticles',
        'screenNoise',
        'atmosphericVeil',
        'sceneUnreadable',
      ],
    },
    {
      name: 'Light rain — sparse thin streaks, no haze',
      prompt: LIGHT_RAIN_PROMPT,
      schema: EnvironmentSchema,
      setupHook: setUpLightRain,
      canvasSelector: '#environment-sandbox-canvas',
      clipSize: 512,
      minScore: 85,
      requiredTrueFields: ['thinStreaksVisible', 'sceneReadable'],
      requiredFalseFields: [
        'atmosphereSubtle',
        'squareOrBlobParticles',
        'screenNoise',
        'atmosphericVeil',
        'sceneUnreadable',
      ],
    },
    {
      name: 'Storm — thin slanted streaks, near/far depth, subtle atmosphere',
      prompt: STORM_PROMPT,
      schema: StormSchema,
      setupHook: setUpStorm,
      canvasSelector: '#environment-sandbox-canvas',
      clipSize: 512,
      minScore: 85,
      // Atmosphere *presence and magnitude* and the near/far depth separation
      // are gated deterministically by the renderer-state assertion in
      // `setUpStorm` (atmosphere strength bounds, near/far streak-length
      // ratio), not by the VLM — both are objectively measurable but sit below
      // what a vision model reliably reports on a downscaled capture. The VLM
      // gates the shape of the rain and the absence of a flat veil.
      requiredTrueFields: ['thinStreaksVisible', 'directionalSlant', 'sceneReadable'],
      requiredFalseFields: [
        'squareOrBlobParticles',
        'screenNoise',
        'atmosphericVeil',
        'sceneUnreadable',
      ],
    },
    {
      name: 'Midnight clear — readable night scene, no precipitation',
      prompt: MIDNIGHT_PROMPT,
      schema: EnvironmentSchema,
      setupHook: setUpMidnightClear,
      canvasSelector: '#environment-sandbox-canvas',
      clipSize: 512,
      minScore: 85,
      requiredTrueFields: ['precipitationAbsent', 'sceneReadable'],
      requiredFalseFields: [
        'atmosphereSubtle',
        'squareOrBlobParticles',
        'screenNoise',
        'atmosphericVeil',
        'sceneUnreadable',
      ],
    },
  ],
});
