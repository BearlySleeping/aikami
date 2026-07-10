// apps/e2e/tests/client/export_settings.spec.ts
//
// E2E functional tests for Export & Data settings tab (C-246, AC-6).
// Verifies tab navigation, section rendering, and download triggers.

import { expect, test } from '@playwright/test';

test.describe('Export & Data Settings Tab', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to settings page
    await page.goto('/settings?from=start');
    // Wait for settings to render - use the header since tabs may render async
    await page.waitForSelector('h1:has-text("Settings")', { timeout: 10_000 });
    // Ensure the Game tab is active
    const gameTab = page.locator('.tabs-boxed button:has-text("Game")');
    await gameTab.click();
    await page.waitForTimeout(300);
  });

  test('should navigate to Export & Data tab', async ({ page }) => {
    // Click the Export & Data sub-tab - use a scoped selector to avoid Eruda conflicts
    const exportTab = page.locator('.tabs-bordered button:has-text("Export")');
    await expect(exportTab).toBeVisible({ timeout: 5_000 });
    await exportTab.click();
    await page.waitForTimeout(300);

    // Verify sections render
    await expect(page.getByText('Chat Export')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Character Export')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Session Export')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('heading', { name: 'Backup' })).toBeVisible({ timeout: 5_000 });
  });

  test('should show empty states when no data exists', async ({ page }) => {
    const exportTab = page.locator('.tabs-bordered button:has-text("Export")');
    await exportTab.click();
    await page.waitForTimeout(300);

    // Empty states should be visible
    await expect(page.getByText('No chats to export.')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('No characters yet.')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('No completed sessions.')).toBeVisible({ timeout: 5_000 });
  });

  test('should show Download Backup button', async ({ page }) => {
    const exportTab = page.locator('.tabs-bordered button:has-text("Export")');
    await exportTab.click();
    await page.waitForTimeout(300);

    const backupButton = page.getByRole('button', { name: 'Download Backup' });
    await expect(backupButton).toBeVisible({ timeout: 5_000 });
  });
});
