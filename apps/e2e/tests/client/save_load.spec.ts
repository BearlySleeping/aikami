// apps/e2e/tests/client/save_load.spec.ts
// C-132: Save/Load System — E2E validation of IndexedDB persistence flow.
//
// Verifies that the save button in the pause menu creates a snapshot that
// survives a page reload, and that the main menu "Continue" button loads
// the saved state and restores the game canvas.

import { expect } from '@playwright/test';
import { test } from '../../src/fixtures';

test.describe('Save/Load Persistence', () => {
  test('should save game from pause menu and survive page reload', async ({ authUser }) => {
    // ── Navigate to game and wait for initialization ──
    await authUser.goto('/game');
    await authUser.waitForTimeout(2000);

    // The game canvas should be mounted
    const canvas = authUser.locator('canvas');
    await expect(canvas).toBeAttached({ timeout: 10000 });

    // ── Open pause menu via Escape key ──
    await authUser.keyboard.press('Escape');
    await authUser.waitForTimeout(500);

    // Pause menu should be visible
    const pauseMenu = authUser.locator('[role="dialog"][aria-label="Pause Menu"]');
    await expect(pauseMenu).toBeVisible({ timeout: 5000 });

    // ── Click Save Game button ──
    const saveButton = pauseMenu.locator('button:has-text("Save Game")');
    await expect(saveButton).toBeVisible();
    await saveButton.click();

    // Wait for save confirmation message
    await authUser.waitForTimeout(1500);
    const saveMessage = pauseMenu.locator('text=Game Saved!');
    await expect(saveMessage).toBeVisible({ timeout: 5000 });

    // ── Close pause menu and navigate to main menu ──
    await authUser.keyboard.press('Escape');
    await authUser.waitForTimeout(500);

    // ── Reload the page (simulates app restart) ──
    await authUser.goto('/');
    await authUser.waitForTimeout(1500);

    // ── "Continue" button should be visible (save persisted in IndexedDB) ──
    const continueButton = authUser.locator('button:has-text("Continue")');
    await expect(continueButton).toBeVisible({ timeout: 5000 });

    // ── Click Continue to load the saved game ──
    await continueButton.click();
    await authUser.waitForTimeout(3000);

    // ── Game canvas should remount with the loaded state ──
    const reloadedCanvas = authUser.locator('canvas');
    await expect(reloadedCanvas).toBeAttached({ timeout: 15000 });

    // ── Open pause menu again to verify game is fully interactive ──
    await authUser.keyboard.press('Escape');
    await authUser.waitForTimeout(500);
    const pauseMenuAfterLoad = authUser.locator('[role="dialog"][aria-label="Pause Menu"]');
    await expect(pauseMenuAfterLoad).toBeVisible({ timeout: 5000 });
  });

  test('should not show Continue button when no saves exist', async ({ authUser }) => {
    // Navigate to main menu with fresh browser context (no IndexedDB data)
    await authUser.goto('/');
    await authUser.waitForTimeout(1500);

    // "Continue" button should NOT be visible (no saves in IndexedDB)
    const continueButton = authUser.locator('button:has-text("Continue")');
    await expect(continueButton).toHaveCount(0, { timeout: 5000 });

    // "Start" button should be visible
    const startButton = authUser.locator('button:has-text("Start")');
    await expect(startButton).toBeVisible({ timeout: 5000 });
  });
});
