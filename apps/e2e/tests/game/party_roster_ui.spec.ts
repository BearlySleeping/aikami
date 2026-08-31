// apps/e2e/tests/game/party_roster_ui.spec.ts
//
// E2E tests for the party roster overlay and HUD widget — empty-state
// rendering, keyboard open/close, and reload survival.
//
// These only exercise the empty-roster path: recruiting a companion
// requires walking up to a content-pack NPC and completing a dialogue
// tree, which needs a dedicated fixture/map and is not covered here.
// AC-1 (recruit/dismiss), AC-2 (formation follow), and AC-4 (combat)
// still need that fixture before they can get real E2E coverage.
//
// Contract: C-340 Build Party and Companion Gameplay (AC-3, AC-5)

import { expect, test } from '@playwright/test';

test.describe('Party Roster UI (empty roster)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/game');
    // Loading overlay covers the canvas until the engine is ready.
    await page.waitForSelector('#game-canvas-container', { state: 'attached', timeout: 15000 });
    const loadingText = page.getByText('Loading game engine...');
    await loadingText.waitFor({ state: 'hidden', timeout: 15000 });
  });

  test('party HUD widget is hidden when the roster is empty', async ({ page }) => {
    const hudButton = page.locator('[aria-label="Open party roster"]');
    await expect(hudButton).not.toBeVisible();
  });

  test('P key opens the party roster overlay showing the empty state', async ({ page }) => {
    await page.keyboard.press('KeyP');

    const overlay = page.locator('[aria-label="Party Roster"]');
    await expect(overlay).toBeVisible();
    await expect(page.getByText('No companions')).toBeVisible();
  });

  test('Escape closes the party roster overlay', async ({ page }) => {
    await page.keyboard.press('KeyP');
    const overlay = page.locator('[aria-label="Party Roster"]');
    await expect(overlay).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(overlay).not.toBeVisible();
  });

  test('the overlay can be reopened after closing', async ({ page }) => {
    const overlay = page.locator('[aria-label="Party Roster"]');

    await page.keyboard.press('KeyP');
    await expect(overlay).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overlay).not.toBeVisible();

    await page.keyboard.press('KeyP');
    await expect(overlay).toBeVisible();
  });

  test('an empty roster still opens cleanly after a page reload', async ({ page }) => {
    await page.reload();
    await page.waitForSelector('#game-canvas-container', { state: 'attached', timeout: 15000 });
    await page.getByText('Loading game engine...').waitFor({ state: 'hidden', timeout: 15000 });

    await page.keyboard.press('KeyP');
    await expect(page.locator('[aria-label="Party Roster"]')).toBeVisible();
    await expect(page.getByText('No companions')).toBeVisible();
  });
});
