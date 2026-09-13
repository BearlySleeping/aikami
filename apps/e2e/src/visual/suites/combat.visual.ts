// apps/e2e/src/visual/suites/combat.visual.ts
// Combat UI — declarative visual test suite.
//
// Port of combat_visual.spec.ts. Captures the combat overlay in
// various game states (initial, log-filled, low-hp, victory, defeat)
// using the /dev/combat sandbox with ?state= query params.
//
// Contract: C-166, C-164, C-145, C-335 (production-route cases), C-516 AC-10

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';
import { EMULATOR_PORTS } from '../../config';

/**
 * Origin of the client dev server for THIS run.
 *
 * Contract-scoped runs shift the client off 5274 (see
 * scripts/src/lib/herdr/session.ts), so a hardcoded origin would screenshot
 * whatever else is published on that port.
 */
const CLIENT_ORIGIN = `http://localhost:${EMULATOR_PORTS.client + Number(process.env.PUBLIC_EMULATOR_PORT_OFFSET || 0)}`;

/**
 * A real, authored encounter that the deployed asset seed can resolve.
 *
 * The contract's own `proof_encounter` is authored in the repo but not in the
 * published seed, so the browser cannot fetch it (see the C-516 report).
 */
const V2_RESOLVABLE_ENCOUNTER = 'inn_wand_encounter';

// ── Schema ───────────────────────────────────────────────────

const CombatSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  combatUIVisible: Type.Boolean({ description: 'Whether the combat overlay/sidebar is rendered' }),
  hpBarsVisible: Type.Boolean({
    description: 'Whether HP bars for player and/or enemy are visible',
  }),
  actionButtonsVisible: Type.Boolean({
    description: 'Whether attack/defend/flee buttons are visible',
  }),
  layoutCorrect: Type.Boolean({
    description: 'Whether the split-screen or overlay layout is properly structured',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

/**
 * Schema for the C-516 v2 tactical case.
 *
 * The case declares `requiredTrueFields`, so a generous score cannot paper over
 * a missing turn tracker or an empty forecast panel (C-378).
 */
const CombatV2TacticalSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  combatUIVisible: Type.Boolean({ description: 'Whether the combat sidebar is rendered' }),
  turnTrackerVisible: Type.Boolean({
    description:
      'Whether the turn tracker shows the Move/Action/Quick/Bonus/Reaction budgets with real values',
  }),
  directControlVisible: Type.Boolean({
    description: 'Whether the Move button, ability buttons and target picker are visible',
  }),
  forecastPanelVisible: Type.Boolean({
    description: 'Whether the forecast panel shows both a hit chance and a damage range',
  }),
  layoutCorrect: Type.Boolean({
    description: 'Whether the split-screen layout is properly structured',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompt shared by all cases ───────────────────────────────

const COMBAT_PROMPT = [
  'This is a screenshot from the Aikami game combat UI (/dev/combat sandbox).',
  '',
  'EXPECTED ELEMENTS:',
  '- Combat sidebar or overlay with player and enemy HP bars.',
  '- Action buttons (Attack, Defend, Flee) or combat log entries.',
  '- Character stats display (HP, ATK, DEF, etc.).',
  '- Dark fantasy-themed styling with Aikami UI components.',
  '',
  'EVALUATE:',
  '- Is the combat UI rendered and visible?',
  '- Are HP bars present and displaying health values?',
  '- Are action buttons or combat log entries visible?',
  '- Is the layout structurally sound (no overlapping, no cut-off elements)?',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── State-specific extra prompt text ─────────────────────────

const STATE_PROMPTS: Record<string, string> = {
  initial:
    'This should show the initial combat state — both characters at full HP with action buttons visible.',
  'log-filled': 'The combat log should have multiple entries showing attack/damage history.',
  'low-hp': 'The player HP bar should be critically low (red/danger zone).',
  victory: 'A victory banner or message should be visible indicating combat was won.',
  defeat: 'A defeat banner or game over message should be visible.',
};

// ── Suite ────────────────────────────────────────────────────

/**
 * Dynamic UI selectors to mask — streaming text indicators, AI
 * typing spinners, and particle overlays that are non-deterministic
 * and cause pixel-diff noise between test runs.
 */
const COMBAT_MASK_SELECTORS = [
  '.ai-typing-indicator',
  '.animate-pulse',
  '.loading',
  '[data-testid="streaming-text"]',
];

export default defineConfig({
  id: 'combat',
  route: '/dev/combat',
  waitCondition: 'game_ready',
  cases: [
    {
      name: 'Combat — Initial State',
      searchParams: { state: 'initial' },
      prompt: [COMBAT_PROMPT, '', STATE_PROMPTS.initial].join('\n'),
      schema: CombatSchema,
      mask: COMBAT_MASK_SELECTORS,
      screenshotSelector: 'body',
    },
    {
      name: 'Combat — Log Filled',
      searchParams: { state: 'log-filled' },
      prompt: [COMBAT_PROMPT, '', STATE_PROMPTS['log-filled']].join('\n'),
      schema: CombatSchema,
      mask: COMBAT_MASK_SELECTORS,
      screenshotSelector: 'body',
    },
    {
      name: 'Combat — Low HP',
      searchParams: { state: 'low-hp' },
      prompt: [COMBAT_PROMPT, '', STATE_PROMPTS['low-hp']].join('\n'),
      schema: CombatSchema,
      mask: COMBAT_MASK_SELECTORS,
      screenshotSelector: 'body',
    },
    {
      name: 'Combat — Victory',
      searchParams: { state: 'victory' },
      prompt: [COMBAT_PROMPT, '', STATE_PROMPTS.victory].join('\n'),
      schema: CombatSchema,
      mask: COMBAT_MASK_SELECTORS,
      screenshotSelector: 'body',
    },
    {
      name: 'Combat — Defeat',
      searchParams: { state: 'defeat' },
      prompt: [COMBAT_PROMPT, '', STATE_PROMPTS.defeat].join('\n'),
      schema: CombatSchema,
      mask: COMBAT_MASK_SELECTORS,
      screenshotSelector: 'body',
    },
    // ── Production Route Case (C-335 AC-7, C-500) ─────────
    {
      name: 'Combat — Production /game overlay',
      prompt: [
        COMBAT_PROMPT,
        '',
        'Production /game route — combat was entered through the production',
        'overlay path. Score 90+ only when the combat overlay is FULLY rendered',
        '(portrait stage with both combatants, HP bars, action buttons) rather',
        'than a frozen/empty world view.',
      ].join('\n'),
      schema: CombatSchema,
      mask: COMBAT_MASK_SELECTORS,
      // Capture the whole split-screen combat shell (sidebar + portrait
      // stage), not a 256×256 canvas corner — the AI must see the full UI.
      screenshotSelector: 'body',
      setupHook: async (page) => {
        // Boot the production route directly (combat is local-first and must
        // not be gated behind AI-provider setup).
        await page.goto(`${CLIENT_ORIGIN}/game`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#game-canvas-container canvas', {
          state: 'attached',
          timeout: 30_000,
        });
        await page.waitForSelector('[data-testid="player-hud"]', {
          state: 'visible',
          timeout: 30_000,
        });

        // Enter combat through the non-production test seam, which drives the
        // same production overlay entry path as the dialogue combat chip.
        await page.waitForFunction(
          () =>
            typeof (window as { __AIKAMI_TEST__?: { startCombat?: unknown } }).__AIKAMI_TEST__
              ?.startCombat === 'function',
          undefined,
          { timeout: 20_000 },
        );
        await page.evaluate(() => {
          (
            window as unknown as {
              __AIKAMI_TEST__: {
                startCombat: (options: { enemyName: string; enemyNpcId?: string }) => void;
              };
            }
          ).__AIKAMI_TEST__.startCombat({
            enemyName: 'Rollo the Grasper',
            enemyNpcId: 'rollo_grasper',
          });
        });

        // Wait for the full combat surface to mount.
        await page.waitForSelector('[data-testid="combat-portrait-stage"]', {
          state: 'visible',
          timeout: 15_000,
        });
        await page.waitForSelector('[data-testid="combat-attack-btn"]', {
          state: 'visible',
          timeout: 15_000,
        });
        await page.waitForTimeout(750);
      },
    },
    // ── Production v2 tactical direct controls (C-516 AC-10) ────
    //
    // AC-10 asks for a "v2 tactical overlay" with reachable-cell/target
    // highlights and a forecast panel. The forecast panel half is asserted
    // here; the canvas-highlight half is NOT reachable on `/game` today and is
    // deliberately not claimed — see the prompt below and `game_view.svelte`,
    // whose combat layout replaces the world canvas with the portrait stage, so
    // there is no visible tactical grid to highlight.
    {
      name: 'Combat — Production /game v2 tactical direct controls',
      prompt: [
        'This is a screenshot of the Aikami combat screen on the production',
        '/game route, with a real encounter running on the deterministic v2',
        'combat engine and the player picking a target for their basic attack.',
        '',
        'EXPECTED ELEMENTS:',
        '- A combat sidebar on the left with player and enemy HP bars.',
        '- A turn tracker showing the four action budgets: Move, Action,',
        '  Quick (quick action), Bonus and Reaction.',
        '- A direct-control panel with a Move button and a row of ability',
        '  buttons, plus a target picker.',
        "- A FORECAST PANEL carrying the engine's own numbers: a hit chance",
        '  ("% to hit") and a damage range ("N–M dmg").',
        '- Dark fantasy-themed styling with Aikami UI components.',
        '',
        'EVALUATE:',
        '- Is the combat sidebar rendered with HP bars for both sides?',
        '- Is the turn tracker showing the Move/Action/Quick/Bonus/Reaction',
        '  budgets (a bare or frozen tracker is a fail)?',
        '- Are the Move button, ability buttons and target picker visible?',
        '- Is a forecast panel visible with BOTH a hit chance and a damage',
        '  range? Score below 90 if the panel is absent or shows no numbers.',
        '- Is the layout structurally sound (no overlapping, no cut-off elements)?',
        '',
        'Return ONLY valid JSON matching the schema.',
      ].join('\n'),
      schema: CombatV2TacticalSchema,
      mask: COMBAT_MASK_SELECTORS,
      screenshotSelector: 'body',
      requiredTrueFields: [
        'combatUIVisible',
        'turnTrackerVisible',
        'directControlVisible',
        'forecastPanelVisible',
      ],
      setupHook: async (page) => {
        // Boot the production route directly (combat is local-first and must
        // not be gated behind AI-provider setup).
        await page.goto(`${CLIENT_ORIGIN}/game`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#game-canvas-container canvas', {
          state: 'attached',
          timeout: 30_000,
        });
        await page.waitForSelector('[data-testid="player-hud"]', {
          state: 'visible',
          timeout: 30_000,
        });

        // The C-516 seam launches the REAL authored encounter through the
        // production start path (no stubbed roster), pinned to v2.
        await page.waitForFunction(
          () =>
            typeof (window as { __AIKAMI_TEST__?: { startRealEncounter?: unknown } })
              .__AIKAMI_TEST__?.startRealEncounter === 'function',
          undefined,
          { timeout: 20_000 },
        );
        await page.waitForFunction(
          () =>
            (
              window as { __AIKAMI_TEST__?: { isCombatStartRoutable?: () => boolean } }
            ).__AIKAMI_TEST__?.isCombatStartRoutable?.() === true,
          undefined,
          { timeout: 40_000 },
        );

        // The command is re-sent until the engine answers: a start that arrives
        // before the worker's ECS world exists is ignored by design.
        const deadline = Date.now() + 45_000;
        for (;;) {
          await page.evaluate((encounterId) => {
            (
              window as unknown as {
                __AIKAMI_TEST__: {
                  startRealEncounter: (o: { encounterId: string; engine?: string }) => void;
                };
              }
            ).__AIKAMI_TEST__.startRealEncounter({
              encounterId,
              engine: 'v2',
            });
          }, V2_RESOLVABLE_ENCOUNTER);
          const tracker = await page
            .locator('[data-testid="combat-budget-dots"]')
            .isVisible()
            .catch(() => false);
          if (tracker) {
            break;
          }
          if (Date.now() > deadline) {
            throw new Error('v2 encounter never started — no turn tracker appeared');
          }
          await page.waitForTimeout(1000);
        }

        await page.waitForSelector('[data-testid="combat-end-turn-btn"]', {
          state: 'visible',
          timeout: 20_000,
        });

        // Pick the basic attack, then a target the ENGINE declared legal, so
        // the forecast panel renders its hit chance and damage range.
        await page.click('[data-testid="combat-ability-basic_melee"]');
        await page.waitForSelector('button[data-testid^="combat-target-"]', {
          state: 'visible',
          timeout: 20_000,
        });
        await page.click('button[data-testid^="combat-target-"]');
        await page.waitForFunction(
          () => {
            const panel = document.querySelector('[data-testid="combat-forecast-panel"]');
            return panel !== null && /% to hit/.test(panel.textContent ?? '');
          },
          undefined,
          { timeout: 20_000 },
        );
        await page.waitForTimeout(750);
      },
    },
  ],
});
