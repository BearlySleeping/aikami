// apps/e2e/src/visual/suites/combat_debug_live.visual.ts
// Combat debug workspace — LIVE synthetic battlefield + authored regression.
//
// The fixtures-mode suites cover the presentation components; this suite
// captures the LIVE rendered battlefield the consolidated workspace exists for.
// It asserts the things a blank canvas would fail: a complete synthetic board,
// visible actor tokens, blocked-cell marks, and the authored Emberwatch scene.
//
// Screenshots are clipped to the battlefield pane so the capture is
// deterministic and not dominated by the surrounding inspector chrome.
//
// Contract: combat debug workspace (execution prompt §14, §15)

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const BattlefieldSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of battlefield presentation correctness' }),
  boardVisible: Type.Boolean({
    description: 'Whether a bounded tactical board is visible (not a blank/black pane)',
  }),
  tokensVisible: Type.Boolean({
    description: 'Whether distinct actor tokens are visible on the board',
  }),
  blockedCellsVisible: Type.Boolean({
    description: 'Whether blocked/obstacle cells are visibly marked on the board',
  }),
  authoredScene: Type.Boolean({
    description: 'Whether a real authored map scene (not a synthetic board) is visible',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompts ──────────────────────────────────────────────────

const SYNTHETIC_PROMPT = [
  'This is a screenshot of the Aikami COMBAT DEBUG WORKSPACE battlefield pane,',
  'captured from /dev/combat in LIVE mode running a synthetic scenario.',
  '',
  'EXPECTED:',
  '- A dark, bounded tactical board with a visible grid and a clear border.',
  '- Small circular combatant tokens (a cool-coloured player token and a warm',
  '  hostile token), each with a tiny health strip and a short label.',
  '- One token is drawn with a distinct bright ring (the active combatant).',
  '- The whole board is inside the captured pane; it is not clipped or offscreen.',
  '',
  'EVALUATE:',
  '- Is a bounded board visible rather than an empty/black rectangle?',
  '- Are at least two distinct tokens visible on the board?',
  '- Return ONLY valid JSON matching the schema.',
].join('\n');

const BLOCKED_PROMPT = [
  'This is a screenshot of the Aikami COMBAT DEBUG WORKSPACE battlefield pane,',
  'captured from /dev/combat in LIVE mode running the "movement-geometry"',
  'synthetic scenario, which declares blocked cells.',
  '',
  'EXPECTED:',
  '- A dark, bounded tactical board with a visible grid.',
  '- At least one red/blocked cell is visibly marked on the board.',
  '- Actor tokens are visible and the board fits inside the pane.',
  '',
  'EVALUATE:',
  '- Is a bounded board visible?',
  '- Are one or more blocked cells visibly marked (red-tinted)?',
  '- Return ONLY valid JSON matching the schema.',
].join('\n');

const AUTHORED_PROMPT = [
  'This is a screenshot of the Aikami COMBAT DEBUG WORKSPACE battlefield pane,',
  'captured from /dev/combat in LIVE mode running the authored',
  '"emberwatch-proof" scenario, which loads the real Emberwatch content pack.',
  '',
  'EXPECTED:',
  '- A real authored map scene (tiles, props, floor detail) — NOT a flat',
  '  synthetic grid.',
  '- Actor entities visible on the authored map.',
  '',
  'EVALUATE:',
  '- Is a real authored map scene visible (set authoredScene=true)?',
  '- Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Setup hooks ──────────────────────────────────────────────

/** Selects a synthetic scenario and waits for its board projection. */
const bootSyntheticScenario =
  (scenarioId: string, width: number, height: number) =>
  async (page: import('playwright').Page): Promise<void> => {
    await page.selectOption('#combat-debug-scenario', scenarioId);
    await page.waitForFunction(
      (expected: string) =>
        (
          document.querySelector('[data-testid="combat-debug-battlefield-summary"]')?.textContent ??
          ''
        ).includes(expected),
      `synthetic ${width}×${height}`,
      { timeout: 45_000 },
    );
    await page.waitForFunction(
      () =>
        (
          document.querySelector('[data-testid="combat-debug-parity-summary"]')?.textContent ?? ''
        ).includes('Combatants 2 · projected 2'),
      undefined,
      { timeout: 45_000 },
    );
    await page.waitForTimeout(1_000);
  };

/** Selects the authored scenario and waits for the real map to load. */
const bootAuthoredScenario = async (page: import('playwright').Page): Promise<void> => {
  await page.selectOption('#combat-debug-scenario', 'emberwatch-proof');
  await page.waitForFunction(
    () =>
      (
        document.querySelector('[data-testid="combat-debug-battlefield-summary"]')?.textContent ??
        ''
      ).includes('authored'),
    undefined,
    { timeout: 90_000 },
  );
  await page.waitForTimeout(1_500);
};

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'combat_debug_live',
  route: '/dev/combat',
  waitCondition: 'game_ready',
  cases: [
    {
      name: 'basic-direct-turn — complete synthetic 8×8 board',
      searchParams: { mode: 'live', scenario: 'basic-direct-turn' },
      prompt: SYNTHETIC_PROMPT,
      schema: BattlefieldSchema,
      screenshotSelector: '[data-testid="combat-debug-battlefield"]',
      requiredTrueFields: ['boardVisible', 'tokensVisible'],
      minScore: 80,
      mask: ['.loading', '.animate-pulse'],
      setupHook: bootSyntheticScenario('basic-direct-turn', 8, 8),
    },
    {
      name: 'movement-geometry — blocked cells and 10×10 board',
      searchParams: { mode: 'live', scenario: 'movement-geometry' },
      prompt: BLOCKED_PROMPT,
      schema: BattlefieldSchema,
      screenshotSelector: '[data-testid="combat-debug-battlefield"]',
      requiredTrueFields: ['boardVisible', 'blockedCellsVisible'],
      minScore: 80,
      mask: ['.loading', '.animate-pulse'],
      setupHook: bootSyntheticScenario('movement-geometry', 10, 10),
    },
    {
      name: 'emberwatch-proof — authored Emberwatch scene',
      searchParams: { mode: 'live', scenario: 'emberwatch-proof' },
      prompt: AUTHORED_PROMPT,
      schema: BattlefieldSchema,
      screenshotSelector: '[data-testid="combat-debug-battlefield"]',
      requiredTrueFields: ['authoredScene'],
      minScore: 80,
      mask: ['.loading', '.animate-pulse'],
      setupHook: bootAuthoredScenario,
    },
  ],
});
