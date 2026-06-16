// apps/e2e/tests/game/camera_visual.spec.ts
// Visual Test — verifies camera follows player with lerp + clamping
//
// Contract: C-137 Camera Follow & Viewport
//
// Navigates to the game page, waits for the engine to initialize,
// presses a movement key, and verifies the world container transform
// updates correctly (camera following the player entity).

import { expect, test } from '@playwright/test';

const BASE_URL = 'http://localhost:5274';

/**
 * Waits for the PixiJS canvas to be added to the DOM and become visible.
 * The GameViewModel attaches the canvas after engine initialization.
 */
const waitForGameCanvas = async (page: import('@playwright/test').Page) => {
  await page.waitForSelector('#game-canvas-container canvas', { timeout: 30000 });
  // Give the engine a moment to finish initialization and render a few frames
  await page.waitForTimeout(2000);
};

test.describe('Camera Follow & Viewport (C-137)', () => {
  test('game canvas renders with camera system active', async ({ page }) => {
    await page.goto(`${BASE_URL}/game`);

    await waitForGameCanvas(page);

    // Verify the canvas container exists and has dimensions
    const container = page.locator('#game-canvas-container');
    await expect(container).toBeVisible();

    // Verify the UI layer is rendered on top
    const uiLayer = page.locator('#game-ui-layer');
    await expect(uiLayer).toBeVisible();

    // Take a screenshot to verify the game renders correctly
    // The camera should be centered on the player (who starts at 400, 300)
    await expect(page).toHaveScreenshot('camera_initial_viewport.png', {
      maxDiffPixels: 500,
    });
  });

  test('camera follows player after keyboard movement', async ({ page }) => {
    await page.goto(`${BASE_URL}/game`);

    await waitForGameCanvas(page);

    // Press D to move the player right (camera should follow via lerp)
    await page.keyboard.down('d');
    // Hold for a moment to let the player move and camera lerp
    await page.waitForTimeout(500);
    await page.keyboard.up('d');

    // Give the camera lerp time to catch up
    await page.waitForTimeout(300);

    // Take a screenshot — the camera should have shifted right
    // (player moved right, camera lerped toward new position)
    await expect(page).toHaveScreenshot('camera_after_movement.png', {
      maxDiffPixels: 500,
    });
  });

  test('camera clamps at world origin when player at edge', async ({ page }) => {
    await page.goto(`${BASE_URL}/game`);

    await waitForGameCanvas(page);

    // Move the player top-left to test clamping.
    // The camera should clamp at (halfScreen, halfScreen) instead of
    // showing void at negative coordinates.
    await page.keyboard.down('a');
    await page.keyboard.down('w');
    await page.waitForTimeout(1500);
    await page.keyboard.up('a');
    await page.keyboard.up('w');

    // Verify the game is still rendering (camera didn't break)
    const canvas = page.locator('#game-canvas-container canvas');
    await expect(canvas).toBeVisible();

    // Take a screenshot — should show the world origin area, not void
    await expect(page).toHaveScreenshot('camera_clamped_origin.png', {
      maxDiffPixels: 500,
    });
  });
});
