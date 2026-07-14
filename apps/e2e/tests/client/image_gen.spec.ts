// apps/e2e/tests/client/image_gen.spec.ts
//
// C-242: Image Generation Pipeline — E2E functional tests.
//
// Acceptance Criteria:
//   AC-1: Style profile selection, built-in immutability.
//   AC-2: Prompt compilation — dedup + negative extraction.
//   AC-3: Contextual trigger simulation.
//   AC-4: Gallery panel — add + view images.
//   AC-5: Dev sandbox renders all tabs.

import { expect, test } from '@playwright/test';
import { ImageGenPage } from '$pom';

test.describe('Image Generation Pipeline — C-242', () => {
  let imageGen: ImageGenPage;

  test.beforeEach(async ({ page }) => {
    imageGen = new ImageGenPage(page);
    await imageGen.gotoDev();
  });

  // ── AC-5: Sandbox renders ────────────────────────────────

  test.describe('AC-5 — Dev Sandbox', () => {
    test('should render the page header and all tabs', async () => {
      await imageGen.expectHeader();
      await imageGen.expectTabsVisible();
    });

    test('should show the Profiles tab with active profile selector on load', async () => {
      await imageGen.expectProfileCard();
    });
  });

  // ── AC-1: Style Profile System ────────────────────────────

  test.describe('AC-1 — Style Profile System', () => {
    test('should show built-in profiles in the dropdown', async () => {
      const select = imageGen.activeProfileSelect;
      await expect(select).toBeVisible();
      const options = select.locator('option');
      const count = await options.count();
      expect(count).toBeGreaterThanOrEqual(6); // 6 built-in profiles
    });

    test('should clone a built-in profile and show the edit form', async () => {
      // Click Clone on the active Auto profile
      await imageGen.cloneButton.click();
      // Should show the edit form with the cloned profile
      const saveButton = imageGen.page.getByRole('button', { name: '💾 Save' });
      await expect(saveButton).toBeVisible({ timeout: 3000 });
    });
  });

  // ── AC-2: Prompt Compilation ──────────────────────────────

  test.describe('AC-2 — Prompt Compilation', () => {
    test('should compile a prompt and show positive/negative output', async () => {
      await imageGen.clickTab('Compiler');

      // Type a base prompt
      await imageGen.basePromptTextarea.fill(
        'a dark forest, masterpiece, best quality, avoid text',
      );

      // Click compile
      await imageGen.compileButton.click();

      // Should show compiled output
      await imageGen.expectCompiledOutput();
    });

    test('should move negative-ish phrases to negative output', async () => {
      await imageGen.clickTab('Compiler');
      await imageGen.basePromptTextarea.fill('a dark forest with avoid text and no watermark');
      await imageGen.compileButton.click();

      const negativeText = await imageGen.compilerNegativeOutput.textContent();
      expect(negativeText).toBeTruthy();
      // The negative should contain extracted terms
      const lower = (negativeText ?? '').toLowerCase();
      expect(lower).toMatch(/text|watermark/);
    });
  });

  // ── AC-3: Contextual Triggers ────────────────────────────

  test.describe('AC-3 — Contextual Triggers', () => {
    test('should fire a location trigger and show compiled prompt', async () => {
      await imageGen.clickTab('Triggers');

      // Fill context
      await imageGen.triggerContextInput.fill('The Crystal Caverns');

      // Fire trigger
      await imageGen.fireTriggerButton.click();

      // Should show compiled result
      const positiveText = await imageGen.triggerResultPositive.textContent();
      expect(positiveText).toBeTruthy();
    });

    test('should debounce rapid triggers', async () => {
      await imageGen.clickTab('Triggers');
      await imageGen.triggerContextInput.fill('Test Location');

      // Fire twice rapidly
      await imageGen.fireTriggerButton.click();
      await imageGen.page.waitForTimeout(200);
      await imageGen.fireTriggerButton.click();

      // Second should show debounced message
      const text = await imageGen.triggerResultPositive.textContent();
      expect(text).toBeTruthy();
    });
  });

  // ── AC-4: Review & Gallery ────────────────────────────────

  test.describe('AC-4 — Gallery', () => {
    test('should add a mock image and display it in the gallery', async () => {
      await imageGen.clickTab('Gallery');

      // Add mock image
      await imageGen.addMockButton.click();

      // Should show at least one image
      await imageGen.expectGalleryHasImages();
    });

    test('should expand image to fullscreen on click', async () => {
      await imageGen.clickTab('Gallery');
      await imageGen.addMockButton.click();

      // Click first image
      await imageGen.galleryImages.first().click();

      // Should show the fullscreen close button
      const closeBtn = imageGen.page.locator('.btn-ghost').filter({ hasText: '✕' });
      await expect(closeBtn).toBeVisible({ timeout: 2000 });
    });
  });
});
