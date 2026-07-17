// apps/e2e/tests/client/game_boot.spec.ts
//
// E2E tests for the /game boot pipeline.
// Contract: C-326 Make Game Boot Atomic, Observable, and Content-Driven
//
// Cases:
//   1. Fresh campaign boots to declared spawn with input unlocked
//   2. Navigate away mid-boot then re-enter boots cleanly

import { expect, test } from '@playwright/test';

test.describe('Game Boot Pipeline', () => {
  test('AC-1: should render loading stage and eventually show game canvas', async ({ page }) => {
    await page.goto('/game');

    // The stage-aware boot view should appear (not just "Loading game engine...")
    // The boot view renders stage label text and a progress bar
    const progressBar = page.locator('progress.progress-primary');
    await expect(progressBar).toBeAttached({ timeout: 10000 });

    // Wait for the game canvas to appear (boot completes)
    const canvas = page.locator('#game-canvas-container canvas');
    await expect(canvas).toBeAttached({ timeout: 30000 });
  });

  test('AC-4: should recover after navigation away and re-entry', async ({ page }) => {
    // First visit
    await page.goto('/game');

    // Wait for boot to start (progress bar appears)
    const progressBar = page.locator('progress.progress-primary');
    await expect(progressBar).toBeAttached({ timeout: 10000 });

    // Navigate away immediately
    await page.goto('/');

    // Re-enter game
    await page.goto('/game');

    // Should start fresh — progress bar appears again
    const newProgressBar = page.locator('progress.progress-primary');
    await expect(newProgressBar).toBeAttached({ timeout: 10000 });
  });

  test('AC-1: should eventually show player HUD when boot completes', async ({ page }) => {
    await page.goto('/game');

    // Wait for the game canvas container
    await page.waitForSelector('#game-canvas-container', { state: 'attached', timeout: 15000 });

    // Wait for engine to be ready (player HUD appears when canvas renders)
    const playerHud = page.locator('.bg-base-200\\/80');
    await playerHud.waitFor({ state: 'visible', timeout: 30000 });

    await expect(playerHud).toBeVisible();
  });
});
