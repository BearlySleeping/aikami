// apps/e2e/src/visual/suites/settings.visual.ts
//
// Visual test suite for the grouped settings shell (C-333).
// Contracts: AC-1 (Play group default), AC-4 (In-game overlay)

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

const SettingsBasicSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  groupTabsVisible: Type.Boolean({
    description: 'Whether the four group tabs are visible (Play, AI, Content, Data)',
  }),
  playGroupActive: Type.Boolean({
    description: 'Whether the Play group tab is shown as the active/selected tab',
  }),
  playSectionsVisible: Type.Boolean({
    description:
      'Whether the Play group sub-nav shows its four sections (Controls, Audio, Display, Gameplay)',
  }),
  noSearchBoxVisible: Type.Boolean({
    description: 'Whether there is no search input anywhere on the page',
  }),
  closeButtonVisible: Type.Boolean({
    description: 'Whether the Close button with back arrow is visible in the header',
  }),
  capabilityBadgeVisible: Type.Boolean({
    description: 'Whether the AI capability badge is visible next to the Settings title',
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
      name: 'Settings Grouped Shell — AC-1',
      prompt: `Score 90+: Settings page shows a top-level group tab bar with exactly four tabs: Play, AI, Content, Data. The Play group tab is active/selected by default. Below the group tabs, a second-level sub-nav shows the Play group's four sections: Controls, Audio, Display, Gameplay. There is no search input anywhere on the page and no "Basic"/"Advanced" toggle button. A Close button with back arrow is at the top left. An AI capability badge (e.g. "AI: Connected" or "AI: Not Set Up") is visible next to the "Settings" title. The Controls section is selected by default in the sub-nav, showing keybinding options with a "Reset to Defaults" button.`,
      schema: SettingsBasicSchema,
      setupHook: async (page) => {
        await page.waitForSelector('h1:has-text("Settings")', { timeout: 10_000 });
        await page.waitForTimeout(500);
      },
    },
  ],
});
