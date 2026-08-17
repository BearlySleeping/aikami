// apps/e2e/src/visual/suites/start_picker.visual.ts
// Start screen pack picker — declarative visual test suite.
//
// Captures the C-345/C-405 content-pack picker modal on the start screen:
// two distinct pack cards with readable names and descriptions (no clipped
// text), the selected pack highlighted, and the detail panel rendered.
//
// Contract: C-405 AC-3 (pack picker appears when multiple packs are installed)

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const PackPickerSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  modalVisible: Type.Boolean({
    description: 'Whether the "Choose Your Adventure" modal is visible',
  }),
  twoPackCardsVisible: Type.Boolean({
    description: 'Whether exactly two pack cards are rendered side by side',
  }),
  packNamesReadable: Type.Boolean({
    description:
      'Whether both pack names ("Emberwatch: The Fading Ward" and "Whispering Caves") are fully readable',
  }),
  descriptionsNotClipped: Type.Boolean({
    description: 'Whether both pack card descriptions render fully without clipped/cut-off text',
  }),
  selectionHighlightVisible: Type.Boolean({
    description: 'Whether the selected pack card shows a highlighted border',
  }),
  startButtonVisible: Type.Boolean({
    description: 'Whether the primary "Start New Game" confirm button is visible',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompt ───────────────────────────────────────────────────

const PACK_PICKER_PROMPT = [
  'This is a screenshot of the Aikami start screen with the content-pack picker modal open.',
  '',
  'EXPECTED LAYOUT:',
  '- A modal dialog titled "Choose Your Adventure".',
  '- Exactly two pack cards side by side:',
  '  - "Emberwatch: The Fading Ward" (version 2.1.0).',
  '  - "Whispering Caves" (version 1.0.0).',
  '- Each card shows its full description with NO clipped or truncated text.',
  '- The Emberwatch card is highlighted with a colored border (selected).',
  '- Below the cards, a detail panel shows the selected pack name, version,',
  '  updated date and full description.',
  '- Bottom action row with "Cancel" and a primary "Start New Game" button.',
  '',
  'EVALUATE:',
  '- Is the modal visible?',
  '- Are two distinct pack cards rendered?',
  '- Are both pack names fully readable?',
  '- Are both descriptions fully visible (no line-clamp clipping)?',
  '- Is the selected pack highlighted?',
  '- Is the "Start New Game" button visible?',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Setup hook ────────────────────────────────────────────────

/**
 * Opens the pack picker by pressing "New Game" on the start screen.
 * The default character count is zero, so the browser appears when two
 * packs are installed.
 */
const openPackPicker = async (page: import('playwright').Page): Promise<void> => {
  await page.getByRole('button', { name: 'New Game' }).click();
  await page.getByText('Choose Your Adventure').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(800);
};

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'start_picker',
  route: '/',
  waitCondition: 'game_ready',
  requiresAuth: false,
  cases: [
    {
      name: 'Pack Picker — Two Installed Packs',
      prompt: PACK_PICKER_PROMPT,
      schema: PackPickerSchema,
      // The modal overlay covers the full viewport — capture it whole instead
      // of the default 256px canvas center-crop.
      screenshotSelector: '.modal',
      setupHook: openPackPicker,
    },
  ],
});
