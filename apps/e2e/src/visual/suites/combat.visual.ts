// apps/e2e/src/visual/suites/combat.visual.ts
// Combat UI — declarative visual test suite.
//
// Port of combat_visual.spec.ts. Captures the combat overlay in
// various game states (initial, log-filled, low-hp, victory, defeat)
// using the /dev/combat sandbox with ?state= query params.
//
// Contract: C-166, C-164, C-145, C-335 (production-route cases), C-516 AC-10

import { CombatIntentSchema, CombatV2HighlightsSchema } from '@aikami/schemas';
import type { Page } from 'playwright';
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
const CLIENT_ORIGIN = `http://localhost:${EMULATOR_PORTS.client}`;

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

/**
 * Schema for the C-526 readable-intent / degradation case.
 *
 * `requiredTrueFields` is what makes this an assertion rather than a score: a
 * log panel without the two C-526 lines cannot pass on a generous model score.
 */
const CombatV2AiIntentSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  combatUIVisible: Type.Boolean({ description: 'Whether the combat sidebar is rendered' }),
  logPanelVisible: Type.Boolean({
    description: 'Whether the combat log panel is rendered with at least one entry',
  }),
  intentLineVisible: Type.Boolean({
    description: 'Whether a readable AI intention line starting with "Intent —" is visible',
  }),
  degradedLineVisible: Type.Boolean({
    description: 'Whether a "Deterministic AI —" fallback line is visible in the log',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

/**
 * Boots `/game` and starts the real authored v2 encounter through the
 * non-production test seam, waiting until the turn tracker is live.
 *
 * Shared by the v2 visual cases so the encounter-start logic exists in one
 * place; the seam drives the SAME production start path as the dialogue chip.
 */
const startV2Encounter = async (page: Page): Promise<void> => {
  // Boot the production route directly (combat is local-first and must not be
  // gated behind AI-provider setup).
  await page.goto(`${CLIENT_ORIGIN}/game`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#game-canvas-container canvas', {
    state: 'attached',
    timeout: 30_000,
  });
  await page.waitForSelector('[data-testid="player-hud"]', {
    state: 'visible',
    timeout: 30_000,
  });

  await page.waitForFunction(
    () =>
      typeof (window as { __AIKAMI_TEST__?: { startRealEncounter?: unknown } }).__AIKAMI_TEST__
        ?.startRealEncounter === 'function',
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
      ).__AIKAMI_TEST__.startRealEncounter({ encounterId, engine: 'v2' });
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
};

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
    // AC-10's forecast-panel half: the engine's own hit chance and damage
    // range render for a committed target. The reachable-cell/target highlight
    // half is asserted by the dedicated move-highlights case below.
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
        await startV2Encounter(page);

        // Pick the basic attack, then a target the ENGINE declared legal, so
        // the forecast panel renders its hit chance and damage range and the
        // engine-declared target cell is highlighted on the battlefield.
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
    // ── Reachable-cell highlights (C-525 R-2) ────────────────────
    //
    // The headline remediation claim: entering move selection keeps the
    // tactical world canvas visible and paints the reachable cells, so a
    // human can see where a click-to-move will land. `highlightsVisible` is
    // a required-true field at a 90+ threshold.
    {
      name: 'Combat — Production /game v2 move highlights',
      prompt: [
        'This is a screenshot of the Aikami combat screen on the production',
        '/game route, with a real encounter running on the deterministic v2',
        'combat engine. The player has clicked Move and is choosing a',
        'destination cell.',
        '',
        'EXPECTED ELEMENTS:',
        '- A combat sidebar on the left with player and enemy HP bars and a',
        '  direct-control panel whose Move button is active.',
        '- The REMAINING AREA is the VISIBLE TACTICAL WORLD CANVAS (a tile',
        '  grid with the combatants), NOT an opaque portrait stage.',
        '- MULTIPLE reachable cells around the active combatant are painted',
        '  with a coloured (blue) overlay — the move range.',
        '',
        'EVALUATE:',
        '- Is the combat sidebar rendered with HP bars and an active Move button?',
        '- Is the tactical battlefield visible (a grid, not an opaque portrait',
        '  stage with no world)?',
        '- Are reachable cells highlighted with a coloured overlay? If the world',
        '  is not visible or no cell is highlighted, set highlightsVisible=false',
        '  and score below 90.',
        '- Is the layout structurally sound (no overlapping, no cut-off elements)?',
        '',
        'Return ONLY valid JSON matching the schema.',
      ].join('\n'),
      schema: CombatV2HighlightsSchema,
      mask: COMBAT_MASK_SELECTORS,
      screenshotSelector: 'body',
      requiredTrueFields: ['combatUIVisible', 'highlightsVisible'],
      minScore: 90,
      setupHook: async (page) => {
        await startV2Encounter(page);

        // Enter move selection and wait for the engine's reachable answer.
        await page.click('[data-testid="combat-move-btn"]');
        await page.waitForSelector('[data-testid="combat-move-hint"]', {
          state: 'visible',
          timeout: 20_000,
        });
        await page.waitForTimeout(750);
      },
    },
    // ── Natural-language intent + confirmation surface (C-525 AC-4/AC-9) ────
    //
    // The Combat-05 surface itself: the instruction field, the compiled plan
    // preview and the explicit Confirm/Cancel pair. The instruction is a real
    // ONE — it is submitted through the production decision loop (offline: the
    // interpreter provider is absent, so the deterministic parser compiles it)
    // and the plan shown is the one the engine's state grounded.
    {
      name: 'Combat — Production /game v2 language intent preview',
      prompt: [
        'This screenshot is a CLOSE CROP of the combat sidebar natural-language',
        'panel, taken on the production /game route during a real encounter that',
        'is running on the deterministic v2 combat engine. The player typed',
        '"move to the nearest enemy" and the system compiled a plan that is',
        'waiting for confirmation.',
        '',
        'EXPECTED ELEMENTS (inside this crop):',
        '- A text field for the instruction with a submit button next to it',
        '  (the field is labelled for screen readers as "Combat instruction").',
        '- Below it, a CONFIRMATION PANEL for the compiled plan: a heading naming',
        '  the command (e.g. "move") and a destination cell, then the engine',
        '  numbers the plan will use (a cost in cells, a "% to hit" chance',
        '  and/or a damage range).',
        '- Inside that panel: BOTH a "Confirm" button and a "Cancel" button.',
        '',
        'EVALUATE:',
        '- Is the instruction field with its submit button present?',
        '- Is the confirmation panel present with a resolved plan (numbers, not an',
        '  empty box)? If it is missing, set confirmationVisible=false and score',
        '  below 90.',
        '- Are the plan numbers visible (a cost in cells and/or a % to hit and/or a',
        '  damage range)? If not, set planNumbersVisible=false and score below 90.',
        '- Is the crop well structured (nothing cut off mid-control)?',
        '',
        'Return ONLY valid JSON matching the schema.',
      ].join('\n'),
      schema: CombatIntentSchema,
      mask: COMBAT_MASK_SELECTORS,
      // Crop to the language surface: it is a narrow bottom column of the
      // sidebar, and a full-page capture renders it too small to judge.
      screenshotSelector: '[data-testid="combat-intent-panel"]',
      requiredTrueFields: ['intentInputVisible', 'confirmationVisible', 'planNumbersVisible'],
      minScore: 85,
      setupHook: async (page) => {
        await startV2Encounter(page);

        // Wait for the PLAYER's turn: the encounter opens on the enemy, and a
        // compile while the enemy is active is rejected as notActiveCombatant.
        const deadline = Date.now() + 30_000;
        for (;;) {
          await page.fill('[data-testid="combat-intent-input"]', 'move to the nearest enemy');
          await page.click('[data-testid="combat-intent-submit"]');
          try {
            await page.waitForSelector('[data-testid="combat-intent-preview"]', {
              state: 'visible',
              timeout: 6_000,
            });
            break;
          } catch {
            if (Date.now() > deadline) {
              throw new Error('the language intent never produced a compiled preview');
            }
            await page.waitForTimeout(500);
          }
        }
        // The panel is the last block of the sidebar: make sure it is fully in
        // view before the crop is taken.
        await page
          .locator('[data-testid="combat-intent-panel"]')
          .scrollIntoViewIfNeeded()
          .catch(() => {});
        await page.waitForTimeout(750);
      },
    },
    // ── Production AI presentation (C-526 AC-7 + AC-9) ─────
    //
    // The LLM agent layer is pinned OFF in this environment (no provider), so
    // this case captures the guarantee the kill switch makes: every AI turn is
    // planned deterministically, the player can read what the enemy intends, and
    // the fallback is reported in the log rather than hidden.
    {
      name: 'Combat — Production /game v2 AI intent + deterministic fallback',
      prompt: [
        'This is a screenshot of the Aikami combat screen on the production',
        '/game route, with a real encounter running on the deterministic v2',
        'combat engine and the LLM agent layer switched OFF (its provider is',
        'unavailable).',
        '',
        'EXPECTED ELEMENTS:',
        '- A combat sidebar on the left with player and enemy HP bars, a turn',
        '  tracker, and an initiative tracker listing the combatants.',
        '- A COMBAT LOG panel containing at least two entries that name the',
        '  acting combatant:',
        '    * a readable intention line starting with "Intent —" (for example',
        '      "Intent — preparing an attack on player"), and',
        '    * a degradation line starting with "Deterministic AI —" (for',
        '      example "Deterministic AI — agent layer off").',
        '- The log text is plain readable prose, not an error toast, a stack',
        '  trace, or an empty placeholder such as "No events yet.".',
        '',
        'EVALUATE:',
        '- Is the combat UI rendered with its log panel?',
        '- Are BOTH the "Intent —" line and the "Deterministic AI —" line',
        '  visible in that log?',
        '- Does the layout look like a working fight rather than a broken one?',
        '',
        'Return ONLY valid JSON matching the schema.',
      ].join('\n'),
      schema: CombatV2AiIntentSchema,
      mask: COMBAT_MASK_SELECTORS,
      screenshotSelector: 'body',
      requiredTrueFields: [
        'combatUIVisible',
        'logPanelVisible',
        'intentLineVisible',
        'degradedLineVisible',
      ],
      minScore: 85,
      setupHook: async (page) => {
        await startV2Encounter(page);
        await page.waitForSelector('[data-testid="combat-log"]', {
          state: 'visible',
          timeout: 30_000,
        });

        // Hand the turn over until the enemy side has actually acted: with the
        // agent layer pinned off, the deterministic planner owns every AI turn
        // and reports itself once per actor.
        const logText = async (): Promise<string> =>
          await page
            .locator('[data-testid="combat-log"]')
            .innerText()
            .catch(() => '');
        const deadline = Date.now() + 60_000;
        for (;;) {
          const text = await logText();
          if (text.includes('Deterministic AI') && text.includes('Intent —')) {
            break;
          }
          if (Date.now() > deadline) {
            throw new Error('the AI-offline lane never surfaced its intent/degradation lines');
          }
          const endTurn = page.locator('[data-testid="combat-end-turn-btn"]');
          if (await endTurn.isVisible().catch(() => false)) {
            await endTurn.click({ force: true }).catch(() => {});
          }
          await page.waitForTimeout(700);
        }
        await page.waitForTimeout(400);
      },
    },
  ],
});
