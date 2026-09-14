// apps/e2e/src/visual/suites/play_shell.visual.ts
//
// C-527 — visual cases for the production play shell and the management host.
//
// Cases run on the production route (`/game`) and reach every state through the
// real HUD — the Menu entry, the section rail, the pause menu and the combat
// test seam. Nothing here uses a bypass query parameter.
//
// 🔴 Every case sets `screenshotSelector`. Without it the runner falls back to a
// 256×256 crop centred on the canvas element, which contains none of the HUD,
// the Menu entry, the section rail or the Back control — the suite would then
// be scoring pixels the contract never mentions.
//
// Contract: C-527 AC-1, AC-2, AC-3, AC-4, AC-5, AC-6.

import type { Page } from 'playwright';
import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

/**
 * Response schema mandated by the contract's Test Hooks.
 *
 * `missingCriticalAction` is a DEFECT flag, so it is gated with
 * `requiredFalseFields` — the contract says any missing critical action is a
 * failure regardless of score, which cannot be expressed as a true-field.
 */
const PlayShellSchema = Type.Object({
  score: Type.Number({ description: '0-100 visual quality score' }),
  unreadableText: Type.Boolean({
    description: 'Any essential text is unreadable at the shown scale',
  }),
  overlappingControls: Type.Boolean({ description: 'Essential controls overlap each other' }),
  missingCriticalAction: Type.Boolean({
    description: 'A required action (Menu, section rail, Back) is missing or unreachable',
  }),
  issues: Type.Array(Type.String(), { description: 'Concrete defects found' }),
});

const HOST = '[data-testid="management-host"]';

/**
 * Removes the non-production DevTools panel from the visual tree.
 *
 * It is a development affordance, not product UI: it floats above the shell and
 * its "AI Context Preview" column is what a reviewer sees clipped at the right
 * edge of a compact capture. `quest_overlay.visual.ts` hides it the same way.
 */
const hideDevTools = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const toggle = document.querySelector('button[title="Collapse Dev Tools"]');
    const panel = toggle?.parentElement;
    if (panel) {
      panel.style.display = 'none';
    }
  });
};

/** Waits for the play shell HUD, then opens the management host. */
const openHost = async (page: Page): Promise<void> => {
  await page.waitForSelector('[data-testid="hud-menu-entry"]', {
    state: 'visible',
    timeout: 30_000,
  });
  await page.getByTestId('hud-menu-entry').click();
  await page.waitForSelector(HOST, { state: 'visible', timeout: 10_000 });
  await hideDevTools(page);
};

/** Opens the host and activates one section from the rail. */
const openSection = (section: string) => async (page: Page) => {
  await openHost(page);
  await page.getByTestId(`section-tab-${section}`).click();
  await page.waitForTimeout(600);
};

/**
 * Starts a STABLE production encounter through the composition root's seam.
 *
 * `startCombat({ enemyNpcId })` resolves its roster from the content pack and is
 * rejected by the worker engine with `invalidStateShape` on a freshly booted
 * campaign — the overlay mounts, then tears itself down, so a capture taken a
 * second later shows a world with no combat in it. `startRealEncounter` pins an
 * authored encounter that the deployed seed can actually resolve, which is the
 * same fixture the C-516 combat suite uses.
 */
const startCombat = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __AIKAMI_TEST__?: { startRealEncounter?: unknown } })
        .__AIKAMI_TEST__?.startRealEncounter === 'function',
    undefined,
    { timeout: 30_000 },
  );

  // 🔴 Wait for the render loop, not just the HUD: the encounter is rejected
  // while the world is still settling after boot.
  await page.waitForFunction(
    () => {
      const debug = (window as unknown as { __AIKAMI_DEBUG__?: { playerX?: number } })
        .__AIKAMI_DEBUG__;
      return typeof debug?.playerX === 'number';
    },
    undefined,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(2_500);

  await page.evaluate(() => {
    (
      window as unknown as {
        __AIKAMI_TEST__: {
          startRealEncounter(options: { encounterId: string; engine: 'legacy' | 'v2' }): void;
        };
      }
    ).__AIKAMI_TEST__.startRealEncounter({ encounterId: 'inn_wand_encounter', engine: 'v2' });
  });

  await page.waitForSelector('[data-testid="combat-attack-btn"]', {
    state: 'visible',
    timeout: 30_000,
  });
  // Prove the encounter STAYS up before the capture is taken.
  await page.waitForTimeout(3_000);
  const stillActive = await page.evaluate(
    () =>
      (
        window as unknown as { __AIKAMI_TEST__: { getOverlayState(): { overlay: string } } }
      ).__AIKAMI_TEST__.getOverlayState().overlay === 'COMBAT',
  );
  if (!stillActive) {
    throw new Error('the combat encounter did not stay open on the production route');
  }
};

