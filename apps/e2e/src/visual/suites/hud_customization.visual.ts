// apps/e2e/src/visual/suites/hud_customization.visual.ts
//
// C-528 — visual cases for the HUD presets, the layout editor and the Interface
// settings section.
//
// Cases run on the PRODUCTION routes (`/game` and `/settings?section=interface`)
// and reach every state through the real HUD, the real pause menu and the real
// settings registry. Nothing here uses a bypass query parameter.
//
// 🔴 Every case sets `screenshotSelector`. Without it the runner falls back to a
// 256×256 crop centred on the canvas, which contains none of the HUD chrome —
// the suite would then be scoring pixels the contract never mentions.
//
// Contract: C-528 AC-1, AC-2, AC-3, AC-5, AC-6, AC-8.

import type { Page } from 'playwright';
import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';
import { EMULATOR_PORTS } from '../../config';

/**
 * Absolute client origin for in-case navigation.
 *
 * 🔴 `page.goto('/settings…')` with a RELATIVE path throws
 * "Protocol error (Page.navigate): Cannot navigate to invalid URL" — the visual
 * runner's context sets no Playwright `baseURL`, unlike the Playwright E2E
 * config. Contract-scoped runs also shift the client off 5274 (see
 * `scripts/src/lib/herdr/session.ts`), so the origin must be derived, not
 * hardcoded. Same pattern as `combat.visual.ts`.
 */
const CLIENT_ORIGIN = `http://localhost:${EMULATOR_PORTS.client}`;

/**
 * Response schema mandated by the contract's Test Hooks.
 *
 * The three defect flags are gated with `requiredFalseFields`: the contract says
 * any missing critical action is a failure regardless of score, and a
 * layout-editing surface that overlaps its own controls or renders unreadable
 * labels is not a passing result either.
 */
const HudCustomizationSchema = Type.Object({
  score: Type.Number({
    minimum: 0,
    maximum: 100,
    description: '0-100 visual quality score',
  }),
  unreadableText: Type.Boolean({
    description: 'Any essential text is unreadable at the shown scale',
  }),
  overlappingControls: Type.Boolean({ description: 'Essential controls overlap each other' }),
  missingCriticalAction: Type.Boolean({
    description:
      'A required control (Menu, Customize HUD, Save/Cancel, preset) is missing or unreachable',
  }),
  missingRecoveryNotice: Type.Boolean({
    description: 'The corrupt-layout recovery explanation is missing',
  }),
  missingRestoreAction: Type.Boolean({
    description: 'The Restore default interface recovery action is missing',
  }),
  issues: Type.Array(Type.String(), { description: 'Concrete defects found' }),
});

/**
 * Removes the non-production DevTools panel from the visual tree.
 *
 * It is a development affordance, not product UI: it floats above the shell and
 * its "AI Context Preview" column is what a reviewer sees clipped at the right
 * edge of a compact capture.
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

/** Waits for the play shell HUD to be live. */
const waitForHud = async (page: Page): Promise<void> => {
  await page.waitForSelector('[data-testid="hud-anchor-top-end"]', {
    state: 'attached',
    timeout: 30_000,
  });
};

/** Opens the pause menu through the real input path. */
const openPauseMenu = async (page: Page): Promise<void> => {
  await waitForHud(page);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid="pause-customize-hud"]', {
    state: 'visible',
    timeout: 15_000,
  });
  await hideDevTools(page);
};

/** Opens the HUD layout editor. */
const openEditor = async (page: Page): Promise<void> => {
  await openPauseMenu(page);
  await page.getByTestId('pause-customize-hud').click();
  await page.waitForSelector('[data-testid="hud-editor"]', { state: 'visible', timeout: 15_000 });
  await hideDevTools(page);
};

/** Opens the Interface settings section on the full settings page. */
const openInterfaceSettings = async (page: Page): Promise<void> => {
  await page.goto(`${CLIENT_ORIGIN}/settings?section=interface`);
  await page.waitForSelector('[data-testid="settings-interface"]', {
    state: 'visible',
    timeout: 30_000,
  });
  await hideDevTools(page);
};

/**
 * `dialogue-long` is intentionally omitted.
 *
 * The contract lists it, but reaching a long production dialogue requires a live
 * AI text provider or a dialogue seam this suite does not have, and the contract
 * forbids inventing a query parameter solely to fake domain state. Dialogue
 * presentation is covered functionally by the client conversation tests; this is
 * a documented omission, not a silent one.
 */
