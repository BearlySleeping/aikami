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
    const eruda = document.querySelector<HTMLElement>('#eruda');
    if (eruda) {
      eruda.style.display = 'none';
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

/** Seeds a real persisted built-in appearance selection. */
const seedAppearance = async (page: Page, mode: 'light' | 'dark'): Promise<void> => {
  await page.addInitScript((appearanceMode) => {
    localStorage.setItem(
      'aikami:theme:selection',
      JSON.stringify({
        schemaVersion: 1,
        themeId: 'obsidian-chronicle',
        version: '1.0.0',
        mode: appearanceMode,
      }),
    );
  }, mode);
};

const seedDarkAppearance = (page: Page): Promise<void> => seedAppearance(page, 'dark');

/** Seeds the real management stores after the target section finishes mounting. */
const seedManagementStores = async (page: Page, scenario: 'empty' | 'populated'): Promise<void> => {
  await page.evaluate((contentScenario) => {
    const seam = (window as unknown as Record<string, unknown>).__AIKAMI_TEST__ as
      | {
          seedManagementContent(options: {
            scenario: 'empty' | 'populated';
          }): Record<string, number>;
        }
      | undefined;
    seam?.seedManagementContent({ scenario: contentScenario });
  }, scenario);
};

const EMPTY_CHARACTER_SHEET = {
  abilities: {
    strength: { value: 10, modifier: 0 },
    dexterity: { value: 10, modifier: 0 },
    constitution: { value: 10, modifier: 0 },
    intelligence: { value: 10, modifier: 0 },
    wisdom: { value: 10, modifier: 0 },
    charisma: { value: 10, modifier: 0 },
  },
  skills: [],
  savingThrows: [],
  traits: { personalityTraits: '', ideals: '', bonds: '', flaws: '' },
  narrativeTraits: { likes: [], temptations: [], keys: [] },
  proficiencyBonus: 2,
  level: 1,
  xp: 0,
  hp: 10,
  maxHp: 10,
  attack: 0,
  defense: 12,
  classId: 'fighter',
  classFeatures: [],
  hotbarSlots: [],
} as const;

const POPULATED_CHARACTER_SHEET = {
  abilities: {
    strength: { value: 16, modifier: 3 },
    dexterity: { value: 14, modifier: 2 },
    constitution: { value: 15, modifier: 2 },
    intelligence: { value: 12, modifier: 1 },
    wisdom: { value: 13, modifier: 1 },
    charisma: { value: 16, modifier: 3 },
  },
  skills: [
    {
      name: 'Persuasion',
      ability: 'charisma',
      isProficient: true,
      isExpertise: false,
      modifier: 0,
    },
  ],
  savingThrows: [{ ability: 'wisdom', isProficient: true, isExpertise: false, modifier: 0 }],
  traits: {
    personalityTraits: 'Keeps watch when the village turns quiet.',
    ideals: 'A protected home is worth defending.',
    bonds: 'The ward keepers of Emberwatch.',
    flaws: 'Troubles a lantern left unattended.',
  },
  narrativeTraits: { likes: ['Old maps'], temptations: ['Rare maps'], keys: ['The eastern ward'] },
  proficiencyBonus: 3,
  level: 5,
  xp: 480,
  hp: 34,
  maxHp: 42,
  attack: 4,
  defense: 17,
  classId: 'fighter',
  classFeatures: ['fighter_second_wind', 'fighter_action_surge'],
  hotbarSlots: ['fighter_second_wind'],
} as const;

const characterSheetFor = (populated: boolean) =>
  populated ? POPULATED_CHARACTER_SHEET : EMPTY_CHARACTER_SHEET;

/** Seeds an authored character sheet through the existing production constructor seam. */
const seedCharacterSheet = async (page: Page, populated: boolean): Promise<void> => {
  await page.addInitScript((sheet) => {
    (window as unknown as Record<string, unknown>).__AIKAMI_E2E_SHEET__ = sheet;
  }, characterSheetFor(populated));
};

/** Proves the production evidence plane selected PixiJS WebGL. */
const assertProductionWebGl = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => {
    const app = (window as unknown as Record<string, unknown>).__PIXI_APP__ as
      | { renderer?: { name?: unknown } }
      | undefined;
    return typeof app?.renderer?.name === 'string';
  });
  const renderer = await page.evaluate(() => {
    const app = (window as unknown as Record<string, unknown>).__PIXI_APP__ as
      | { renderer?: { name?: unknown } }
      | undefined;
    return typeof app?.renderer?.name === 'string' ? app.renderer.name : 'none';
  });
  if (renderer !== 'webgl') {
    throw new Error(`Expected PixiJS WebGL renderer, received ${renderer}`);
  }
};

