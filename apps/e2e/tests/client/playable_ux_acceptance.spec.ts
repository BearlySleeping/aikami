// apps/e2e/tests/client/playable_ux_acceptance.spec.ts
//
// Playable UX acceptance on the PRODUCTION /game route.
//
// Everything here is a product contract a player can actually exercise, not an
// internal seam:
//
//   • a keyboard-only player can open the Pause Menu, is placed on the primary
//     action, cannot Tab out of the dialog, and gets their focus back on close;
//   • the manual save reports a real outcome AND a real timestamp;
//   • HUD customization still opens from — and returns to — the Pause Menu.
//
// Selectors come from the POM (`apps/e2e/src/pom/pause_menu.ts`) so a label
// change fails here loudly instead of silently binding to HUD copy.

import { expect, test } from '@playwright/test';
import {
  GamePage,
  isFocusInsidePauseMenu,
  pauseMenuCustomizeHudButton,
  pauseMenuDialog,
  pauseMenuResumeButton,
  pauseMenuSaveStatus,
} from '$pom';

test.describe('Playable UX acceptance — Pause Menu on the production route', () => {
  test('a keyboard-only open lands on Resume and Tab/Shift+Tab stay in the dialog', async ({
    page,
  }) => {
    const game = new GamePage(page);
    await game.goto();
    await game.waitForPlayingState();

    await page.keyboard.press('Escape');
    await expect(pauseMenuDialog(page)).toBeVisible({ timeout: 5_000 });
    // Landed on the primary action, not the dialog scrim.
    await expect(pauseMenuResumeButton(page)).toBeFocused({ timeout: 5_000 });

    for (let index = 0; index < 8; index += 1) {
      await page.keyboard.press('Tab');
      expect(await isFocusInsidePauseMenu(page)).toBe(true);
    }
    for (let index = 0; index < 8; index += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await isFocusInsidePauseMenu(page)).toBe(true);
    }

    // Closing returns the keyboard to the game surface, not to <body>.
    await page.keyboard.press('Escape');
    await expect(pauseMenuDialog(page)).toBeHidden({ timeout: 5_000 });
    await expect(page.locator('#game-canvas-container')).toBeFocused({ timeout: 5_000 });
  });

  test('a manual save reports the outcome and the real save timestamp', async ({ page }) => {
    const game = new GamePage(page);
    await game.goto();
    await game.waitForPlayingState();

    await game.openPauseMenu();
    // Before any save the menu is honest about having nothing persisted.
    await expect(pauseMenuSaveStatus(page)).toContainText('Not saved yet', { timeout: 5_000 });

    await game.saveGame();

    // Re-opening shows the persisted timestamp — the outcome survived the close.
    await game.openPauseMenu();
    await expect(pauseMenuSaveStatus(page)).toContainText('Game Saved!', { timeout: 10_000 });
    await expect(pauseMenuSaveStatus(page)).toContainText('Last saved', { timeout: 10_000 });
  });

  test('HUD customization opens from the Pause Menu and returns to it', async ({ page }) => {
    const game = new GamePage(page);
    await game.goto();
    await game.waitForPlayingState();

    await game.openPauseMenu();
    const customize = pauseMenuCustomizeHudButton(page);
    await expect(customize).toBeEnabled({ timeout: 5_000 });
    await customize.click();

    const editor = page.getByTestId('hud-editor');
    await expect(editor).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('hud-editor-close').click();
    // Ownership is preserved: the paused editor returns to the same dialog.
    await expect(pauseMenuDialog(page)).toBeVisible({ timeout: 10_000 });
    await expect(pauseMenuResumeButton(page)).toBeVisible({ timeout: 5_000 });
  });
});
