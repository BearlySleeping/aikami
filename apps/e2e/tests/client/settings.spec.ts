// apps/e2e/tests/client/settings.spec.ts
//
// E2E functional tests for the grouped settings shell (C-333).
// Contracts: AC-1 (Play group default), AC-4 (In-game overlay),
//            AC-5 (Per-section reset + preview/revert)

import { expect, test } from '@playwright/test';
import { SettingsPage } from '$pom';

test.describe('Settings — Grouped Shell (C-333)', () => {
  let settings: SettingsPage;

  test.beforeEach(async ({ page }) => {
    settings = new SettingsPage(page);
    await settings.goto();
  });

  // ── AC-1: Group Tabs + Play Group Default ──

  test('AC-1: settings page shows four group tabs with Play active by default', async () => {
    await expect(settings.groupTabs).toHaveCount(4);

    await expect(settings.groupTab('Play')).toBeVisible();
    await expect(settings.groupTab('AI')).toBeVisible();
    await expect(settings.groupTab('Content')).toBeVisible();
    await expect(settings.groupTab('Data')).toBeVisible();

    await expect(settings.groupTab('Play')).toHaveAttribute('aria-selected', 'true');

    // Play group's four sections are in the sub-nav
    await expect(settings.sectionTabs).toHaveCount(4);
    await expect(settings.sectionTab('Controls')).toBeVisible();
    await expect(settings.sectionTab('Audio')).toBeVisible();
    await expect(settings.sectionTab('Display')).toBeVisible();
    await expect(settings.sectionTab('Gameplay')).toBeVisible();
  });

  test('AC-1: AI group shows AI & Privacy and Connections sections', async () => {
    await settings.selectAIGroup();

    await expect(settings.aiConnectionHeading).toBeVisible({ timeout: 5_000 });

    await expect(settings.sectionTabs).toHaveCount(2);
    await expect(settings.sectionTab('AI & Privacy')).toBeVisible();
    await expect(settings.sectionTab('Connections')).toBeVisible();
  });

  // ── AC-5: Per-Section Reset ──

  test('AC-5: controls section has reset to defaults button', async () => {
    await settings.selectControlsTab();

    await expect(settings.resetToDefaultsButton).toBeVisible({ timeout: 5_000 });
  });

  test('AC-5: gameplay section has reset to defaults button', async () => {
    await settings.selectGameplayTab();

    await expect(settings.resetToDefaultsButton).toBeVisible({ timeout: 5_000 });
  });
});
