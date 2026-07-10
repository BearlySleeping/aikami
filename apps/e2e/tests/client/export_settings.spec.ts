// apps/e2e/tests/client/export_settings.spec.ts
//
// E2E functional tests for Export & Data settings tab (C-246, AC-6).
// Verifies tab navigation, section rendering, and download triggers.

import { expect, test } from '@playwright/test';

test.describe('Export & Data Settings Tab', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to settings page
    await page.goto('/settings?from=start');
    // Wait for settings to render
    await page.waitForSelector('text=Settings', { timeout: 10_000 });
  });

  test('should navigate to Export & Data tab', async ({ page }) => {
    // Click the Export & Data sub-tab
    const exportTab = page.getByRole('button', { name: 'Export & Data' });
    await expect(exportTab).toBeVisible({ timeout: 5_000 });
    await exportTab.click();

    // Verify sections render
    await expect(page.getByText('Chat Export')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Character Export')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Session Export')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Backup')).toBeVisible({ timeout: 5_000 });
  });

  test('should show empty states when no data exists', async ({ page }) => {
    const exportTab = page.getByRole('button', { name: 'Export & Data' });
    await exportTab.click();

    // Empty states should be visible
    await expect(page.getByText('No chats to export.')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('No characters yet.')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('No completed sessions.')).toBeVisible({ timeout: 5_000 });
  });

  test('should show Download Backup button', async ({ page }) => {
    const exportTab = page.getByRole('button', { name: 'Export & Data' });
    await exportTab.click();

    const backupButton = page.getByRole('button', { name: 'Download Backup' });
    await expect(backupButton).toBeVisible({ timeout: 5_000 });
  });
});
