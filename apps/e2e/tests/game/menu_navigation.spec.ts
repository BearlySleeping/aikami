// apps/frontend/game/tests/menu_navigation.spec.ts
import { expect, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// Menu Navigation E2E Tests
//
// Tests the startup menu flow: Start Game, Options, Quit confirmation,
// and back navigation.
// ---------------------------------------------------------------------------

test.describe('Menu Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the menu screen to be visible
    await page.waitForSelector('#menu-screen', { state: 'visible' });
  });

  test('displays the main menu on load', async ({ page }) => {
    // Menu screen should be visible
    await expect(page.locator('#menu-screen')).toBeVisible();

    // All three buttons should be visible
    await expect(page.locator('#btn-start')).toBeVisible();
    await expect(page.locator('#btn-options')).toBeVisible();
    await expect(page.locator('#btn-quit')).toBeVisible();

    // Game screen should be hidden
    await expect(page.locator('#game-screen')).not.toBeVisible();
  });

  test('"Start Game" transitions to game screen', async ({ page }) => {
    await page.click('#btn-start');

    // Game screen should become visible
    await expect(page.locator('#game-screen')).toBeVisible();

    // Menu should be hidden
    await expect(page.locator('#menu-screen')).not.toBeVisible();

    // Canvas should exist in the game screen
    const canvas = page.locator('#game-canvas');
    await expect(canvas).toBeVisible();
  });

  test('"Options" opens options panel and "Back" returns to menu', async ({ page }) => {
    // Navigate to Options
    await page.click('#btn-options');

    // Menu should be hidden, options should be visible
    await expect(page.locator('#menu-screen')).not.toBeVisible();
    await expect(page.locator('#options-panel')).toBeVisible();

    // Resolution select should exist
    const select = page.locator('#select-resolution');
    await expect(select).toBeVisible();

    // Navigate back to menu
    await page.click('#btn-options-back');

    // Menu should be visible again
    await expect(page.locator('#menu-screen')).toBeVisible();
    await expect(page.locator('#options-panel')).not.toBeVisible();
  });

  test('"Quit" shows confirmation overlay, "Cancel" returns to menu', async ({ page }) => {
    // Click Quit
    await page.click('#btn-quit');

    // Quit overlay should appear
    await expect(page.locator('#quit-overlay')).toBeVisible();

    // Cancel should hide the overlay
    await page.click('#btn-quit-cancel');
    await expect(page.locator('#quit-overlay')).not.toBeVisible();

    // Menu should still be visible
    await expect(page.locator('#menu-screen')).toBeVisible();
  });

  test('"Quit" confirmation returns to menu', async ({ page }) => {
    // Click Quit
    await page.click('#btn-quit');

    // Quit overlay should appear
    await expect(page.locator('#quit-overlay')).toBeVisible();

    // Confirm quit
    await page.click('#btn-quit-confirm');

    // Quit overlay should disappear
    await expect(page.locator('#quit-overlay')).not.toBeVisible();

    // Menu should be visible (back to main menu)
    await expect(page.locator('#menu-screen')).toBeVisible();
  });

  test('full navigation flow: menu → options → menu → game', async ({ page }) => {
    // Start at menu
    await expect(page.locator('#menu-screen')).toBeVisible();

    // Go to options
    await page.click('#btn-options');
    await expect(page.locator('#options-panel')).toBeVisible();

    // Select a different resolution
    await page.selectOption('#select-resolution', '1024x768');

    // Go back to menu
    await page.click('#btn-options-back');
    await expect(page.locator('#menu-screen')).toBeVisible();

    // Start the game
    await page.click('#btn-start');
    await expect(page.locator('#game-screen')).toBeVisible();
    await expect(page.locator('#game-canvas')).toBeVisible();
  });

  test('title and subtitle are displayed', async ({ page }) => {
    // Page title
    await expect(page).toHaveTitle('Aikami Game');

    // Game title
    const title = page.locator('#menu-screen h1');
    await expect(title).toHaveText('AIKAMI');

    // Subtitle
    const subtitle = page.locator('#menu-screen h2');
    await expect(subtitle).toHaveText('Chronicles of the Lost Realm');
  });
});
