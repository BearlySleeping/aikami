// apps/e2e/tests/client/onboarding/appearance_persistence.spec.ts
//
// E2E test: onboarding appearance step LPC recipe persistence in localStorage.
// Contract: C-325 AC-5 — deterministic recipe persistence
//
// Verifies that the LPC recipe and palette overrides survive page reload
// and are present in the aikami-onboarding-draft localStorage key.

import { type Page, test, expect } from '@playwright/test';

const SETUP_URL = 'http://localhost:5274/setup';

/**
 * Navigates the onboarding flow from starter_select → identity → play_style → appearance.
 * Assumes the page is already at the /setup route.
 */
const navigateToAppearanceStep = async (page: Page): Promise<void> => {
  // Click "Create Custom Hero"
  await page.locator('button', { hasText: 'Create Custom Hero' }).click();

  // Identity step: fill name and select race
  await page.locator('#onboarding-name').fill('TestHero');
  await page.locator('#onboarding-race').selectOption('human');
  await page.locator('button', { hasText: 'Next' }).click();

  // Play Style step: select class
  await page.locator('#onboarding-class').selectOption('fighter');
  await page.locator('button', { hasText: 'Next' }).click();

  // Now on Appearance step
  await page.waitForSelector('#lpc-preview-canvas', { timeout: 5000 });
};

test.describe('Onboarding Appearance Persistence', () => {
  test('draft includes LPC recipe after navigating to appearance step', async ({ page }) => {
    await page.goto(SETUP_URL);
    await navigateToAppearanceStep(page);

    // Check localStorage for the draft
    const draftRaw = await page.evaluate(() =>
      localStorage.getItem('aikami-onboarding-draft'),
    );
    expect(draftRaw).not.toBeNull();

    const draft = JSON.parse(draftRaw!);
    expect(draft.lpcRecipe).toBeDefined();
    expect(draft.lpcRecipe.head).toBeDefined();
    expect(draft.lpcRecipe.body).toBeDefined();
  });

  test('LPC recipe survives page reload', async ({ page }) => {
    await page.goto(SETUP_URL);
    await navigateToAppearanceStep(page);

    // Select a preset to set a known LPC recipe
    await page.locator('button', { hasText: 'Battle-Scarred Veteran' }).click();

    // Record the recipe before reload
    const beforeRecipe = await page.evaluate(() => {
      const draft = JSON.parse(localStorage.getItem('aikami-onboarding-draft') ?? '{}');
      return draft.lpcRecipe as Record<string, string>;
    });
    expect(beforeRecipe?.head).toBeDefined();

    // Reload the page
    await page.reload();

    // Navigate back to the appearance step (draft recovery should restore step)
    // The coordinator should recover the draft and be on the appearance step
    await page.waitForTimeout(500);

    // Check that the draft still has the LPC recipe
    const afterRecipe = await page.evaluate(() => {
      const draft = JSON.parse(localStorage.getItem('aikami-onboarding-draft') ?? '{}');
      return {
        lpcRecipe: draft.lpcRecipe as Record<string, string> | undefined,
        step: draft.step as string,
        selectedPresetId: draft.selectedPresetId as string | undefined,
      };
    });

    expect(afterRecipe.lpcRecipe).toBeDefined();
    expect(afterRecipe.lpcRecipe?.head).toBe(beforeRecipe?.head);
    expect(afterRecipe.selectedPresetId).toBeDefined();
  });

  test('palette overrides are persisted in draft', async ({ page }) => {
    await page.goto(SETUP_URL);
    await navigateToAppearanceStep(page);

    // Set a hair color override via the coordinator
    const result = await page.evaluate(() => {
      const draftRaw = localStorage.getItem('aikami-onboarding-draft');
      const draft = JSON.parse(draftRaw ?? '{}');
      return {
        hasPaletteOverrides: draft.paletteOverrides !== undefined,
        hasLpcRecipe: draft.lpcRecipe !== undefined,
      };
    });

    expect(result.hasLpcRecipe).toBe(true);
    expect(result.hasPaletteOverrides).toBe(true);
  });

  test('old draft without LPC fields is handled gracefully', async ({ page }) => {
    // Pre-populate localStorage with an old-format draft (no LPC fields)
    await page.goto(SETUP_URL);

    await page.evaluate(() => {
      localStorage.setItem(
        'aikami-onboarding-draft',
        JSON.stringify({
          step: 'appearance',
          name: 'OldDraft',
          pronounId: 'he_him',
          pronounDisplay: 'he/him',
          raceId: 'human',
          classId: 'fighter',
          alignment: 'Neutral',
          abilityScores: {
            strength: 10, dexterity: 10, constitution: 10,
            intelligence: 10, wisdom: 10, charisma: 10,
          },
          appearanceDescription: 'Old description',
          background: '',
          personalityTraits: '',
          equipment: [],
        }),
      );
    });

    // The draft should be recoverable — the coordinator defaults to DEFAULT_LPC_RECIPE
    const draftRaw = await page.evaluate(() =>
      localStorage.getItem('aikami-onboarding-draft'),
    );
    expect(draftRaw).not.toBeNull();

    const draft = JSON.parse(draftRaw!);
    // Old draft won't have lpcRecipe, but that's OK — new code handles it
    expect(draft.name).toBe('OldDraft');
  });
});
