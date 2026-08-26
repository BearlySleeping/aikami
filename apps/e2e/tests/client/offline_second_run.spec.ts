// apps/e2e/tests/client/offline_second_run.spec.ts
//
// E2E test for C-448 AC-5: A second run is fully offline.
// Given an install that has completed a first run, when the network is
// blocked entirely and the game boots, then it reaches playable state with
// zero outbound network requests, and the pack loads from the cache.
//
// Contract: C-448 De-bundle Content Packs

import { expect, test } from '@playwright/test';

test.describe('C-448 AC-5: Offline Second Run', () => {
  test('should boot to playable state with zero network requests after cache is warmed', async ({
    page,
    context,
  }) => {
    // ── Phase 1: First run online — warm the cache ──
    const requests: string[] = [];

    // Record all network requests during the first run
    page.on('request', (request) => {
      const url = request.url();
      // Filter out data: URIs, blob:, and extension/internal requests
      if (url.startsWith('http') && !url.includes('localhost')) {
        requests.push(url);
      }
    });

    await page.goto('/game');

    // Wait for boot to complete (game canvas appears)
    const canvas = page.locator('#game-canvas-container canvas');
    await expect(canvas).toBeAttached({ timeout: 60000 });

    // Wait a bit more for on-demand asset fetches (map, sprites) to settle —
    // full-catalog warming is opt-in only and not exercised by this test.
    await page.waitForTimeout(5000);

    // ── Phase 2: Reload with network blocked ──
    // Track content requests during the second boot
    const offlineRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.startsWith('http') && !url.includes('localhost') && !url.startsWith('data:')) {
        offlineRequests.push(url);
      }
    });

    // Block all network requests via route interception
    await context.route('**/*', (route) => {
      // Allow data: and blob: URIs (local assets)
      const url = route.request().url();
      if (url.startsWith('data:') || url.startsWith('blob:')) {
        route.continue();
      } else {
        route.abort('internetdisconnected');
      }
    });

    // Reload the game
    await page.goto('/game');

    // Assert the game reaches a playable state
    const canvasAfter = page.locator('#game-canvas-container canvas');
    await expect(canvasAfter).toBeAttached({ timeout: 60000 });

    // Assert the player HUD is visible
    const playerHud = page.getByTestId('player-hud');
    await expect(playerHud).toBeVisible({ timeout: 30000 });

    // Wait a moment for any late requests
    await page.waitForTimeout(3000);

    // Assert zero external network requests
    expect(offlineRequests.length).toBe(0);
  });
});
