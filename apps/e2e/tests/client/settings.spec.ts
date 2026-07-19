// apps/e2e/tests/client/settings.spec.ts
//
// E2E functional tests for progressive disclosure settings (C-333).
// Contracts: AC-1 (Basic mode), AC-2 (Advanced toggle), AC-3 (Search),
//            AC-4 (In-game overlay), AC-5 (Per-section reset + preview/revert)

import { expect, test } from '@playwright/test';

test.describe('Settings — Progressive Disclosure (C-333)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
    await page.waitForSelector('h1:has-text("Settings")', { timeout: 10_000 });
  });

  // ── AC-1: Basic Mode Shows Only Essential Settings ──

  test('AC-1: settings page shows only 5 basic sections by default', async ({ page }) => {
    // Verify only basic section tabs are visible
    const sectionTabs = page.locator('.tabs-boxed button.tab:has-text("Controls")');
    await expect(sectionTabs).toBeVisible({ timeout: 5_000 });

    // Expect exactly 5 basic section tabs: Controls, Audio, Display, Gameplay, AI & Privacy
    const allTabs = page.locator('.tabs-boxed button.tab');
    const tabCount = await allTabs.count();
    expect(tabCount).toBe(5);

    // Verify each basic section label is present
    await expect(page.locator('.tabs-boxed button.tab:has-text("Controls")')).toBeVisible();
    await expect(page.locator('.tabs-boxed button.tab:has-text("Audio")')).toBeVisible();
    await expect(page.locator('.tabs-boxed button.tab:has-text("Display")')).toBeVisible();
    await expect(page.locator('.tabs-boxed button.tab:has-text("Gameplay")')).toBeVisible();
    await expect(page.locator('.tabs-boxed button.tab:has-text("AI & Privacy")')).toBeVisible();

    // Verify no advanced section tabs are visible
    await expect(page.locator('.tabs-boxed button.tab:has-text("AI Engine")')).not.toBeVisible();
    await expect(page.locator('.tabs-boxed button.tab:has-text("Agents")')).not.toBeVisible();
    await expect(page.locator('.tabs-boxed button.tab:has-text("Music")')).not.toBeVisible();
    await expect(page.locator('.tabs-boxed button.tab:has-text("Export")')).not.toBeVisible();

    // Verify the Advanced toggle button exists
    const advancedBtn = page.locator('button:has-text("Advanced")');
    await expect(advancedBtn).toBeVisible();
  });

  test('AC-1: AI & Privacy section shows loading/not-configured state gracefully', async ({
    page,
  }) => {
    // Navigate to AI & Privacy tab
    const aiTab = page.locator('.tabs-boxed button.tab:has-text("AI & Privacy")');
    await aiTab.click();
    await page.waitForTimeout(300);

    // Should show connection status (any of: loading, connected, not_configured, offline)
    await expect(page.locator('text=AI Connection')).toBeVisible({ timeout: 5_000 });
  });

  // ── AC-2: Advanced Toggle Reveals Hidden Sections ──

  test('AC-2: advanced toggle reveals hidden sections', async ({ page }) => {
    // Click Advanced toggle
    const advancedBtn = page.locator('button:has-text("Advanced")');
    await advancedBtn.click();
    await page.waitForTimeout(300);

    // Verify advanced sections now visible
    const allTabs = page.locator('.tabs-boxed button.tab');
    const tabCount = await allTabs.count();
    expect(tabCount).toBeGreaterThanOrEqual(10); // 5 basic + 6 advanced

    // Verify specific advanced sections
    await expect(page.locator('.tabs-boxed button.tab:has-text("AI Engine")')).toBeVisible();
    await expect(page.locator('.tabs-boxed button.tab:has-text("Agents")')).toBeVisible();
    await expect(page.locator('.tabs-boxed button.tab:has-text("Music DJ")')).toBeVisible();
    await expect(page.locator('.tabs-boxed button.tab:has-text("Export & Data")')).toBeVisible();

    // Toggle off
    await advancedBtn.click();
    await page.waitForTimeout(300);
    const tabsAfter = page.locator('.tabs-boxed button.tab');
    expect(await tabsAfter.count()).toBe(5);
  });

  // ── AC-3: Search Filters Settings Sections ──

  test('AC-3: search filters settings sections by label', async ({ page }) => {
    const searchInput = page.locator('#settings-search');
    await expect(searchInput).toBeVisible();

    // Type "audio" — only Audio tab should be visible
    await searchInput.fill('audio');
    await page.waitForTimeout(300); // debounce
    const tabs = page.locator('.tabs-boxed button.tab');
    expect(await tabs.count()).toBe(1);
    await expect(page.locator('.tabs-boxed button.tab:has-text("Audio")')).toBeVisible();

    // Clear search — all 5 tabs return
    await searchInput.fill('');
    await page.waitForTimeout(300);
    expect(await tabs.count()).toBe(5);
  });

  test('AC-3: search shows empty state for no matches', async ({ page }) => {
    const searchInput = page.locator('#settings-search');
    await searchInput.fill('zzzno_match_zzz');
    await page.waitForTimeout(300);

    // Should show "No settings found" empty state
    await expect(page.locator('text=No settings found')).toBeVisible({ timeout: 3_000 });
  });

  test('AC-3: search in Basic mode does not reveal advanced sections', async ({ page }) => {
    const searchInput = page.locator('#settings-search');
    // In basic mode, searching for "agent" should yield no results
    await searchInput.fill('agent');
    await page.waitForTimeout(300);
    await expect(page.locator('text=No settings found')).toBeVisible({ timeout: 3_000 });
  });

  // ── AC-5: Per-Section Reset ──

  test('AC-5: controls section has reset to defaults button', async ({ page }) => {
    const controlsTab = page.locator('.tabs-boxed button.tab:has-text("Controls")');
    await controlsTab.click();
    await page.waitForTimeout(300);

    // Verify reset button exists in Controls section view
    const resetBtn = page.locator('button:has-text("Reset to Defaults")');
    await expect(resetBtn).toBeVisible({ timeout: 5_000 });
  });

  test('AC-5: gameplay section has reset to defaults button', async ({ page }) => {
    const gameplayTab = page.locator('.tabs-boxed button.tab:has-text("Gameplay")');
    await gameplayTab.click();
    await page.waitForTimeout(300);

    const resetBtn = page.locator('button:has-text("Reset to Defaults")');
    await expect(resetBtn).toBeVisible({ timeout: 5_000 });
  });
});
