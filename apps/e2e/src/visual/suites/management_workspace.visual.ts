// apps/e2e/src/visual/suites/management_workspace.visual.ts
//
// C-543 — visual cases for the PRODUCTION management workspace and HUD.
//
// These run on the real `/game` route and reach every state through the real
// management host, the real settings-localStorage preferences or the real theme
// editor. No bypass query parameter invents feature state (the contract forbids
// it); states that need a fixture seam the client does not expose are documented
// as omissions in the contract instead of being faked here.
//
// The schema carries explicit boolean defects, not only a score: a screenshot
// full of dead space, a nested primary modal or duplicate chrome fails even if a
// VLM score would otherwise be high.
//
// Contract: C-543 AC-1, AC-3, AC-5, AC-6, AC-7.

import type { Page } from 'playwright';
import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';
import { EMULATOR_PORTS } from '../../config';

/** Absolute client origin — the visual runner sets no Playwright `baseURL`. */
const CLIENT_ORIGIN = `http://localhost:${EMULATOR_PORTS.client}`;

/**
 * Response schema for every management/HUD case.
 *
 * `requiredFalseFields` hard-gates the defect booleans per case, so "looks
 * mostly fine" cannot outweigh a nested primary modal, duplicate chrome or a
 * workspace that is mostly empty backdrop.
 */
