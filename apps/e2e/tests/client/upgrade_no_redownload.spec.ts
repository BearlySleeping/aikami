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

    // Track content requests and bytes transferred during the second boot
    const contentRequests: string[] = [];
    let bytesTransferred = 0;

    page.on('request', (request) => {
      const url = request.url();
      // Track requests to content packs or pack assets (excluding localhost/bundled assets)
      if (
        url.includes('/content-packs/') ||
        (url.startsWith('http') && !url.includes('localhost'))
      ) {
        contentRequests.push(url);
      }
    });

    page.on('response', (response) => {
      const url = response.url();
      if (
        url.includes('/content-packs/') ||
        (url.startsWith('http') && !url.includes('localhost'))
      ) {
        // Attempt to track body size if available
        response
          .body()
          .then((buffer) => {
            bytesTransferred += buffer.length;
          })
          .catch(() => {
            // Ignore errors for responses that don't have bodies
          });
      }
    });

    // Reload (simulating an upgrade)
    await page.reload();

    // The boot should complete without re-downloading
    const canvasAfter = page.locator('#game-canvas-container canvas');
    await expect(canvasAfter).toBeAttached({ timeout: 60000 });

    // The game should reach playable state
    const playerHud = page.getByTestId('player-hud');
    await expect(playerHud).toBeVisible({ timeout: 30000 });

    // Wait a moment for any late requests
    await page.waitForTimeout(3000);

    // Assert zero content requests and zero bytes transferred
    expect(contentRequests.length).toBe(0);
    expect(bytesTransferred).toBe(0);
  });
});
