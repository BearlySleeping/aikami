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
    await inventory.gotoGame();
  });

  test('should open inventory overlay when pressing I', async () => {
    await inventory.toggle();
    await inventory.expectOpen();
    await inventory.expectEmpty();
  });

  test('should close inventory when pressing I again', async () => {
    await inventory.toggle();
    await inventory.expectOpen();
    await inventory.toggle();
    await inventory.expectClosed();
  });

  test('should close inventory when pressing Escape', async () => {
    await inventory.toggle();
    await inventory.expectOpen();
    await inventory.close();
    await inventory.expectClosed();
  });

  test('should close inventory via the close button', async () => {
    await inventory.toggle();
    await inventory.expectOpen();

    const closeButton = inventory.closeButton;
    await expect(closeButton).toBeVisible();
    await closeButton.click();
    await inventory.page.waitForTimeout(500);

    await inventory.expectClosed();
  });

  test('should open inventory over the pause menu through the shared management host', async () => {
    await inventory.close();
    const pauseMenu = inventory.page.getByRole('button', { name: 'Resume Game', exact: true });
    await expect(pauseMenu).toBeVisible();

    await inventory.toggle();
    await inventory.expectOpen();
    await expect(pauseMenu).not.toBeVisible();
    await expect(inventory.closeButton).toContainText('Back to pause menu');

    await inventory.closeButton.click();
    await expect(pauseMenu).toBeVisible();
  });
});
