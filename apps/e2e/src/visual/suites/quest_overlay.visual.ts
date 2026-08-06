// apps/e2e/src/visual/suites/quest_overlay.visual.ts
//
// Visual test suite for the active-quest mini overlay (the "quest card"
// that mirrors the music player overlay).
//
// Captures two states clipped to the card element:
//   - Empty: no active quest → helpful hint text.
//   - Active: the default Emberwatch quest (The Fading Ward) accepted via
//     the sandbox dev action — title, description, and a 4-objective
//     checklist with the opening objective checked off.
//
// Contract: quest overlay (quest system)

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

const QuestOverlaySchema = Type.Object({
  score: Type.Number({ description: '0-100 visual quality score' }),
  titleVisible: Type.Boolean({ description: 'Quest title (or empty-state heading) visible' }),
  closeButtonVisible: Type.Boolean({ description: 'Close (✕) button visible in the header' }),
  objectivesVisible: Type.Boolean({ description: 'Objective list visible (active state)' }),
  currentObjectiveHighlighted: Type.Boolean({
    description: 'The current objective row is visually highlighted (active state)',
  }),
  noOverlapOrClipping: Type.Boolean({ description: 'Text is not clipped or overlapping' }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues found' }),
});

const QUEST_OVERLAY = '[data-testid="quest-overlay"]';

/**
 * Removes the DevToolsPanel from the visual tree so it cannot cover the
 * quest card. The panel grows taller than the viewport (its collapse
 * toggle sits above y=0), so clicking is impossible — DOM removal is the
 * reliable way to get it out of the shot.
 */
const hideDevTools = async (page: import('playwright').Page): Promise<void> => {
  await page.evaluate(() => {
    const toggle = document.querySelector('button[title="Collapse Dev Tools"]');
    const panel = toggle?.parentElement;
    if (panel) {
      panel.style.display = 'none';
    }
  });
  await page.waitForTimeout(300);
};

/** Accepts the default quest, then hides the dev tools panel. */
const acceptDefaultQuest = async (page: import('playwright').Page): Promise<void> => {
  const acceptBtn = page.locator('[data-testid="dev-action-accept-default-quest-fading-ward"]');
  await acceptBtn.click({ timeout: 10_000 });
  await page.waitForTimeout(600);
  await hideDevTools(page);
};

export default defineConfig({
  id: 'quest-overlay',
  route: '/dev/sandbox',
  waitCondition: 'game_ready',
  requiresAuth: false,
  cases: [
    {
      name: 'quest-overlay-empty',
      screenshotSelector: QUEST_OVERLAY,
      setupHook: hideDevTools,
      prompt: [
        'This is a screenshot of the Aikami active-quest overlay card (clipped to the card only).',
        '',
        'EXPECTED (empty state):',
        '- A compact rounded card with a light translucent background (backdrop blur).',
        '- Header: a scroll icon (📜) with the title "No active quest" in the primary accent color and a small ✕ close button on the right.',
        '- Below: muted helper text beginning "No active quest — talk to Elder Thalia in the village to get started."',
        '- Clean spacing, no clipped or overlapping text.',
        '',
        'EVALUATE with score 90+: title present, close button present, helper text present, no overlap.',
        'Return ONLY valid JSON matching the schema.',
      ].join('\n'),
      schema: QuestOverlaySchema,
    },
    {
      name: 'quest-overlay-active',
      screenshotSelector: QUEST_OVERLAY,
      setupHook: acceptDefaultQuest,
      prompt: [
        'This is a screenshot of the Aikami active-quest overlay card (clipped to the card only).',
        '',
        'EXPECTED (active quest — "The Fading Ward"):',
        '- Header: scroll icon (📜) with the quest title "The Fading Ward" and a ✕ close button.',
        '- A short quest description paragraph.',
        '- A checklist of 4 objectives, the first ("Ask Elder Thalia about the failing ward")',
        '  shown with a checkmark (✓) and the current objective',
        '  ("Find the Ward Wand\'s keeper at the inn") visually highlighted with a subtle',
        '  primary-colored row background.',
        '- Clean spacing, no clipped or overlapping text.',
        '',
        'EVALUATE with score 90+: title visible, close button visible, objective list visible,',
        'current objective highlighted, no overlap or clipping.',
        'Return ONLY valid JSON matching the schema.',
      ].join('\n'),
      schema: QuestOverlaySchema,
    },
  ],
});