/** Opens /game and activates the management host. */
const openManagement = async (
  page: Page,
  section?: string,
  options: {
    readonly seedDark?: boolean;
    readonly appearance?: 'light' | 'dark';
    readonly scenario?: 'empty' | 'populated';
    readonly character?: 'empty' | 'populated';
    readonly viewport?: { readonly width: number; readonly height: number };
    readonly textScale?: number;
  } = {},
): Promise<void> => {
  if (options.viewport) {
    await page.setViewportSize(options.viewport);
  }
  if (options.appearance) {
    await seedAppearance(page, options.appearance);
  } else if (options.seedDark !== false) {
    await seedDarkAppearance(page);
  }
  if (options.character) {
    await seedCharacterSheet(page, options.character === 'populated');
  }
  await page.goto(`${CLIENT_ORIGIN}/game`);
  await waitForHud(page);
  await assertProductionWebGl(page);
  await page.getByTestId('hud-menu-entry').click();
  await page.waitForSelector('[data-testid="management-workspace"]', {
    state: 'visible',
    timeout: 15_000,
  });
  if (section !== undefined) {
    await page.getByTestId(`section-tab-${section}`).click();
    await page.waitForTimeout(300);
  }
  if (options.scenario) {
    await seedManagementStores(page, options.scenario);
  }
  if (options.textScale) {
    await page.evaluate((scale) => {
      document.documentElement.style.fontSize = `${scale}%`;
    }, options.textScale);
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
  readonly appearance?: 'light' | 'dark';
  readonly scenario?: 'empty' | 'populated';
  readonly character?: 'empty' | 'populated';
  readonly viewport?: { readonly width: number; readonly height: number };
  readonly textScale?: number;
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
    await openManagement(page, options.section, {
      appearance: options.appearance,
      scenario: options.scenario,
      character: options.character,
      viewport: options.viewport,
      textScale: options.textScale,
    });
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
    'themeIdentityMissing',
    'visuallyDominantDebugAffordance',
  ],
  minScore: 85,
});

const shellPrompt = (section: string): string =>
  `This is the production /game management workspace with the ${section} section active at a desktop viewport, over the dark Obsidian Chronicle appearance. Judge COMPOSITION, READABILITY and IDENTITY: ONE large workspace occupying most of the viewport with a quiet scrim letting the game scene stay perceptible at the edges; a single workspace header with the section name in a SERIF display face, one short brass ornament rule beneath it, and exactly ONE Return/Back control; a section rail listing Character, Inventory, Journal, Party and World with the active one highlighted (the header naming the active section AND the rail highlighting it is EXPECTED and is NOT duplicate chrome). The intended Aikami identity is a WARM ink/parchment workspace (brown-tinged, NOT neutral grey or blue), a SERIF section heading, restrained BRASS/GOLD rules and separators, and a sparse VIOLET accent on the active item — these cues are PRESENT in a correct dark screenshot, so set themeIdentityMissing true ONLY when ALL of them are absent. If the section has no data yet, a composed, centred empty state fills the region. Set nestedPrimaryModal only when a small legacy dialog card floats inside the workspace, duplicateChrome only when a SECOND title or Close/X is rendered for the same surface inside the workspace, tinyEssentialText only when values or controls are genuinely too small to read, overlappingControls when controls overlap, missingCriticalAction when the rail or Return is absent, and excessiveDeadSpace only when the content occupies under a third of the workspace with no composed empty state. Score 85+ when the workspace is full-size, readable, coherent, on-identity and the scene stays perceptible.`;

