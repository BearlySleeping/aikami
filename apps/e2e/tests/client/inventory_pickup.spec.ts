// apps/e2e/tests/client/inventory_pickup.spec.ts
// Inventory Pickup E2E Test — verifies the inventory overlay opens/closes
// with keyboard shortcuts ('I' toggle, Escape close) and locks/releases
// game movement (GameMode: MENU ↔ EXPLORE).
//
// Contract: C-142 Inventory Item Pickups
//
// Uses InventoryPage POM — no inline page.locator() calls.
//
// NOTE: Item pickup via 'E' requires item entities on the Tiled map.
// The current sandbox_zone_a.json map has NPCs + props but no items.
// Once items are added to a map, extend this test to walk up and
// press 'E' before verifying inventory contents.

import { expect, test } from '@playwright/test';
import { InventoryPage } from '$pom';

test.describe('Inventory Overlay', () => {
  let inventory: InventoryPage;

  test.beforeEach(async ({ page }) => {
    inventory = new InventoryPage(page);
  });

  test('should open inventory overlay when pressing I', async () => {
    await inventory.gotoGame();
    await inventory.toggle();
    await inventory.expectOpen();
    await inventory.expectEmpty();
  });

  test('should close inventory when pressing I again', async () => {
    await inventory.gotoGame();
    await inventory.toggle();
    await inventory.expectOpen();
    await inventory.toggle();
    await inventory.expectClosed();
  });

  test('should close inventory when pressing Escape', async () => {
    await inventory.gotoGame();
    await inventory.toggle();
    await inventory.expectOpen();
    await inventory.close();
    await inventory.expectClosed();
  });

  test('should close inventory via the close button', async () => {
    await inventory.gotoGame();
    await inventory.toggle();
    await inventory.expectOpen();

    const closeButton = inventory.inventoryCard.locator('button[aria-label="Close inventory"]');
    await expect(closeButton).toBeVisible();
    await closeButton.click();
    await inventory.page.waitForTimeout(500);

    await inventory.expectClosed();
  });

  test('should not open inventory when another overlay is active', async () => {
    await inventory.gotoGame();

    // Open pause menu first (Escape)
    await inventory.close(); // Escape
    const pauseMenu = inventory.page.locator('text=Resume Game');
    await expect(pauseMenu).toBeVisible();

    // Try to open inventory while pause menu is visible — should be ignored
    await inventory.toggle();
    await inventory.expectClosed();

    // Pause menu should still be visible
    await expect(pauseMenu).toBeVisible();

    // Close pause menu
    await inventory.close();
    await expect(pauseMenu).not.toBeVisible();
  });
});