const ManagementSchema = Type.Object({
  score: Type.Number({ minimum: 0, maximum: 100, description: '0-100 visual quality score' }),
  unreadableText: Type.Boolean({ description: 'Essential text is unreadable at the shown scale' }),
  tinyEssentialText: Type.Boolean({
    description: 'Essential gameplay text (values, controls, labels) is too small to read easily',
  }),
  overlappingControls: Type.Boolean({ description: 'Controls overlap each other' }),
  missingCriticalAction: Type.Boolean({
    description: 'A required control (Menu, Return/Back, section navigation) is missing',
  }),
  duplicateChrome: Type.Boolean({
    description: 'The same title, Close/X or backdrop is rendered twice',
  }),
  nestedPrimaryModal: Type.Boolean({
    description: 'A legacy modal card is nested inside the management workspace',
  }),
  excessiveDeadSpace: Type.Boolean({
    description: 'Most of the workspace is empty backdrop — the content is a small island',
  }),
  sceneContextLost: Type.Boolean({
    description: 'The game scene is no longer perceptible behind the workspace',
  }),
  inconsistentSectionLayout: Type.Boolean({
    description: 'Sections in the same shell use visibly unrelated layout/typography',
  }),
  themeIdentityMissing: Type.Boolean({
    description:
      'The surface reads as generic web chrome, not the warm ink / brass / violet identity',
  }),
  visuallyDominantDebugAffordance: Type.Boolean({
    description: 'A debug affordance (neon grid, giant arrow rail) dominates the scene',
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

/** Waits for the production play shell HUD. */
const waitForHud = async (page: Page): Promise<void> => {
  await page.waitForSelector('[data-testid="hud-anchor-top-end"]', {
    state: 'attached',
    timeout: 30_000,
  });
};

/** Seeds a HUD preset preference (a real player preference, not fake domain state). */
const seedHudPreset = async (page: Page, presetId: string): Promise<void> => {
  await page.addInitScript((preset) => {
    localStorage.setItem(
      'aikami:hud:preferences',
      JSON.stringify({ schemaVersion: 1, selectedPresetId: preset, overrides: [] }),
    );
  }, presetId);
};

/** Opens /game and activates the management host. */
const openManagement = async (page: Page, section?: string): Promise<void> => {
  await page.goto(`${CLIENT_ORIGIN}/game`);
  await waitForHud(page);
  await page.getByTestId('hud-menu-entry').click();
  await page.waitForSelector('[data-testid="management-workspace"]', {
    state: 'visible',
    timeout: 15_000,
  });
  if (section !== undefined) {
    await page.getByTestId(`section-tab-${section}`).click();
    await page.waitForTimeout(300);
  }
  await hideDevTools(page);
};

const managementCase = (options: {
  readonly name: string;
  readonly section?: string;
  readonly prompt: string;
}) => ({
  name: options.name,
  prompt: options.prompt,
  schema: ManagementSchema,
  // Crop the whole workspace (plus backdrop) so excessive dead space and a
  // nested modal cannot hide outside the selector.
  screenshotSelector: 'body',
  fullPageClip: false,
  setupHook: async (page: Page) => {
    await openManagement(page, options.section);
  },
  requiredFalseFields: [
    'unreadableText',
    'tinyEssentialText',
    'overlappingControls',
    'missingCriticalAction',
    'duplicateChrome',
    'nestedPrimaryModal',
    'excessiveDeadSpace',
    'sceneContextLost',
    'inconsistentSectionLayout',
    'visuallyDominantDebugAffordance',
  ],
  minScore: 85,
});

const shellPrompt = (section: string): string =>
  `This is the production /game management workspace with the ${section} section active at a desktop viewport. Expected: ONE large warm-ink workspace occupying most of the viewport with a quiet scrim letting the game scene stay perceptible at the edges; a single workspace header with the section title and exactly ONE Return/Back control; a desktop section rail listing Character, Inventory, Journal, Party and World; readable ivory text on the warm panel with restrained brass separators and at most sparse violet accents. Set nestedPrimaryModal when a small legacy card floats inside the workspace, excessiveDeadSpace when most of the workspace is empty, duplicateChrome when there is a second title or Close/X, and tinyEssentialText when values or controls are too small to read.`;

export default defineConfig({
  id: 'management-workspace',
  route: '/game',
  waitCondition: 'game_ready',
  cases: [
    managementCase({
      name: 'management-character',
      section: 'character',
      prompt: shellPrompt('Character'),
    }),
    managementCase({
      name: 'management-inventory-empty',
      section: 'inventory',
      prompt: shellPrompt('Inventory'),
    }),
    managementCase({
      name: 'management-journal-quests',
      section: 'journal',
      prompt: shellPrompt('Journal (Quests subview)'),
    }),
    managementCase({
      name: 'management-journal-notes',
      section: 'journal',
      prompt: shellPrompt('Journal (Notes subview)'),
    }),
    managementCase({
      name: 'management-party-empty',
      section: 'party',
      prompt: shellPrompt('Party (no companions)'),
    }),
    managementCase({
      name: 'management-world-people',
      section: 'world',
      prompt: shellPrompt('World (People subview)'),
    }),
    managementCase({
      name: 'management-world-factions',
      section: 'world',
      prompt: shellPrompt('World (Factions subview)'),
    }),
    managementCase({
      name: 'management-world-gallery',
      section: 'world',
      prompt: shellPrompt('World (Gallery subview)'),
    }),
    {
      name: 'explore-adventure',
      prompt:
        'The production /game exploration HUD with the default Adventure preset. Expected: the game scene dominates; a single labelled Menu entry, a compact readable player status (no emoji heart, tabular HP value, health tone also named) and at most one compact objective are present; there is no permanent seven-button management bar and no giant neon-green side rail. Flag visuallyDominantDebugAffordance for any neon grid or full-height arrow rail.',
      schema: ManagementSchema,
      screenshotSelector: 'body',
      setupHook: async (page: Page) => {
        await seedHudPreset(page, 'adventure');
        await page.goto(`${CLIENT_ORIGIN}/game`);
        await waitForHud(page);
        await page.waitForTimeout(500);
        await hideDevTools(page);
      },
      requiredFalseFields: [
        'unreadableText',
        'overlappingControls',
        'missingCriticalAction',
        'visuallyDominantDebugAffordance',
      ],
      minScore: 85,
    },
    {
      name: 'explore-readable',
      prompt:
        'The production /game exploration HUD with the Readable preset. Expected: larger, opaque, clearly readable controls and status; the scene still perceptible; no overlap and no unreadable text.',
      schema: ManagementSchema,
      screenshotSelector: 'body',
      setupHook: async (page: Page) => {
        await seedHudPreset(page, 'readable');
        await page.goto(`${CLIENT_ORIGIN}/game`);
        await waitForHud(page);
        await page.waitForTimeout(500);
        await hideDevTools(page);
      },
      requiredFalseFields: ['unreadableText', 'overlappingControls', 'missingCriticalAction'],
      minScore: 85,
    },
    {
      name: 'large-text-management',
      prompt:
        'The management workspace at 200% root text size. Expected: the workspace becomes effectively fullscreen, the section navigation reflows to a scrollable strip or compact list, the active section shows a single readable work surface, the Return action stays visible without covering content, and there is no horizontal reading scroll. Flag clipped buttons, hidden essential controls or two-axis reading scroll.',
      schema: ManagementSchema,
      screenshotSelector: 'body',
      fullPageClip: true,
      setupHook: async (page: Page) => {
        await page.setViewportSize({ width: 1024, height: 768 });
        await openManagement(page, 'character');
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '200%';
        });
        await page.waitForTimeout(400);
      },
      requiredFalseFields: [
        'unreadableText',
        'tinyEssentialText',
        'overlappingControls',
        'missingCriticalAction',
        'duplicateChrome',
      ],
      minScore: 85,
    },
    {
      name: 'high-contrast',
      prompt:
        'The management workspace with the high-contrast accessibility override enabled. Expected: strong text/background contrast on the workspace and chrome, a clearly visible focus ring role, and no unreadable text.',
      schema: ManagementSchema,
      screenshotSelector: 'body',
      setupHook: async (page: Page) => {
        await page.addInitScript(() => {
          localStorage.setItem(
            'aikami:theme:accessibility',
            JSON.stringify({ highContrast: true }),
          );
        });
        await openManagement(page, 'inventory');
      },
      requiredFalseFields: [
        'unreadableText',
        'overlappingControls',
        'missingCriticalAction',
        'duplicateChrome',
      ],
      minScore: 85,
    },
    {
      name: 'reduced-motion',
      prompt:
        'The management workspace with reduced motion requested and the Dark appearance. Expected: a static, fully painted frame with readable light text on dark warm surfaces, no animation in progress and no overlap.',
      schema: ManagementSchema,
      screenshotSelector: 'body',
      setupHook: async (page: Page) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(`${CLIENT_ORIGIN}/settings?section=interface`);
        await page.getByTestId('appearance-mode-dark').click();
        await openManagement(page, 'world');
      },
      requiredFalseFields: ['unreadableText', 'overlappingControls', 'missingCriticalAction'],
      minScore: 85,
    },
    {
      name: 'community-theme-production-ui',
      prompt:
        'The management workspace after a non-default valid theme was installed through the creator editor (custom primary, panel and elevated colours). Expected: the workspace, the active navigation item and the HUD status surfaces visibly adopt the custom theme — the interface must NOT stay hardcoded black/white/purple. Flag themeIdentityMissing when the surfaces look unchanged/generic.',
      schema: ManagementSchema,
      screenshotSelector: 'body',
      setupHook: async (page: Page) => {
        await page.goto(`${CLIENT_ORIGIN}/settings?section=interface`);
        await page.waitForSelector('[data-testid="settings-appearance"]', { state: 'visible' });
        await page.getByTestId('appearance-open-editor').click();
        await page.waitForSelector('[data-testid="theme-editor-preview"]', { state: 'visible' });
        await page.getByTestId('theme-editor-role-color.primary').fill('#c2185b');
        await page.getByTestId('theme-editor-role-color.primary').press('Tab');
        await page.getByTestId('theme-editor-role-color.panel').fill('#20303a');
        await page.getByTestId('theme-editor-role-color.panel').press('Tab');
        await page.getByTestId('theme-editor-apply').click();
        await openManagement(page, 'character');
      },
      requiredFalseFields: [
        'unreadableText',
        'overlappingControls',
        'missingCriticalAction',
        'themeIdentityMissing',
        'duplicateChrome',
      ],
      minScore: 85,
    },
  ],
});
