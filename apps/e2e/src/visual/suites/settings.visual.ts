// apps/e2e/src/visual/suites/settings.visual.ts
//
// Visual test suite for progressive disclosure settings (C-333).
// Contracts: AC-1 (Basic mode), AC-4 (In-game overlay)

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

const SettingsBasicSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  basicSectionsVisible: Type.Boolean({
    description:
      'Whether the 5 basic section tabs are visible (Controls, Audio, Display, Gameplay, AI & Privacy)',
  }),
  noAdvancedSectionsVisible: Type.Boolean({
    description: 'Whether no advanced sections (AI Engine, Agents, etc.) are visible',
  }),
  searchBarVisible: Type.Boolean({
    description: 'Whether the search bar with placeholder "Search settings…" is visible',
  }),
  closeButtonVisible: Type.Boolean({
    description: 'Whether the Close button with back arrow is visible in the header',
  }),
  capabilityBadgeVisible: Type.Boolean({
    description: 'Whether the AI capability badge is visible next to the Settings title',
  }),
  advancedToggleVisible: Type.Boolean({
    description: 'Whether the Advanced toggle button is visible below the tabs',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

export default defineConfig({
  id: 'settings-basic',
  route: '/settings',
  waitCondition: 'game_ready',
  requiresAuth: false,
  cases: [
    {
      name: 'Settings Basic Mode — AC-1',
      prompt: `Score 90+: Settings page shows exactly 5 section tabs (Controls, Audio, Display, Gameplay, AI & Privacy). No generation parameters, agent editors, or export sections visible. Clean tab bar with clear labels. A search bar with "Search settings…" placeholder is present below the header. A Close button with back arrow is at the top left. An AI capability badge (e.g. "AI: Connected" or "AI: Not Set Up") is visible next to the "Settings" title. An Advanced toggle button is below the tabs. The Controls tab is selected by default showing keybinding options with "Reset to Defaults" button.`,
      schema: SettingsBasicSchema,
      setupHook: async (page) => {
        await page.waitForSelector('h1:has-text("Settings")', { timeout: 10_000 });
        await page.waitForTimeout(500);
      },
    },
  ],
});
