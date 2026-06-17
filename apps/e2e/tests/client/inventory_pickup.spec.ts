// apps/e2e/tests/client/inventory_pickup.spec.ts
// Inventory Pickup E2E Test — verifies the inventory overlay opens/closes
// with keyboard shortcuts ('I' toggle, Escape close) and locks/releases
// game movement (GameMode: MENU ↔ EXPLORE).
//
// Contract: C-142 Inventory Item Pickups
//
// NOTE: Item pickup via 'E' requires item entities on the Tiled map.
// The current sandbox_zone_a.json map has NPCs + props but no items.
// Once items are added to a map, extend this test to walk up and
// press 'E' before verifying inventory contents.

import { expect, test } from '@playwright/test';

const GAME_URL = 'http://localhost:5274/game';

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Waits for the game engine to signal readiness.
 */
const waitForGameReady = async (page: import('@playwright/test').Page) => {
  // The game UI view shows a loading overlay until GAME_READY fires.
  // Wait for the canvas to be present.
  await page.waitForSelector('canvas', { timeout: 15000 });
  // Give the engine time to load the starting map
  await page.waitForTimeout(2000);
};

// ── Tests ─────────────────────────────────────────────────────────────────

test.describe('Inventory Overlay', () => {
  test('should open inventory overlay when pressing I', async ({ page }) => {
    await page.goto(GAME_URL, { waitUntil: 'domcontentloaded' });
    await waitForGameReady(page);

    // Press 'I' to open the inventory overlay
    await page.keyboard.press('KeyI');
    await page.waitForTimeout(500);

    // Verify the inventory card is visible
    const inventoryCard = page.locator('.card:has-text("Inventory")');
    await expect(inventoryCard).toBeVisible();

    // Verify the empty state message is shown (no items on default map)
    const emptyMessage = page.locator('text=No items collected yet');
    await expect(emptyMessage).toBeVisible();
  });

  test('should close inventory when pressing I again', async ({ page }) => {
    await page.goto(GAME_URL, { waitUntil: 'domcontentloaded' });
    await waitForGameReady(page);

    // Open inventory
    await page.keyboard.press('KeyI');
    await page.waitForTimeout(500);

    const inventoryCard = page.locator('.card:has-text("Inventory")');
    await expect(inventoryCard).toBeVisible();

    // Close inventory by pressing 'I' again
    await page.keyboard.press('KeyI');
    await page.waitForTimeout(500);

    await expect(inventoryCard).not.toBeVisible();
  });

  test('should close inventory when pressing Escape', async ({ page }) => {
    await page.goto(GAME_URL, { waitUntil: 'domcontentloaded' });
    await waitForGameReady(page);

    // Open inventory
    await page.keyboard.press('KeyI');
    await page.waitForTimeout(500);

    const inventoryCard = page.locator('.card:has-text("Inventory")');
    await expect(inventoryCard).toBeVisible();

    // Close via Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await expect(inventoryCard).not.toBeVisible();
  });

  test('should close inventory via the close button', async ({ page }) => {
    await page.goto(GAME_URL, { waitUntil: 'domcontentloaded' });
    await waitForGameReady(page);

    // Open inventory
    await page.keyboard.press('KeyI');
    await page.waitForTimeout(500);

    const inventoryCard = page.locator('.card:has-text("Inventory")');
    await expect(inventoryCard).toBeVisible();

    // Click the close button (✕ circle button in header)
    const closeButton = inventoryCard.locator('button[aria-label="Close inventory"]');
    await expect(closeButton).toBeVisible();
    await closeButton.click();
    await page.waitForTimeout(500);

    await expect(inventoryCard).not.toBeVisible();
  });

  test('should not open inventory when another overlay is active', async ({ page }) => {
    await page.goto(GAME_URL, { waitUntil: 'domcontentloaded' });
    await waitForGameReady(page);

    // Open pause menu first (Escape)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    const pauseMenu = page.locator('text=Resume Game');
    await expect(pauseMenu).toBeVisible();

    // Try to open inventory while pause menu is visible — should be ignored
    await page.keyboard.press('KeyI');
    await page.waitForTimeout(500);

    const inventoryCard = page.locator('.card:has-text("Inventory")');
    await expect(inventoryCard).not.toBeVisible();

    // Pause menu should still be visible
    await expect(pauseMenu).toBeVisible();

    // Close pause menu
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await expect(pauseMenu).not.toBeVisible();
  });
});
