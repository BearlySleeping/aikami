// apps/e2e/tests/client/game_page.spec.ts
//
// E2E test for the /game page — verifies the new separated
// GameView + GameUIView architecture renders correctly.

import { expect, test } from '@playwright/test';

test.describe('Game Page (Separated Architecture)', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the game page
    await page.goto('/game');
    // Wait for the container to be in DOM (loading overlay covers it until engine is ready)
    await page.waitForSelector('#game-canvas-container', { state: 'attached', timeout: 15000 });
  });

  test('should render the game canvas container (attached to DOM)', async ({ page }) => {
    const container = page.locator('#game-canvas-container');
    await expect(container).toBeAttached();
  });

  test('should render a canvas element inside the container', async ({ page }) => {
    const canvas = page.locator('#game-canvas-container canvas');
    await expect(canvas).toBeAttached();
  });

  test('should render the game UI layer', async ({ page }) => {
    const uiLayer = page.locator('#game-ui-layer');
    await expect(uiLayer).toBeAttached();
  });

  test('engine loads and hides loading overlay', async ({ page }) => {
    // Loading overlay should appear briefly then disappear when engine is ready
    const loadingText = page.getByText('Loading game engine...');
    // With WebGL enabled, engine should load and loading text should disappear
    await loadingText.waitFor({ state: 'hidden', timeout: 15000 });
  });

  test('should respond to Escape key by opening pause menu', async ({ page }) => {
    // Wait for engine to be ready (player HUD appears when canvas renders)
    const playerHud = page.locator('.bg-base-200\\/80');
    await playerHud.waitFor({ state: 'visible', timeout: 15000 });

    // Press Escape to open pause menu
    await page.keyboard.press('Escape');

    // Check for pause menu elements
    const resumeButton = page.getByText('Resume Game');
    await expect(resumeButton).toBeVisible({ timeout: 5000 });
  });
});
