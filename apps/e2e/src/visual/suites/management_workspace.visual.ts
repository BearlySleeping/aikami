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
    description:
      'A SECOND title, Close/X or backdrop is rendered for the SAME surface (e.g. a feature view repeating the workspace title or adding its own Close inside the workspace). The workspace showing the active section name in its header while the navigation highlights the same section is EXPECTED and is NOT duplicate chrome.',
  }),
  nestedPrimaryModal: Type.Boolean({
    description: 'A legacy modal card is nested inside the management workspace',
  }),
  excessiveDeadSpace: Type.Boolean({
    description:
      'Set true ONLY when the primary content occupies less than about a third of the workspace and there is no composed, centred empty state. A top-aligned form or list in a large workspace is NOT excessive dead space.',
  }),
  sceneContextLost: Type.Boolean({
    description: 'The game scene is no longer perceptible behind the workspace',
  }),
  inconsistentSectionLayout: Type.Boolean({
    description: 'Sections in the same shell use visibly unrelated layout/typography',
  }),
  themeIdentityMissing: Type.Boolean({
    description:
      'The management/HUD surfaces are NEUTRAL grey/blue web chrome: no warm brown/parchment workspace tone, no brass/gold separators, no serif section heading and no violet active accent. Set true ONLY when ALL of those identity cues are absent.',
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

/**
 * Selects the dark Obsidian Chronicle appearance — the documented signature
 * default from the design review and the product owner's reference screenshots.
 * This is a real persisted appearance selection, not a test-only bypass.
 */
const seedDarkAppearance = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'aikami:theme:selection',
      JSON.stringify({
        schemaVersion: 1,
        themeId: 'obsidian-chronicle',
        version: '1.0.0',
        mode: 'dark',
      }),
    );
  });
};

/** Opens /game and activates the management host. */
const openManagement = async (
  page: Page,
  section?: string,
  options: { readonly seedDark?: boolean } = {},
): Promise<void> => {
  if (options.seedDark !== false) {
    await seedDarkAppearance(page);
  }
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

/** Clicks a tab inside a feature view by its visible label (real production control). */
const clickTab = async (page: Page, tablistTestId: string, label: string): Promise<void> => {
  await page.locator(`[data-testid="${tablistTestId}"] button`, { hasText: label }).first().click();
  await page.waitForTimeout(300);
};

const managementCase = (options: {
  readonly name: string;
  readonly section?: string;
  readonly prompt: string;
  /** Extra production navigation (e.g. an in-view tab) after the section opens. */
  readonly afterOpen?: (page: Page) => Promise<void>;
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
    if (options.afterOpen) {
      await options.afterOpen(page);
    }
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
  `This is the production /game management workspace with the ${section} section active at a desktop viewport. Judge COMPOSITION and READABILITY: ONE large workspace occupying most of the viewport with a quiet scrim letting the game scene stay perceptible at the edges; a single workspace header with the section name, one short ornament rule beneath it, and exactly ONE Return/Back control; a section rail listing Character, Inventory, Journal, Party and World with the active one clearly highlighted (the header naming the active section AND the rail highlighting it is EXPECTED and is NOT duplicate chrome). If the section has no data yet, a composed, centred empty state fills the region. Set nestedPrimaryModal only when a small legacy dialog card floats inside the workspace, duplicateChrome only when a SECOND title or Close/X is rendered for the same surface inside the workspace, tinyEssentialText only when values or controls are genuinely too small to read, overlappingControls when controls overlap, missingCriticalAction when the rail or Return is absent, and excessiveDeadSpace only when the content occupies under a third of the workspace with no composed empty state. Score 85+ when the workspace is full-size, readable, coherent and the scene stays perceptible.`;

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
      afterOpen: async (page) => {
        await clickTab(page, 'journal-tabs', 'Quests');
      },
    }),
    managementCase({
      name: 'management-journal-notes',
      section: 'journal',
      prompt: shellPrompt('Journal (Notes subview)'),
      afterOpen: async (page) => {
        await clickTab(page, 'journal-tabs', 'Notes');
      },
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
      afterOpen: async (page) => {
        await clickTab(page, 'world-tabs', 'People');
      },
    }),
    managementCase({
      name: 'management-world-factions',
      section: 'world',
      prompt: shellPrompt('World (Factions subview)'),
      afterOpen: async (page) => {
        await clickTab(page, 'world-tabs', 'Factions');
      },
    }),
    managementCase({
      name: 'management-world-gallery',
      section: 'world',
      prompt: shellPrompt('World (Gallery subview)'),
      afterOpen: async (page) => {
        await clickTab(page, 'world-tabs', 'Gallery');
      },
    }),
    {
      name: 'explore-adventure',
      prompt:
        'The production /game exploration HUD with the default Adventure preset. Expected: the game scene dominates; a single labelled Menu entry, a compact readable player status (no emoji heart, tabular HP value, health tone also named) and at most one compact objective are present; there is no permanent seven-button management bar and no giant neon-green side rail. Flag visuallyDominantDebugAffordance for any neon grid or full-height arrow rail.',
      schema: ManagementSchema,
      screenshotSelector: 'body',
      setupHook: async (page: Page) => {
        await seedHudPreset(page, 'adventure');
        await seedDarkAppearance(page);
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
        await seedDarkAppearance(page);
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
        // Apply the accessibility override through the real Appearance surface,
        // then open the management workspace with it active.
        await page.goto(`${CLIENT_ORIGIN}/settings?section=interface`);
        await page.waitForSelector('[data-testid="settings-appearance"]', { state: 'visible' });
        await page.getByTestId('appearance-high-contrast').check();
        await page.waitForTimeout(300);
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
        await page.getByTestId('theme-editor-role-color.primary').fill('#e91e63');
        await page.getByTestId('theme-editor-role-color.primary').press('Tab');
        await page.getByTestId('theme-editor-role-color.panel').fill('#3a2140');
        await page.getByTestId('theme-editor-role-color.panel').press('Tab');
        await page.getByTestId('theme-editor-apply').click();
        await openManagement(page, 'character', { seedDark: false });
      },
      requiredFalseFields: [
        'unreadableText',
        'overlappingControls',
        'missingCriticalAction',
        'duplicateChrome',
      ],
      minScore: 85,
    },
  ],
});