export default defineConfig({
  id: 'management-workspace',
  route: '/game',
  waitCondition: 'game_ready',
  cases: [
    managementCase({
      name: 'management-character',
      section: 'character',
      prompt: shellPrompt('Character'),
      character: 'empty',
      scenario: 'empty',
    }),
    managementCase({
      name: 'management-character-populated',
      section: 'character',
      prompt: shellPrompt('Character (authored sheet)'),
      character: 'populated',
    }),
    managementCase({
      name: 'management-inventory-empty',
      section: 'inventory',
      prompt: shellPrompt('Inventory'),
      scenario: 'empty',
    }),
    managementCase({
      name: 'management-inventory-populated',
      section: 'inventory',
      prompt: shellPrompt('Inventory (equipped gear, bag and selected item)'),
      scenario: 'populated',
    }),
    managementCase({
      name: 'management-inventory-populated-light-compact',
      section: 'inventory',
      prompt: shellPrompt('Inventory (populated light compact layout)'),
      appearance: 'light',
      scenario: 'populated',
      viewport: { width: 800, height: 600 },
    }),
    managementCase({
      name: 'management-inventory-populated-text200',
      section: 'inventory',
      prompt: shellPrompt('Inventory (populated at 200% text)'),
      scenario: 'populated',
      viewport: { width: 1280, height: 720 },
      textScale: 200,
    }),
    managementCase({
      name: 'management-journal-quests',
      section: 'journal',
      prompt: shellPrompt('Journal (Quests subview)'),
      scenario: 'empty',
      afterOpen: async (page) => {
        await clickTab(page, 'journal-tabs', 'Quests');
      },
    }),
    managementCase({
      name: 'management-journal-quests-populated',
      section: 'journal',
      prompt: shellPrompt('Journal (active quest and objectives)'),
      scenario: 'populated',
      afterOpen: async (page) => {
        await clickTab(page, 'journal-tabs', 'Quests');
      },
    }),
    managementCase({
      name: 'management-journal-notes',
      section: 'journal',
      prompt: shellPrompt('Journal (Notes subview)'),
      scenario: 'empty',
      afterOpen: async (page) => {
        await clickTab(page, 'journal-tabs', 'Notes');
      },
    }),
    managementCase({
      name: 'management-journal-notes-populated',
      section: 'journal',
      prompt: shellPrompt('Journal (note list and selected detail)'),
      scenario: 'populated',
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
        'The production /game exploration HUD with the Readable preset at 1280x720 over the dark Obsidian Chronicle appearance. This case judges the PRESET, not the art direction: compared with the default Adventure preset, the player-status pill, clock and Menu control are scaled up (~1.25x) and use the comfortable density, so the text and hit targets are visibly larger and the surfaces are opaque enough to read over the scene. Expected: enlarged, clearly readable controls, the game scene still perceptible at the edges, no overlap, no off-screen controls. The dark warm palette with a brass-trimmed status pill is the intended Aikami identity and is correct — do NOT report themeIdentityMissing for this case.',
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
        'The production /game management workspace at 200% root text size, cropped exactly to the workspace. Roughly 1024x768 viewport. Expected: the workspace still fits the screen and stays readable; the five-section rail reflows (wraps or scrolls) so Character, Inventory, Journal, Party and World are all reachable; the body scrolls VERTICALLY only for its own content; the Return action stays visible. There must be NO horizontal reading scroll — report horizontal-reading-scroll ONLY if content is actually cut off on the left/right or you must scroll sideways to read it. A vertically scrolled body inside a fixed-height workspace is EXPECTED and is not a defect. Report clipped-buttons only when a control is genuinely partially cut by the viewport edge with no way to reach it.',
      schema: ManagementSchema,
      screenshotSelector: '[data-testid="management-workspace"]',
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
        'The management workspace with the high-contrast accessibility override enabled, and the host Return control is focused so its focus ring is visible. Expected: body and secondary text are a very strong black-or-white against the surface (near-maximum contrast, no faint low-contrast text), and the focused Return control shows a clearly visible focus ring. This is a STATIC screenshot — judge the focus ring on the focused control only; do not expect focus rings on unfocused controls. Set unreadableText only when text is genuinely faint against its background.',
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
        // Focus the Return control so the high-contrast focus ring is captured.
        await page.getByTestId('management-close').focus();
        await page.waitForTimeout(200);
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
        'The management workspace after a non-default valid theme was installed through the creator editor. That theme sets the panel role to a DEEP PLUM (#3a2140) and the primary role to a BRIGHT MAGENTA/PINK (#e91e63). Expected: the workspace surface reads as plum/purple-brown (NOT the built-in cream/parchment or a neutral grey) and the ACTIVE navigation item is magenta/pink (NOT the built-in violet). Set themeIdentityMissing ONLY when the surfaces look exactly like the built-in default (cream/parchment panel with violet active item) — i.e. the custom colours did not reach production.',
      schema: ManagementSchema,
      screenshotSelector: 'body',
      setupHook: async (page: Page) => {
        await page.goto(`${CLIENT_ORIGIN}/settings?section=interface`);
        await page.waitForSelector('[data-testid="settings-appearance"]', { state: 'visible' });
        await page.getByTestId('appearance-open-editor').click();
        await page.waitForSelector('[data-testid="theme-editor-preview"]', { state: 'visible' });
        await page.getByTestId('theme-editor-role-color.primary').fill('#e91e63');
        await page.getByTestId('theme-editor-role-color.primary').press('Tab');
        await page.getByTestId('theme-editor-role-color.accent').fill('#e91e63');
        await page.getByTestId('theme-editor-role-color.accent').press('Tab');
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
        'themeIdentityMissing',
      ],
      minScore: 85,
    },
  ],
});
