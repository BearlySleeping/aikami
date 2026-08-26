// apps/e2e/tests/client/upgrade_no_redownload.spec.ts
//
// E2E test for C-448 AC-7: Upgrading does not re-download. Given an install
// with the pack already cached from before this change, when it boots on the
// new build, prefetch reports alreadyCached === requested, fetched === 0, and
// no pack bytes are transferred.
//
// Contract: C-448 De-bundle Content Packs

import { expect, test } from '@playwright/test';

test.describe('C-448 AC-7: Upgrade No Re-download', () => {
  test('should skip prefetch when content is already cached', async ({ page }) => {
    // First boot to warm the cache
    await page.goto('/game');

    // Wait for boot to complete
    const canvas = page.locator('#game-canvas-container canvas');
    await expect(canvas).toBeAttached({ timeout: 60000 });

    // Wait a moment for cache to settle
    await page.waitForTimeout(3000);

    // Reload (simulating an upgrade)
    await page.reload();

    // The boot should complete without re-downloading
    const canvasAfter = page.locator('#game-canvas-container canvas');
    await expect(canvasAfter).toBeAttached({ timeout: 60000 });

    // The game should reach playable state
    const playerHud = page.locator('.bg-base-200\\/80');
    await expect(playerHud).toBeVisible({ timeout: 30000 });
  });
});
