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

  // ── C-332 AC-1: Always-Visible HUD ──

  test('should render HP bar during exploration', async ({ page }) => {
    // Wait for engine to be ready
    await page.waitForSelector('[role="progressbar"]', { state: 'attached', timeout: 15000 });

    const hpBar = page.locator('[role="progressbar"]');
    await expect(hpBar).toBeAttached();

    // Check ARIA attributes
    await expect(hpBar).toHaveAttribute('aria-valuenow');
    await expect(hpBar).toHaveAttribute('aria-valuemin');
    await expect(hpBar).toHaveAttribute('aria-valuemax');
  });

  // ── C-332 AC-4: Focus Trap in Overlays ──

  test('should trap focus in pause menu overlay', async ({ page }) => {
    // Wait for engine ready
    await page.waitForSelector('#game-canvas-container', { state: 'attached', timeout: 15000 });

    // Open pause menu
    await page.keyboard.press('Escape');
    const resumeButton = page.getByText('Resume Game');
    await expect(resumeButton).toBeVisible({ timeout: 5000 });

    // Tab through all focusable elements — focus should stay within dialog
    // Count how many times we can tab before cycling back to first element
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab');
      // Focus should not have moved to the page body
      const focused = page.locator(':focus');
      await expect(focused).not.toHaveAttribute('id', 'game-canvas-container');
    }
  });

  test('should restore focus on overlay close', async ({ page }) => {
    await page.waitForSelector('#game-canvas-container', { state: 'attached', timeout: 15000 });

    // Ensure game canvas container exists and get focus
    await page.locator('#game-canvas-container').focus();

    // Open pause menu
    await page.keyboard.press('Escape');
    const resumeButton = page.getByText('Resume Game');
    await expect(resumeButton).toBeVisible({ timeout: 5000 });

    // Close with Escape
    await page.keyboard.press('Escape');

    // Focus should return to game canvas container
    await expect(page.locator('#game-canvas-container')).toBeFocused({ timeout: 2000 });
  });
});
