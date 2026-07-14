// apps/e2e/src/visual/suites/cyoa_choices.visual.ts
// CYOA Choices — declarative visual test suite.
//
// Captures the /dev/cyoa sandbox to verify the choice buttons render
// correctly: DaisyUI join stack, skill-check badges, truncation,
// selection state, and history card.
//
// Contract: C-245 CYOA Choices Branching Narrative

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const ChoicesSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  headingVisible: Type.Boolean({
    description: 'Whether the "CYOA Choices Sandbox" heading is visible',
  }),
  narrativeVisible: Type.Boolean({
    description: 'Whether the GM narrative chat bubble is visible',
  }),
  choiceButtonsVisible: Type.Boolean({
    description: 'Whether a vertical stack of 4 joined choice buttons is visible',
  }),
  skillCheckBadgesVisible: Type.Boolean({
    description:
      'Whether skill-check badges ("Persuasion DC 15", "Survival DC 12") are visible on choice buttons',
  }),
  historyCardVisible: Type.Boolean({
    description: 'Whether the Choice History card is visible',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

const SelectedSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  buttonsDisabled: Type.Boolean({
    description: 'Whether the choice buttons appear disabled (greyed out)',
  }),
  selectionAlertVisible: Type.Boolean({
    description: 'Whether a success alert showing the selected choice is visible',
  }),
  historyEntryVisible: Type.Boolean({
    description: 'Whether the selected choice appears in the Choice History card',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompts ──────────────────────────────────────────────────

const CHOICES_PROMPT = [
  'This is a screenshot from the Aikami CYOA Choices dev sandbox (/dev/cyoa).',
  '',
  'EXPECTED:',
  '- Heading: "CYOA Choices Sandbox" with a subtitle',
  '- A chat bubble with a fantasy narrative about a forest crossroads',
  '- A vertical stack of 4 joined (DaisyUI join) choice buttons below the bubble:',
  '  "Investigate the ruins", "Follow the river trail", "Persuade the guard to talk",',
  '  and a long truncated choice ending with an ellipsis',
  '- Skill-check badges on two buttons: "Persuasion DC 15" and "Survival DC 12"',
  '- A row of small outline control buttons (Load 4 choices, Load single choice, etc.)',
  '- A "Choice History" card at the bottom showing "No choices recorded yet."',
  '',
  'Score: 90-100 for complete layout, 70-89 for partial, 0-69 for broken.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

const SELECTED_PROMPT = [
  'This is a screenshot from the Aikami CYOA Choices dev sandbox (/dev/cyoa)',
  'after the user clicked the first choice button.',
  '',
  'EXPECTED:',
  '- All 4 choice buttons appear disabled (greyed out / reduced contrast)',
  '- A green/success alert reading "Selected: Investigate the ruins"',
  '- The "Choice History" card lists "Investigate the ruins"',
  '',
  'Score: 90-100 for complete state, 70-89 for partial, 0-69 for broken.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'cyoa-choices',
  route: '/dev/cyoa',
  waitCondition: 'game_ready',
  cases: [
    {
      name: 'CYOA Choices — Initial State',
      prompt: CHOICES_PROMPT,
      schema: ChoicesSchema,
      screenshotSelector: 'body',
    },
    {
      name: 'CYOA Choices — After Selection',
      prompt: SELECTED_PROMPT,
      schema: SelectedSchema,
      screenshotSelector: 'body',
      setupHook: async (page) => {
        const firstChoice = page.locator('[data-testid="cyoa-choices"] button').first();
        await firstChoice.click();
        await page.waitForTimeout(500);
      },
    },
  ],
});
