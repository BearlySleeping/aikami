// apps/e2e/tests/client/settings.spec.ts
//
// E2E functional tests for the grouped settings shell (C-333).
// Contracts: AC-1 (Play group default), AC-4 (In-game overlay),
//            AC-5 (Per-section reset + preview/revert)

import { expect, test } from '@playwright/test';

test.describe('Settings — Grouped Shell (C-333)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
    await page.waitForSelector('h1:has-text("Settings")', { timeout: 10_000 });
  });

  // ── AC-1: Group Tabs + Play Group Default ──

  test('AC-1: settings page shows four group tabs with Play active by default', async ({
    page,
  }) => {
    const groupTabs = page.locator('[role="tablist"][aria-label="Settings groups"] [role="tab"]');
    await expect(groupTabs).toHaveCount(4);

    await expect(groupTabs.filter({ hasText: 'Play' })).toBeVisible();
    await expect(groupTabs.filter({ hasText: 'AI' })).toBeVisible();
    await expect(groupTabs.filter({ hasText: 'Content' })).toBeVisible();
    await expect(groupTabs.filter({ hasText: 'Data' })).toBeVisible();

    const playTab = groupTabs.filter({ hasText: 'Play' });
    await expect(playTab).toHaveAttribute('aria-selected', 'true');

    // Play group's four sections are in the sub-nav
    const sectionTabs = page.locator(
      '[role="tablist"][aria-label="Settings sections"] [role="tab"]',
    );
    await expect(sectionTabs).toHaveCount(4);
    await expect(sectionTabs.filter({ hasText: 'Controls' })).toBeVisible();
    await expect(sectionTabs.filter({ hasText: 'Audio' })).toBeVisible();
    await expect(sectionTabs.filter({ hasText: 'Display' })).toBeVisible();
    await expect(sectionTabs.filter({ hasText: 'Gameplay' })).toBeVisible();
  });

  test('AC-1: AI group shows AI & Privacy and Connections sections', async ({ page }) => {
    const aiGroupTab = page.locator('[role="tablist"][aria-label="Settings groups"] [role="tab"]', {
      hasText: 'AI',
    });
    await aiGroupTab.click();
    await page.waitForTimeout(300);

    await expect(page.locator('text=AI Connection')).toBeVisible({ timeout: 5_000 });

    const sectionTabs = page.locator(
      '[role="tablist"][aria-label="Settings sections"] [role="tab"]',
    );
    await expect(sectionTabs).toHaveCount(2);
    await expect(sectionTabs.filter({ hasText: 'AI & Privacy' })).toBeVisible();
    await expect(sectionTabs.filter({ hasText: 'Connections' })).toBeVisible();
  });

  // ── AC-5: Per-Section Reset ──

  test('AC-5: controls section has reset to defaults button', async ({ page }) => {
    const controlsTab = page.locator(
      '[role="tablist"][aria-label="Settings sections"] [role="tab"]',
      { hasText: 'Controls' },
    );
    await controlsTab.click();
    await page.waitForTimeout(300);

    const resetBtn = page.locator('button:has-text("Reset to Defaults")');
    await expect(resetBtn).toBeVisible({ timeout: 5_000 });
  });

  test('AC-5: gameplay section has reset to defaults button', async ({ page }) => {
    const gameplayTab = page.locator(
      '[role="tablist"][aria-label="Settings sections"] [role="tab"]',
      { hasText: 'Gameplay' },
    );
    await gameplayTab.click();
    await page.waitForTimeout(300);

    const resetBtn = page.locator('button:has-text("Reset to Defaults")');
    await expect(resetBtn).toBeVisible({ timeout: 5_000 });
  });
});