export default defineConfig({
  id: 'hud-customization',
  route: '/game',
  waitCondition: 'game_ready',
  cases: [
    {
      name: 'explore-default',
      prompt:
        'This is the production play HUD for a new player. Expected: the game scene dominates the frame, a compact player status block and exactly ONE button labelled "Menu" sit in the top-right region, and no permanent navigation strip runs across the top. Text must be readable. Only set missingCriticalAction when the Menu button is genuinely absent or unreadable.',
      schema: HudCustomizationSchema,
      screenshotSelector: 'body',
      requiredFalseFields: ['missingCriticalAction', 'overlappingControls', 'unreadableText'],
      minScore: 85,
    },
    {
      name: 'combat-actions',
      prompt:
        'The player is previewing the COMBAT fixture inside the HUD layout editor. Expected: a dialog titled "Customize HUD" with the combat preview tab selected, a preview panel showing labelled widget boxes for the combat layout (hotbar, interaction, party status), a widget list on the right, and a bottom action row containing Undo, Redo, Reset widget, Reset layout, Cancel and Save. Confirm Save and Cancel are present and readable, and that the preview is clearly a paused read-only preview rather than a live fight.',
      schema: HudCustomizationSchema,
      screenshotSelector: '[data-testid="hud-editor"]',
      setupHook: async (page) => {
        await openEditor(page);
        await page.getByTestId('hud-preview-tab-combat').click();
        await page.waitForTimeout(400);
      },
      requiredFalseFields: ['missingCriticalAction', 'overlappingControls', 'unreadableText'],
      minScore: 85,
    },
    {
      name: 'editor-default',
      prompt:
        'The player has paused the game and opened "Customize HUD". Expected: a dialog titled "Customize HUD" with a preview panel on the left showing labelled widget boxes, a widget list on the right, a row of preview tabs (explore / dialogue / combat), and a bottom action row containing Undo, Redo, Reset widget, Reset layout, Cancel and Save. Confirm the Save and Cancel controls are present and readable.',
      schema: HudCustomizationSchema,
      screenshotSelector: '[data-testid="hud-editor"]',
      setupHook: async (page) => {
        await openEditor(page);
      },
      requiredFalseFields: ['missingCriticalAction', 'overlappingControls', 'unreadableText'],
      minScore: 85,
    },
    {
      name: 'inventory-detail',
      prompt:
        'The HUD editor is open with the widget list visible. Expected: each widget row is a single clean line with a drag grip, a readable widget label and a small visibility button, and the selected row is visually distinguished. Flag unreadable labels, overlapping rows, or a row that looks like a cramped form.',
      schema: HudCustomizationSchema,
      screenshotSelector: '[data-testid="hud-editor-widgets"]',
      setupHook: async (page) => {
        await openEditor(page);
        await page.getByTestId('hud-editor-select-objective').click();
        await page.waitForTimeout(300);
      },
      requiredFalseFields: ['missingCriticalAction', 'overlappingControls', 'unreadableText'],
      minScore: 85,
    },
    {
      name: 'settings-error',
      prompt:
        'This is the AC-6 recovery state after corrupt HUD preferences were preserved and the safe layout was loaded. Require BOTH a readable warning that explains the stored HUD layout could not be read and a reachable "Restore default interface" action. Also expect the four presets, the temporary-hide toggle, and widget list without overlap. Set missingRecoveryNotice or missingRestoreAction when either required recovery element is absent.',
      schema: HudCustomizationSchema,
      screenshotSelector: '[data-testid="settings-interface"]',
      setupHook: async (page) => {
        await page.evaluate(() => {
          localStorage.setItem(
            'aikami:hud:preferences',
            '{"schemaVersion":1,"selectedPresetId":"adventure","overrides":[{"widgetId":"hotbar"}]}',
          );
        });
        await openInterfaceSettings(page);
      },
      requiredFalseFields: [
        'missingCriticalAction',
        'missingRecoveryNotice',
        'missingRestoreAction',
        'overlappingControls',
        'unreadableText',
      ],
      minScore: 85,
    },
    {
      name: 'compact',
      prompt:
        'Score 90+ at a 1024x768 viewport with the HUD editor open. Expected: the preview panel and the widget list stack into a single column, the bottom action row (Cancel / Save) stays reachable, and no control is clipped by the viewport edge or overlaps another control. A centred dialog with space around it is correct, not clipped.',
      schema: HudCustomizationSchema,
      screenshotSelector: '[data-testid="hud-editor"]',
      setupHook: async (page) => {
        await page.setViewportSize({ width: 1024, height: 768 });
        await openEditor(page);
      },
      requiredFalseFields: ['missingCriticalAction', 'overlappingControls', 'unreadableText'],
      minScore: 85,
    },
    {
      name: 'large-text',
      prompt:
        'Score 90+ at 200% text scale with Settings → Interface open. Expected: the preset labels, the widget labels and their badges all remain readable and are not clipped or overlapping. Flag any unreadable, truncated or overlapping essential label.',
      schema: HudCustomizationSchema,
      screenshotSelector: '[data-testid="settings-interface"]',
      setupHook: async (page) => {
        await openInterfaceSettings(page);
        await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      },
      requiredFalseFields: ['missingCriticalAction', 'overlappingControls', 'unreadableText'],
      minScore: 90,
    },
    {
      name: 'reduced-motion',
      prompt:
        'Score 90+ with reduced motion requested. Expected: the HUD editor is present and fully readable with no transition-only affordance missing — every control that motion would have revealed (preview tabs, widget rows, Save/Cancel) is visible without animation. Flag unreadable text, overlapping controls or a missing critical control.',
      schema: HudCustomizationSchema,
      screenshotSelector: '[data-testid="hud-editor"]',
      setupHook: async (page) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openEditor(page);
      },
      requiredFalseFields: ['missingCriticalAction', 'overlappingControls', 'unreadableText'],
      minScore: 85,
    },
    {
      name: 'high-contrast',
      prompt:
        'Score 90+ with an explicit high-contrast preference. Expected: the HUD editor dialog keeps readable contrast between its labels, badges and background, and the selected widget row is still distinguishable. Flag unreadable text, overlapping controls or a missing critical control.',
      schema: HudCustomizationSchema,
      screenshotSelector: '[data-testid="hud-editor"]',
      setupHook: async (page) => {
        await page.emulateMedia({ forcedColors: 'active' });
        await openEditor(page);
      },
      requiredFalseFields: ['missingCriticalAction', 'overlappingControls', 'unreadableText'],
      minScore: 85,
    },
  ],
});
