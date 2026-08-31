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
import { GamePage, PartyRosterPage } from '$pom';

test.describe('Party Roster UI (empty roster)', () => {
  let game: GamePage;
  let partyRoster: PartyRosterPage;

  test.beforeEach(async ({ page }) => {
    game = new GamePage(page);
    partyRoster = new PartyRosterPage(page);
    await game.goto();
    await game.waitForPlayingState();
  });

  test('party HUD widget is hidden when the roster is empty', async () => {
    await expect(partyRoster.hudButton).not.toBeVisible();
  });

  test('P key opens the party roster overlay showing the empty state', async () => {
    await partyRoster.open();

    await expect(partyRoster.overlay).toBeVisible();
    await expect(partyRoster.emptyState).toBeVisible();
  });

  test('Escape closes the party roster overlay', async () => {
    await partyRoster.open();
    await expect(partyRoster.overlay).toBeVisible();

    await partyRoster.close();
    await expect(partyRoster.overlay).not.toBeVisible();
  });

  test('the overlay can be reopened after closing', async () => {
    await partyRoster.open();
    await expect(partyRoster.overlay).toBeVisible();
    await partyRoster.close();
    await expect(partyRoster.overlay).not.toBeVisible();

    await partyRoster.open();
    await expect(partyRoster.overlay).toBeVisible();
  });

  test('an empty roster still opens cleanly after a page reload', async () => {
    await game.reload();

    await partyRoster.open();
    await expect(partyRoster.overlay).toBeVisible();
    await expect(partyRoster.emptyState).toBeVisible();
  });
});
