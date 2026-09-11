// apps/e2e/src/visual/suites/export_settings.visual.ts
//
// Visual test suite for Export & Data settings tab (C-246, AC-6).
// Screenshots the full Export tab with chat/character/session/backup sections.

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

const ExportTabSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  headingVisible: Type.Boolean({
    description: 'Whether the "Settings" heading is visible',
  }),
  chatSectionVisible: Type.Boolean({
    description: 'Whether the "Chat Export" section is present',
  }),
  characterSectionVisible: Type.Boolean({
    description: 'Whether the "Character Export" section is present',
  }),
  sessionSectionVisible: Type.Boolean({
    description: 'Whether the "Session Export" section is present',
  }),
  backupSectionVisible: Type.Boolean({
    description: 'Whether the "Device Backup" section with a "Download Backup" button is present',
  }),
  emptyStatesVisible: Type.Boolean({
    description: 'Whether empty state messages ("No chats to export", etc.) are shown',
  }),
  exportDataTabActive: Type.Boolean({
    description: 'Whether the "Export & Data" tab is visually active/highlighted',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

export default defineConfig({
  id: 'export-settings',
  route: '/settings?from=start',
  waitCondition: 'game_ready',
  requiresAuth: false,
  cases: [
    {
      name: 'Export & Data Tab',
      prompt: `The settings page should show the "Export & Data" tab as active.
The page should display five sections:
1. "Chat Export" with a table header (NPC, Messages, Last Activity, Actions) and an empty state "No chats to export."
2. "Character Export" with a table header (Name, Type, Actions) and an empty state "No characters yet."
3. "Session Export" with a table header (Session, Date, Synopsis, Actions) and an empty state "No completed sessions."
4. "Device Backup" section with a card containing description text, a "Restore from File" control, and a "Download Backup" button.
5. "Content Export" section with a "Download Content Export" button.
The settings header with "Settings" title and Close button should be visible at the top.
The primary category tabs (Game, AI Engine) should be visible above.
The Game sub-tabs should include "Export & Data" as an active/highlighted tab.`,
      schema: ExportTabSchema,
      setupHook: async (page) => {
        // Click the Export & Data sub-tab
        const exportTab = page.getByRole('button', { name: 'Export & Data' });
        await exportTab.waitFor({ state: 'visible', timeout: 5000 });
        await exportTab.click();
        // Wait for the export content to render
        await page.waitForSelector('text=Chat Export', { timeout: 5000 });
      },
    },
  ],
});
