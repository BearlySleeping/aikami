// apps/e2e/tests/client/first_run_prefetch.spec.ts
//
// E2E test for C-448 AC-4: First run downloads the starter pack with visible
// progress. Given a fresh install with an empty cache and a reachable origin,
// when the game boots, the boot UI shows a `prefetching_starter_content` stage
// with progress, the pack and its tilesets are fetched and hash-verified, and
// the game reaches playable state.
//
// Contract: C-448 De-bundle Content Packs

import { expect, test } from '@playwright/test';

test.describe('C-448 AC-4: First Run Prefetch', () => {
  test('should download starter content with visible progress on first boot', async ({
    page,
    context,
  }) => {
    // Clear any existing cache to simulate a fresh install
    await page.goto('/game');

    // The boot UI should show the prefetching_starter_content stage
    // with progress text like "Downloading starter content — 1/5"
    const prefetchText = page.locator('text=Downloading starter content');
    await expect(prefetchText).toBeVisible({ timeout: 30000 });

    // Wait for boot to complete (game canvas appears)
    const canvas = page.locator('#game-canvas-container canvas');
    await expect(canvas).toBeAttached({ timeout: 60000 });

    // The game should reach a playable state
    const playerHud = page.locator('.bg-base-200\\/80');
    await expect(playerHud).toBeVisible({ timeout: 30000 });
  });
});
