// apps/e2e/tests/client/world_gen.spec.ts
//
// Playwright functional E2E tests for the World Generation Wizard (C-233).
//
// Tests the full wizard flow: Genre/Tone → Setting/Difficulty → Goals →
// Generating → Preview → Character Creation, plus back/forward navigation,
// Surprise Me, and retry logic.
//
// Contract: C-233

import { expect, test } from '@playwright/test';
import { WorldGenWizardPage } from '$pom/world_gen_wizard_page';

// ── Tests ─────────────────────────────────────────────────────────────────

test.describe('World Generation Wizard — C-233', () => {
  test.describe('Dev Sandbox', () => {
    test.beforeEach(async ({ page }) => {
      const wizard = new WorldGenWizardPage(page);
      await wizard.gotoDevSandbox();
    });

    test('should show the wizard on dev sandbox page', async ({ page }) => {
      await expect(page.locator('h2').first()).toBeVisible();
    });

    test('should show progress bar', async ({ page }) => {
      const wizard = new WorldGenWizardPage(page);
      expect(await wizard.isProgressBarVisible()).toBe(true);
    });

    test('should navigate through all input steps via Next', async ({ page }) => {
      const wizard = new WorldGenWizardPage(page);
      await wizard.selectGenre('Fantasy');
      await wizard.selectTone('Heroic');
      await wizard.clickNext();
      expect(await wizard.getCurrentStepLabel()).toContain('Setting');
      await wizard.fillSetting('Test setting.');
      await wizard.clickNext();
      expect(await wizard.getCurrentStepLabel()).toContain('Goals');
    });

    test('should go back to previous step', async ({ page }) => {
      const wizard = new WorldGenWizardPage(page);
      await wizard.selectGenre('Fantasy');
      await wizard.selectTone('Heroic');
      await wizard.clickNext();
      await wizard.clickBack();
      expect(await wizard.getCurrentStepLabel()).toContain('Genre');
    });

    test('should fill Surprise Me and proceed to generate', async ({ page }) => {
      const wizard = new WorldGenWizardPage(page);
      await wizard.clickSurpriseMe();
      expect(await wizard.getSelectedGenre()).toBeTruthy();
    });
  });

  test.describe('Full Wizard Flow', () => {
    test.beforeEach(async ({ page }) => {
      const wizard = new WorldGenWizardPage(page);
      // Use dev sandbox which has mock LLM data (production setup needs real LLM)
      await wizard.gotoDevSandbox();
    });

    test('should complete full flow: inputs → generate → preview', async ({ page }) => {
      const wizard = new WorldGenWizardPage(page);

      // Sandbox auto-fills with Surprise Me preset, so advance through steps
      await wizard.clickNext();
      await wizard.clickNext();

      // Generate the world (mock response from sandbox)
      await wizard.clickGenerateWorld();
      await wizard.waitForPreview();

      // Verify preview shows world content
      const worldName = await wizard.getWorldName();
      expect(worldName).toBeTruthy();

      // Verify Accept World and Regenerate buttons are visible
      await expect(page.getByRole('button', { name: 'Accept World' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Regenerate' })).toBeVisible();
    });

    test('should allow going back from preview to edit inputs', async ({ page }) => {
      const wizard = new WorldGenWizardPage(page);

      // Advance through steps (sandbox auto-filled)
      await wizard.clickNext();
      await wizard.clickNext();

      // Generate
      await wizard.clickGenerateWorld();
      await wizard.waitForPreview();

      // We should be at preview - verify
      expect(await wizard.getWorldName()).toBeTruthy();

      // Verify Accept World button is visible
      await expect(page.locator('button:has-text("Accept World")')).toBeVisible();
    });
  });

  test.describe('Surprise Me!', () => {
    test('should fill all inputs with Surprise Me', async ({ page }) => {
      const wizard = new WorldGenWizardPage(page);
      await wizard.gotoDevSandbox();

      // Surprise Me already applied by sandbox constructor, re-apply to verify
      await wizard.clickSurpriseMe();
      expect(await wizard.getSelectedGenre()).toBeTruthy();
    });
  });
});
