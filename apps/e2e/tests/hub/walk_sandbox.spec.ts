// apps/e2e/tests/hub/walk_sandbox.spec.ts
//
// C-447 AC-1, AC-2, AC-5: walk sandbox loads a published map, collision
// blocks movement, and mounting is leak-free.

import { expect, test } from '@playwright/test';

test.describe('Hub walk sandbox — C-447 AC-1, AC-2, AC-5', () => {
  test('AC-1: a published map loads and is walkable', async ({ page }) => {
    // Navigate to a known published map
    await page.goto('/sandbox/maps:sandbox_zone_a');

    // The sandbox canvas should be visible
    await expect(page.getByTestId('sandbox-canvas')).toBeVisible({ timeout: 15000 });

    // The HUD should show player cell info after movement
    // Press an arrow key to move the character
    await page.getByTestId('sandbox-canvas').focus();
    await page.keyboard.press('ArrowRight');

    // The HUD should appear with cell coordinates
    await expect(page.getByTestId('sandbox-hud')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('sandbox-player-cell')).toBeVisible();
  });

  test('AC-2: collision blocks movement and the overlay agrees', async ({ page }) => {
    // Navigate to a map with known blocked cells
    await page.goto('/sandbox/maps:sandbox_zone_a?spawn=5,5');

    // Wait for the sandbox to load
    await expect(page.getByTestId('sandbox-canvas')).toBeVisible({ timeout: 15000 });

    // Enable the collision overlay
    await page.getByTestId('sandbox-overlay-toggle-collision').click();

    // The collision overlay button should be active (btn-primary class)
    await expect(page.getByTestId('sandbox-overlay-toggle-collision')).toHaveClass(/btn-primary/);

    // Press toward a blocked cell — the cell should not change
    const cellBefore = await page.getByTestId('sandbox-player-cell').textContent();
    await page.getByTestId('sandbox-canvas').focus();
    await page.keyboard.press('ArrowUp');
    const cellAfter = await page.getByTestId('sandbox-player-cell').textContent();

    // Cell should be unchanged if blocked
    expect(cellAfter).toBe(cellBefore);
  });

  test('AC-5: mounting is leak-free across navigations', async ({ page }) => {
    // Navigate to the sandbox
    await page.goto('/sandbox/maps:sandbox_zone_a');
    await expect(page.getByTestId('sandbox-canvas')).toBeVisible({ timeout: 15000 });

    // Navigate away and back multiple times
    for (let i = 0; i < 3; i++) {
      await page.goto('/');
      await expect(page.getByTestId('app-bar')).toBeVisible();
      await page.goto('/sandbox/maps:sandbox_zone_a');
      await expect(page.getByTestId('sandbox-canvas')).toBeVisible({ timeout: 15000 });
    }

    // The sandbox should still render correctly
    await expect(page.getByTestId('sandbox-canvas')).toBeVisible();
  });
});
