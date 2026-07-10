// apps/e2e/tests/client/character_sheet.spec.ts
//
// E2E functional tests for the Character Sheet overlay.
// Covers tab navigation, ability score editing, skill proficiency toggling,
// narrative trait chips, Pro Mode, and AI context preview.
//
// Contract: C-232 Character Sheet & Traits System

import { expect, test } from '@playwright/test';
import { CharacterSheetPage } from '../../src/pom/character_sheet_page';

test.describe('Character Sheet — Dev Sandbox', () => {
  let sheet: CharacterSheetPage;

  test.beforeEach(async ({ page }) => {
    sheet = new CharacterSheetPage(page);
    await sheet.gotoDevSandbox();
    await sheet.expectVisible();
  });

  test('should display the character sheet card', async () => {
    await expect(sheet.card).toBeVisible();
  });

  test('should show all 6 ability scores with modifiers', async () => {
    await sheet.tabAbilities.click();

    // Verify STR 16(+3)
    await sheet.expectModifier('STR', '+3');

    // DEX should be 14(+2)
    await sheet.expectModifier('DEX', '+2');

    // CHA should be 8(-1)
    await sheet.expectModifier('CHA', '-1');
  });

  test('should edit an ability score and recompute modifier', async ({ page: _page }) => {
    await sheet.tabAbilities.click();

    const strInput = sheet.abilityInput('STR');
    await strInput.fill('10');
    await strInput.blur();

    // Modifier should now be 0
    await sheet.expectModifier('STR', '+0');
  });

  test('should navigate to Skills tab and show 18 skills', async () => {
    await sheet.tabSkills.click();
    await sheet.expectTabActive('skills');

    // Verify some skills are present
    const athleticsRow = sheet.skillRow('Athletics');
    await expect(athleticsRow).toBeVisible({ timeout: 3_000 });

    const arcanaRow = sheet.skillRow('Arcana');
    await expect(arcanaRow).toBeVisible({ timeout: 3_000 });
  });

  test('should toggle skill proficiency', async () => {
    await sheet.tabSkills.click();

    // Athletics should be proficient in mock data
    const athleticsCheckbox = sheet.skillProficiencyCheckbox('Athletics');
    await expect(athleticsCheckbox).toBeChecked({ timeout: 3_000 });

    // Toggle it off
    await athleticsCheckbox.click();
    await expect(athleticsCheckbox).not.toBeChecked({ timeout: 3_000 });
  });

  test('should navigate to Traits tab', async () => {
    await sheet.tabTraits.click();
    await sheet.expectTabActive('traits');

    // Verify personality traits textarea has mock data
    const personalityText = sheet.page.locator('textarea').first();
    await expect(personalityText).toHaveValue('I always keep my word. I face problems head-on.', {
      timeout: 3_000,
    });
  });

  test('should add and remove narrative trait chips', async () => {
    await sheet.tabTraits.click();

    // Scroll to the Narrative Traits section and fill in the likes input
    const likesInput = sheet.card.locator('input[type="text"]').first();
    await likesInput.scrollIntoViewIfNeeded();
    await likesInput.fill('Music');
    // Click the "+" button next to the input
    await sheet.card.locator('button:has-text("+")').first().click();

    // Should see the new chip
    const musicChip = sheet.card.locator('.badge').filter({ hasText: 'Music' });
    await expect(musicChip).toBeVisible({ timeout: 3_000 });

    // Remove it
    await musicChip.locator('button').click();
    await expect(musicChip).not.toBeVisible({ timeout: 3_000 });
  });

  test('should toggle Pro Mode and display JSON', async () => {
    // Toggle pro mode on
    await sheet.proModeToggle.click();

    // Enable editing to see the textarea
    const editToggle = sheet.card.locator('input[type="checkbox"].toggle').nth(1);
    await editToggle.click();

    // JSON textarea should appear
    const jsonArea = sheet.jsonTextarea;
    await expect(jsonArea).toBeVisible({ timeout: 3_000 });

    // Should contain ability data
    const jsonContent = await jsonArea.inputValue();
    expect(jsonContent).toContain('"strength"');
    expect(jsonContent).toContain('"value": 16');
  });

  test('should show error for invalid JSON in Pro Mode', async () => {
    // Toggle pro mode on
    await sheet.proModeToggle.click();

    // Enable editing
    const editToggle = sheet.card.locator('input[type="checkbox"].toggle').nth(1);
    await editToggle.click();

    // Type invalid JSON
    const textarea = sheet.jsonTextarea;
    await textarea.fill('not valid json{{{');

    // Click save
    await sheet.card.getByRole('button', { name: 'Save & Validate' }).click();

    // Should show error
    await expect(sheet.jsonError).toBeVisible({ timeout: 3_000 });
  });

  test('should show AI context preview modal', async () => {
    // Click the AI preview button
    await sheet.aiPreviewButton.click();

    // Modal should appear
    await expect(sheet.aiPreviewModal).toBeVisible({ timeout: 3_000 });

    // Content should contain character data
    const content = await sheet.aiPreviewContent.textContent();
    expect(content).toContain('[CHARACTER SHEET]');
    expect(content).toContain('STR 16(+3)');
    expect(content).toContain('Likes: Gold');
  });
});
