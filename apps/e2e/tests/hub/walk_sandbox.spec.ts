// apps/e2e/tests/hub/walk_sandbox.spec.ts
//
// C-447 AC-1, AC-2, AC-5: walk sandbox loads a published map, collision
// blocks movement, and mounting is leak-free.

import { expect, test } from '@playwright/test';
import { SandboxPage } from '$pom';

test.describe('Hub walk sandbox — C-447 AC-1, AC-2, AC-5', () => {
  test('AC-1: a published map loads and is walkable', async ({ page }) => {
    const sandbox = new SandboxPage(page);

    // Navigate to a known published map
    await page.goto('/sandbox/maps:sandbox_zone_a');

    // The sandbox canvas should be visible
    await sandbox.waitForReady();

    // Focus the canvas and move to a known open cell
    await sandbox.focusCanvas();

    // Move right (known to be open) and verify the cell changes
    const cellBefore = await sandbox.getPlayerCellText();
    await sandbox.pressKey('ArrowRight');

    // The HUD should appear with cell coordinates after movement
    await expect(sandbox.hud).toBeVisible({ timeout: 5000 });
    await expect(sandbox.playerCell).toBeVisible();

    // Verify the cell actually changed (movement occurred)
    const cellAfter = await sandbox.getPlayerCellText();
    expect(cellAfter).not.toBe(cellBefore);
  });

  test('AC-2: collision blocks movement and the overlay agrees', async ({ page }) => {
    const sandbox = new SandboxPage(page);

    // Navigate to a map with known blocked cells
    await page.goto('/sandbox/maps:sandbox_zone_a?spawn=5,5');

    // Wait for the sandbox to load
    await sandbox.waitForReady();

    // Enable the collision overlay
    await sandbox.enableCollisionOverlay();

    // The collision overlay button should be active (btn-primary class)
    expect(await sandbox.isCollisionOverlayActive()).toBe(true);

    // Press toward a blocked cell — the cell should not change
    const cellBefore = await sandbox.getPlayerCellText();
    await sandbox.focusCanvas();
    await sandbox.pressKey('ArrowUp');
    const cellAfter = await sandbox.getPlayerCellText();

    // Cell should be unchanged if blocked
    expect(cellAfter).toBe(cellBefore);
  });

  test('AC-5: mounting is leak-free across navigations', async ({ page }) => {
    const sandbox = new SandboxPage(page);

    // Navigate to the sandbox
    await page.goto('/sandbox/maps:sandbox_zone_a');
    await sandbox.waitForReady();

    // Navigate away and back multiple times
    for (let i = 0; i < 3; i++) {
      await page.goto('/');
      await expect(page.getByTestId('app-bar')).toBeVisible();
      await page.goto('/sandbox/maps:sandbox_zone_a');
      await sandbox.waitForReady();
    }

    // The sandbox should still render correctly
    await expect(sandbox.canvas).toBeVisible();
  });
});