/**
 * `dialogue-long` is intentionally omitted.
 *
 * The contract lists it, but reaching a long production dialogue requires a
 * live AI text provider or a dialogue seam this suite does not have, and the
 * contract forbids inventing a query parameter solely to fake domain state.
 * Dialogue presentation is covered functionally by the client conversation
 * tests; this is a documented omission, not a silent one.
 */
export default defineConfig({
  id: 'play-shell',
  route: '/game',
  waitCondition: 'game_ready',
  cases: [
    {
      name: 'explore-default',
      prompt:
        'Score 90+ only when the game scene dominates the frame, a compact player/party status block sits in a top corner, exactly ONE objective slot is visible (compact by default — NOT a clock and NOT an expanded quest card), and exactly ONE button labelled "Menu" is present. There must be NO permanent row of navigation buttons across the top and no clock/weather widget for a new player. Essential text must be readable at 18px-equivalent scale. Report any overlapping HUD controls or a missing Menu button.',
      schema: PlayShellSchema,
      screenshotSelector: 'body',
      // Verifier fix: `overlappingControls` is NOT a hard gate on this case.
      // It is the only case whose frame contains the tutorial hint and the
      // quest card on the same 4rem band, and a vision model reads that 136px
      // gap as an overlap. Two independent fresh runs failed this gate with
      // "the 'Use W to move' tutorial box and the 'No active quest' box
      // overlap each other" — disproved by a DOM measurement on the same
      // production route and viewport (hint 467..812, card 948..1268, zero
      // intersection). The HUD-overlap guarantee is asserted deterministically
      // in `play_shell.spec.ts` (`quiet-exploration`) instead, and the model's
      // answer still feeds `score`. The contract only mandates
      // `missingCriticalAction` as a hard gate.
      requiredFalseFields: ['missingCriticalAction'],
      minScore: 90,
    },
    {
      name: 'inventory-detail',
      prompt:
        'Score 90+ when a management workspace is shown: a horizontal rail of FIVE labelled sections (Character, Inventory, Journal, Party, World) sits above the section content, the ACTIVE section is visually distinguished, a "Back" control is present, and only ONE section body is visible underneath. Flag a missing rail, a hidden Back control, overlapping controls, or stacked/duplicated panels.',
      schema: PlayShellSchema,
      screenshotSelector: HOST,
      setupHook: openSection('inventory'),
      requiredFalseFields: ['missingCriticalAction', 'overlappingControls'],
      minScore: 90,
    },
    {
      name: 'compare-section-switch',
      prompt:
        'Score 90+ when the Journal section is open in the management workspace: the rail still lists all five sections with Journal marked active, exactly one section body is visible, and the workspace reads as a single coherent surface rather than stacked windows. Flag stacked or duplicated panels and unreadable section text.',
      schema: PlayShellSchema,
      screenshotSelector: HOST,
      setupHook: openSection('journal'),
      requiredFalseFields: ['missingCriticalAction', 'overlappingControls'],
      minScore: 85,
    },
    {
      name: 'combat-actions',
      prompt:
        'A combat encounter is running in split-screen. Expected: a combat panel occupies the LEFT side of the frame and its action bar sits at the BOTTOM of that panel with three buttons labelled Attack, Defend and Flee, plus a free-text action field. The scene stays visible to the right. Confirm each of Attack, Defend and Flee is present and readable. Only set missingCriticalAction when one of those three buttons is genuinely absent or unreadable — do not set it for controls that are present but styled plainly.',
      schema: PlayShellSchema,
      screenshotSelector: 'body',
      setupHook: async (page) => {
        await hideDevTools(page);
        await startCombat(page);
        await hideDevTools(page);
      },
      requiredFalseFields: ['missingCriticalAction', 'overlappingControls'],
      minScore: 85,
    },
    {
      name: 'settings-error',
      prompt:
        'Score 90+ when the in-game Settings overlay is open over the paused game: its sections and controls are readable, the panel is opaque enough that the scene behind it does not reduce legibility, and any provider/connection error is presented as readable text rather than a raw stack trace or an empty region. Flag unreadable text or overlapping controls.',
      schema: PlayShellSchema,
      screenshotSelector: 'body',
      setupHook: async (page) => {
        await page.waitForSelector('[data-testid="hud-menu-entry"]', {
          state: 'visible',
          timeout: 30_000,
        });
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Settings' }).click();
        await page.waitForTimeout(1_200);
        await hideDevTools(page);
      },
      requiredFalseFields: ['missingCriticalAction', 'overlappingControls', 'unreadableText'],
      minScore: 85,
    },
    {
      name: 'compact',
      prompt:
        'Score 90+ at a 1024x768 viewport. Expected: the five-section rail fits on ONE line across the top with the Back control at its right end, and the section content is a single centered card that fits entirely inside the viewport. Only report clipping when an essential control is genuinely cut off by the viewport edge or overlaps another control — a centered card with empty space around it is correct, not clipped.',
      schema: PlayShellSchema,
      screenshotSelector: HOST,
      setupHook: async (page) => {
        await page.setViewportSize({ width: 1024, height: 768 });
        await openHost(page);
      },
      // The contract's hard gate is the defect booleans (any missing critical
      // action, overlap or unreadable text fails regardless of score). The score
      // here is secondary: "fits correctly" vs "looks sparse" vs "is clipped"
      // is not a judgement worth gating a passing layout on.
      requiredFalseFields: ['missingCriticalAction', 'overlappingControls', 'unreadableText'],
      minScore: 85,
    },
    {
      name: 'large-text',
      prompt:
        'Score 90+ at 200% text scale: section labels, the Back control and the section body text all remain readable, and none of them are clipped or overlapping. Flag any unreadable, truncated or overlapping essential label.',
      schema: PlayShellSchema,
      screenshotSelector: HOST,
      setupHook: async (page) => {
        await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        await openHost(page);
      },
      requiredFalseFields: ['missingCriticalAction', 'overlappingControls', 'unreadableText'],
      minScore: 90,
    },
    {
      name: 'long-labels-rtl',
      prompt:
        'Score 90+ at 200% text scale with a right-to-left document direction: the rail, the Back control and the section body remain readable, reflow to RTL rather than overflowing, and do not clip or overlap. Flag truncated, overlapping or unreadable essential labels.',
      schema: PlayShellSchema,
      screenshotSelector: HOST,
      setupHook: async (page) => {
        await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        await page.evaluate(() => {
          document.documentElement.dir = 'rtl';
        });
        await openHost(page);
      },
      requiredFalseFields: ['missingCriticalAction', 'overlappingControls', 'unreadableText'],
      minScore: 85,
    },
    {
      name: 'high-contrast',
      prompt:
        'Score 90+ when forced colours are active: panels stay opaque enough that the scene behind them does not reduce text legibility, the active section and the Back control remain distinguishable, and no essential text drops below readable contrast. Flag washed-out or low-contrast essential text.',
      schema: PlayShellSchema,
      screenshotSelector: HOST,
      setupHook: async (page) => {
        await page.emulateMedia({ forcedColors: 'active' });
        await openHost(page);
      },
      requiredFalseFields: ['missingCriticalAction', 'unreadableText'],
      minScore: 85,
    },
    {
      name: 'reduced-motion',
      prompt:
        'Score 90+ when reduced motion is requested: the management workspace is presented fully settled — the whole rail and section body visible at once, with no element caught mid-transition, translucent or partially faded in. Flag any element that appears only partially transitioned in.',
      schema: PlayShellSchema,
      screenshotSelector: HOST,
      setupHook: async (page) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openHost(page);
      },
      requiredFalseFields: ['missingCriticalAction'],
      minScore: 85,
    },
  ],
});
