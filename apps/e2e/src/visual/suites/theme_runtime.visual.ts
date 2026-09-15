// apps/e2e/src/visual/suites/theme_runtime.visual.ts
//
// C-529 — visual cases for the appearance surface, the creator editor and the
// game scope.
//
// Cases run on the PRODUCTION routes (`/settings?section=interface` and `/game`)
// and reach every state through the real settings registry, the real editor and
// real localStorage. Nothing here uses a bypass query parameter.
//
// 🔴 Every case sets `screenshotSelector`. Without it the runner falls back to a
// 256×256 crop centred on the canvas, which contains none of the appearance
// chrome — the suite would then be scoring pixels the contract never mentions.
//
// Contract: C-529 AC-2, AC-5, AC-6, AC-8.

import type { Page } from 'playwright';
import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';
import { EMULATOR_PORTS } from '../../config';

/** Absolute client origin — the visual runner sets no Playwright `baseURL`. */
const CLIENT_ORIGIN = `http://localhost:${EMULATOR_PORTS.client}`;

/**
 * Response schema mandated by the contract's Test Hooks.
 *
 * The three defect flags are gated with `requiredFalseFields`: the contract says
 * any missing critical action is a failure regardless of score, and an
 * appearance surface that overlaps its own controls or renders unreadable labels
 * is not a passing result either.
 */
const ThemeRuntimeSchema = Type.Object({
  score: Type.Number({ minimum: 0, maximum: 100, description: '0-100 visual quality score' }),
  unreadableText: Type.Boolean({
    description: 'Any essential text is unreadable at the shown scale',
  }),
  overlappingControls: Type.Boolean({ description: 'Essential controls overlap each other' }),
  missingCriticalAction: Type.Boolean({
    description:
      'A required control (mode selector, theme picker, Apply/Cancel, Restore default appearance) is missing or unreachable',
  }),
  missingRecoveryNotice: Type.Boolean({
    description: 'The corrupt-appearance recovery explanation is missing',
  }),
  previewNotScoped: Type.Boolean({
    description: 'The editor preview does not show four distinct game contexts',
  }),
  issues: Type.Array(Type.String(), { description: 'Concrete defects found' }),
});

/** Removes the non-production DevTools panel from the visual tree. */
const hideDevTools = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const toggle = document.querySelector('button[title="Collapse Dev Tools"]');
    const panel = toggle?.parentElement;
    if (panel) {
      panel.style.display = 'none';
    }
  });
};

/** Opens the Interface settings section (which owns the Appearance sub-view). */
const openInterfaceSettings = async (page: Page): Promise<void> => {
  await page.goto(`${CLIENT_ORIGIN}/settings?section=interface`);
  await page.waitForSelector('[data-testid="settings-appearance"]', {
    state: 'visible',
    timeout: 30_000,
  });
  await hideDevTools(page);
};

/** Opens the creator editor and waits for the four-context preview. */
const openThemeEditor = async (page: Page): Promise<void> => {
  await openInterfaceSettings(page);
  await page.getByTestId('appearance-open-editor').click();
  await page.waitForSelector('[data-testid="theme-editor-preview"]', {
    state: 'visible',
    timeout: 15_000,
  });
  await hideDevTools(page);
};

/** Waits for the play shell HUD to be live. */
const waitForHud = async (page: Page): Promise<void> => {
  await page.waitForSelector('[data-testid="hud-anchor-top-end"]', {
    state: 'attached',
    timeout: 30_000,
  });
};

/**
 * `dialogue-long` is intentionally omitted.
 *
 * The contract lists it, but reaching a long production dialogue requires a live
 * AI text provider or a dialogue seam this suite does not have, and the contract
 * forbids inventing a query parameter solely to fake domain state. Dialogue
 * presentation is covered functionally by the client conversation tests and the
 * editor's own `dialogue` preview context (below). This is a documented
 * omission, not a silent one.
 */
