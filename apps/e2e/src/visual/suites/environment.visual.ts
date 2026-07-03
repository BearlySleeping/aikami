// apps/e2e/src/visual/suites/environment.visual.ts
// Environment Time & Weather — declarative visual test suite.
//
// Captures the environment sandbox with rain overlay at maximum intensity
// and at midnight baseline. Evaluates via AI to verify rain streaks,
// fog effect, and diurnal colour shifts.
//
// Contract: C-213 Environment, Time, and Weather Core System

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const EnvironmentSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  rainDetected: Type.Boolean({
    description: 'Whether rain streaks or diagonal lines are visible across the screen',
  }),
  fogEffect: Type.Boolean({
    description: 'Whether a subtle fog/darkening effect is present across the scene',
  }),
  clockHudVisible: Type.Boolean({
    description: 'Whether the clock HUD (HH:MM with sun/moon icon) is visible in the top-right',
  }),
  gameSceneIntact: Type.Boolean({
    description:
      'Whether the game tilemap and character sprites are still visible beneath the weather',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompts ───────────────────────────────────────────────────

const RAIN_PROMPT = [
  'This is a screenshot of the Aikami environment sandbox with maximum rain intensity.',
  '',
  'EXPECTED:',
  '- Rain streaks (thin diagonal or vertical lines) across the screen.',
  '- Multiple layers: larger drops in foreground, smaller drops in background.',
  '- A subtle fog/darkening effect over the scene.',
  '- The game tilemap and character sprites should still be visible underneath.',
  '- The clock HUD (game time with emoji icon) should be visible in the top-right corner.',
  '',
  'EVALUATE:',
  '- Are rain streaks visible? Are there multiple layers (large + small)?',
  '- Is there a fog/darkening effect across the scene?',
  '- Is the clock HUD visible?',
  '- Is the game scene (tilemap, sprites) still rendered beneath?',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

const MIDNIGHT_PROMPT = [
  'This is a screenshot of the Aikami environment sandbox at midnight (00:00) with clear weather.',
  '',
  'EXPECTED:',
  '- The game tilemap and character sprites should be visible.',
  '- Dark blue-black colour tones across the scene (midnight lighting).',
  '- The clock HUD should show a moon icon and time near 00:00.',
  '- No rain, no fog.',
  '',
  'EVALUATE:',
  '- Is the scene dark/tinted with blue-black midnight tones?',
  '- Is the clock HUD visible with a moon icon?',
  '- Is the game scene intact with no weather overlay?',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Setup helpers ─────────────────────────────────────────────

/**
 * Waits for the environment sandbox engine to initialize and the map to load.
 */
const waitForEngineReady = async (page: import('playwright').Page): Promise<void> => {
  await page.waitForSelector('canvas#environment-sandbox-canvas', { timeout: 15000 });
  await page.waitForSelector('.clock-hud', { timeout: 10000 });
  await page.waitForTimeout(2000);
};

/**
 * Sets rain intensity to maximum and captures the weather overlay.
 */
const setRainToMax = async (page: import('playwright').Page): Promise<void> => {
  await waitForEngineReady(page);
  const stormButton = page.locator('button', { hasText: 'Storm' });
  if (await stormButton.isVisible()) {
    await stormButton.click();
  }
  await page.waitForTimeout(2000);
};

/**
 * Sets rain to clear and jumps to midnight for the diurnal baseline.
 */
const setMidnightClear = async (page: import('playwright').Page): Promise<void> => {
  await waitForEngineReady(page);
  const clearButton = page.locator('button', { hasText: 'Clear' });
  if (await clearButton.isVisible()) {
    await clearButton.click();
  }
  await page.waitForTimeout(500);
  const midnightButton = page.locator('button', { hasText: '🌙 00' });
  if (await midnightButton.isVisible()) {
    await midnightButton.click();
  }
  await page.waitForTimeout(500);
};

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'environment',
  route: '/dev/sandbox/environment',
  waitCondition: 'game_ready',
  cases: [
    {
      name: 'Rain at max intensity with weather overlay',
      prompt: RAIN_PROMPT,
      schema: EnvironmentSchema,
      setupHook: setRainToMax,
    },
    {
      name: 'Midnight with clear weather (diurnal baseline)',
      prompt: MIDNIGHT_PROMPT,
      schema: EnvironmentSchema,
      setupHook: setMidnightClear,
    },
  ],
});
