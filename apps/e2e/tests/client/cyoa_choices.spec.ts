// apps/e2e/tests/client/cyoa_choices.spec.ts
//
// C-245: CYOA Choices Branching Narrative — E2E verification via dev sandbox.
//
// Covers: choice buttons rendering (AC-2), skill-check badges (AC-3),
// selection → disable + history recording (AC-2, AC-4), single-choice
// "Continue" behavior, empty no-op, and dismissal.
//
// Uses the CyoaPage POM for all sandbox interactions.

import { test } from '@playwright/test';
import { CyoaPage } from '$pom';

test.describe('CYOA Choices Sandbox (C-245)', () => {
  let sandbox: CyoaPage;

  test.beforeEach(async ({ page }) => {
    sandbox = new CyoaPage(page);
    await sandbox.gotoDev();
  });

  // ── Sandbox baseline ──────────────────────────────────────

  test('should render the sandbox heading and narrative', async () => {
    await sandbox.expectHeadingVisible();
  });

  // ── AC-2: Choice buttons UI ───────────────────────────────

  test('should render 4 choice buttons below the narrative', async () => {
    await sandbox.expectChoiceCount(4);
  });

  test('should disable all buttons and record history after selecting a choice', async () => {
    await sandbox.selectChoice(0);

    await sandbox.expectAllChoicesDisabled();
    await sandbox.expectSelectedLabel('Investigate the ruins');
    await sandbox.expectHistoryContains('Investigate the ruins');
  });

  // ── AC-3: Skill-check badges ──────────────────────────────

  test('should show skill-check badges on DC choices', async () => {
    await sandbox.expectSkillCheckBadge('Persuasion DC 15');
    await sandbox.expectSkillCheckBadge('Survival DC 12');
  });

  // ── AC-4: Choice history tracking ─────────────────────────

  test('should accumulate multiple selections in history', async () => {
    await sandbox.selectChoice(0);
    await sandbox.loadMockChoices();
    await sandbox.selectChoice(1);

    await sandbox.expectHistoryContains('Investigate the ruins');
    await sandbox.expectHistoryContains('Follow the river trail');
  });

  test('should clear history via the clear button', async () => {
    await sandbox.selectChoice(0);
    await sandbox.expectHistoryContains('Investigate the ruins');

    await sandbox.clearHistory();
    await sandbox.expectHistoryEmpty();
  });

  // ── Edge cases ────────────────────────────────────────────

  test('should render single choice as Continue (prompt-advance)', async () => {
    await sandbox.loadSingleChoice();

    await sandbox.expectChoiceCount(1);
    const { expect } = await import('@playwright/test');
    await expect(sandbox.choiceButtons.first()).toContainText('Continue');
  });

  test('should render nothing for empty choice set (no-op)', async () => {
    await sandbox.loadEmptyChoices();
    await sandbox.expectChoicesHidden();
  });

  test('should hide choices on dismiss', async () => {
    await sandbox.expectChoiceCount(4);
    await sandbox.dismissChoices();
    await sandbox.expectChoicesHidden();
  });

  test('should support keyboard selection (Tab + Enter)', async ({ page }) => {
    // Focus the first choice button directly, then press Enter
    await sandbox.choiceButtons.first().focus();
    await page.keyboard.press('Enter');

    await sandbox.expectSelectedLabel('Investigate the ruins');
  });
});