export default defineConfig({
  id: 'theme-runtime',
  // The runner's wait conditions are game/hub oriented, so the suite boots on
  // `/game` and every case navigates to the surface it is scoring in its own
  // setup hook. Same shape as `hud_customization.visual.ts`.
  route: '/game',
  waitCondition: 'game_ready',
  cases: [
    {
      name: 'explore-default',
      prompt:
        'This is the production Appearance sub-view of Settings > Play > Interface. Expected: a card titled "Appearance" whose mode group offers Light and Dark choices with the current one visibly selected, whose theme group lists the installed theme as the selected option, and which contains a reachable "Restore default appearance" control. Text must be readable and no control may overlap another. Score 90+ when the mode choices, the selected theme and the restore control are all present and readable; only set missingCriticalAction when the restore control or the mode choices are genuinely absent or unreadable.',
      schema: ThemeRuntimeSchema,
      screenshotSelector: '[data-testid="settings-appearance"]',
      setupHook: async (page) => {
        await openInterfaceSettings(page);
      },
      requiredFalseFields: ['missingCriticalAction', 'overlappingControls', 'unreadableText'],
      minScore: 85,
    },
    {
      name: 'theme-editor-preview',
      prompt:
        'The creator theme editor is open, showing the four-context preview grid. Expected: four distinctly labelled panels (Explore, Dialogue, Inventory, Combat), each with a heading, body copy, a status badge in a status colour, a progress bar in the accent colour, a list row separated by a border, and a row of small action buttons. All four panels must be readable against their own surface, and the preview must be visibly INSIDE a bordered region — not repainting the surrounding settings chrome. Set previewNotScoped when fewer than four contexts are distinguishable.',
      schema: ThemeRuntimeSchema,
      screenshotSelector: '[data-testid="theme-editor-preview"]',
      setupHook: async (page) => {
        await openThemeEditor(page);
        await page.waitForTimeout(400);
      },
      requiredFalseFields: [
        'missingCriticalAction',
        'overlappingControls',
        'unreadableText',
        'previewNotScoped',
      ],
      minScore: 85,
    },
    {
      name: 'inventory-detail',
      prompt:
        'This is the INVENTORY context panel of the theme editor preview — an inert preview, not a live inventory screen. Expected: a small "INVENTORY" label in the top-left, a status badge in the top-right, a prominent heading naming the pack, readable body copy, a labelled progress bar in an accent colour, a bordered list row, and a row of three small outlined action buttons below a separator. Score 90+ when the heading is clearly more prominent than the body copy, the status badge is visibly a distinct coloured pill, the progress bar is a visibly filled accent-coloured bar, and the three action buttons are readable and do not overlap the progress row.',
      schema: ThemeRuntimeSchema,
      // 🔴 Per-context selector: the preview ROOT crop is byte-identical to
      // `theme-editor-preview`'s, so this case previously carried no distinct
      // Inventory evidence of its own. A narrow panel crop is viable now that
      // the capture retry actually scrolls the panel into view — the earlier
      // "too low-signal" judgement was made against a broken capture that had
      // silently fallen back to a full-page screenshot.
      screenshotSelector: '[data-testid="theme-preview-inventory"]',
      setupHook: async (page) => {
        await openThemeEditor(page);
        await page.waitForTimeout(300);
      },
      requiredFalseFields: ['missingCriticalAction', 'overlappingControls', 'unreadableText'],
      minScore: 85,
    },
    {
      name: 'combat-actions',
      prompt:
        'This is the COMBAT context panel of the theme editor preview — an inert preview, not a live fight. Expected: a small "COMBAT" label in the top-left, a status badge in the top-right, a prominent heading naming the enemy, readable body copy, a labelled progress bar in an accent colour, a bordered list row, and a row of three small outlined action buttons below a separator. Score 90+ when the heading is clearly more prominent than the body copy, the status badge is visibly a distinct coloured pill, the progress bar is a visibly filled accent-coloured bar, and the three action buttons are readable and do not overlap the progress row.',
      schema: ThemeRuntimeSchema,
      screenshotSelector: '[data-testid="theme-preview-combat"]',
      setupHook: async (page) => {
        await openThemeEditor(page);
        await page.waitForTimeout(300);
      },
      requiredFalseFields: ['missingCriticalAction', 'overlappingControls', 'unreadableText'],
      minScore: 85,
    },
    {
      name: 'settings-error',
      prompt:
        'This is the AC-6 recovery state: the stored appearance selection was corrupt. Require BOTH a readable warning explaining that the appearance setting could not be read and a reachable "Restore default appearance" action inside the warning, plus the normal mode and theme groups below it. Set missingRecoveryNotice or missingCriticalAction when either required element is absent.',
      schema: ThemeRuntimeSchema,
      screenshotSelector: '[data-testid="settings-appearance"]',
      setupHook: async (page) => {
        await page.goto(`${CLIENT_ORIGIN}/settings?section=interface`);
        await page.evaluate(() => {
          localStorage.setItem('aikami:theme:selection', '{ not json');
        });
        await page.reload();
        await page.waitForSelector('[data-testid="appearance-recovery-notice"]', {
          state: 'visible',
          timeout: 30_000,
        });
        await hideDevTools(page);
      },
      requiredFalseFields: [
        'missingCriticalAction',
        'missingRecoveryNotice',
        'overlappingControls',
        'unreadableText',
      ],
      minScore: 85,
    },
    {
      name: 'compact',
      prompt:
        'Score 90+ at a 1024x768 viewport with the theme editor open. Expected: the four preview panels stack into a single column, the role editor and the advanced JSON editor remain reachable by scrolling, and no control is clipped by the viewport edge or overlaps another control.',
      schema: ThemeRuntimeSchema,
      screenshotSelector: '[data-testid="theme-editor"]',
      setupHook: async (page) => {
        await page.setViewportSize({ width: 1024, height: 768 });
        await openThemeEditor(page);
      },
      requiredFalseFields: ['missingCriticalAction', 'overlappingControls', 'unreadableText'],
      minScore: 85,
    },
    {
      name: 'large-text',
      prompt:
        'Score 90+ with 200% root text size on the Appearance surface. Expected: every label, control and value is still readable at the enlarged scale, controls wrap rather than overlap or clip, and the mode and theme groups remain fully usable. Flag any text that overflows its control or any control pushed off-screen.',
      schema: ThemeRuntimeSchema,
      screenshotSelector: '[data-testid="settings-appearance"]',
      // 🔴 The appearance card is ~1116px tall once root text is doubled, so the
      // default 1280×720 viewport clip silently truncates it — Playwright does
      // not throw for a partially-fitting clip, it just crops. That hid the theme
      // picker from the evaluator. Crop the scrollable page instead.
      fullPageClip: true,
      setupHook: async (page) => {
        // Cases share one browser context, so `settings-error`'s corrupt
        // selection is still in localStorage here. Drop it before the app boots
        // so this case scores the appearance surface itself, not the recovery
        // state.
        await page.addInitScript(() => {
          localStorage.removeItem('aikami:theme:selection');
        });
        await openInterfaceSettings(page);
        // 🔴 200% root text must be applied AFTER navigation. `addInitScript`
        // runs before the app boots and its inline root style is discarded, so
        // the 200% state never applied (measured 16px) and this case rendered
        // byte-identical to `settings-error`.
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '200%';
        });
        await page.waitForTimeout(400);
      },
      requiredFalseFields: ['missingCriticalAction', 'overlappingControls', 'unreadableText'],
      minScore: 85,
    },
    {
      name: 'high-contrast',
      prompt:
        'The accessibility appearance override "High contrast text and focus" is ENABLED. Expected: body and muted text are near-black on a near-white (or near-white on near-black) surface with very strong contrast, the focus ring colour is high contrast, the toggle is visibly on, and a line listing the changed tokens is present. Nothing may be unreadable. This is the accessibility policy winning over the theme.',
      schema: ThemeRuntimeSchema,
      screenshotSelector: '[data-testid="settings-appearance"]',
      // 🔴 The accessibility override lives at the BOTTOM of the appearance card
      // (the toggle sits at y≈770 in a 720px viewport, and the "tokens changed"
      // line is below it). A viewport clip therefore never contained this case's
      // subject — its previous high score was awarded to a crop that did not show
      // the toggle at all. Crop the scrollable page so the evidence actually
      // shows the override that is being asserted.
      fullPageClip: true,
      setupHook: async (page) => {
        await openInterfaceSettings(page);
        await page.getByTestId('appearance-high-contrast').check();
        await page.waitForTimeout(300);
      },
      requiredFalseFields: ['missingCriticalAction', 'overlappingControls', 'unreadableText'],
      minScore: 85,
    },
    {
      name: 'reduced-motion',
      prompt:
        'The OS prefers reduced motion and the player selected the Dark appearance mode. Expected: the Appearance card shows Dark as the selected mode, the surfaces are dark with readable light text, and no animation or transition is in progress (the frame is static and fully painted). Flag unreadable text or overlapping controls.',
      schema: ThemeRuntimeSchema,
      screenshotSelector: '[data-testid="settings-appearance"]',
      setupHook: async (page) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openInterfaceSettings(page);
        await page.getByTestId('appearance-mode-dark').click();
        await page.waitForTimeout(300);
      },
      requiredFalseFields: ['missingCriticalAction', 'overlappingControls', 'unreadableText'],
      minScore: 85,
    },
    {
      name: 'game-scope',
      prompt:
        'This is the production play shell with the Dark appearance mode selected. Expected: the game scene dominates the frame, the HUD chrome (a Menu button in the top-right region and a player status block) is present and readable, and the dark appearance applies to the game shell only — the chrome is not washed out or inverted oddly. Flag a missing Menu button or unreadable HUD text.',
      schema: ThemeRuntimeSchema,
      screenshotSelector: 'body',
      setupHook: async (page) => {
        await page.goto(`${CLIENT_ORIGIN}/settings?section=interface`);
        await page.getByTestId('appearance-mode-dark').click();
        await page.goto(`${CLIENT_ORIGIN}/game`);
        await waitForHud(page);
        await hideDevTools(page);
        await page.waitForTimeout(400);
      },
      requiredFalseFields: ['missingCriticalAction', 'overlappingControls', 'unreadableText'],
      minScore: 85,
    },
  ],
});
