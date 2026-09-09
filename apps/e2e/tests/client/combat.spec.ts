// apps/e2e/tests/client/combat.spec.ts
//
// C-500: Combat Overlay Rendering and Engine Stall — production journey.
//
// Proves the combat overlay actually MOUNTS in the production /game route
// (previously combat pushed the COMBAT overlay and paused the engine, but
// game_ui_view.svelte had no COMBAT branch, so no battle UI ever rendered
// and the input-locked world read as a hard freeze).
//
//   AC-1  → combat UI renders in production (portrait stage, turn tracker,
//           dice, action controls) instead of a frozen world.
//   AC-3  → the fight resolves to victory/defeat and the player returns to
//           EXPLORE with the engine running (combat overlay dismissed).
//
// This intentionally shares the release-gate locomotion/combat primitives
// (GamePage POM) but is scoped to the combat journey so regressions in the
// mount or the exit path surface here.

import { expect, test } from '@playwright/test';
import { GamePage } from '$pom';

test.describe('Combat Overlay Rendering & Engine Stall (C-500)', () => {
  let game: GamePage;

  // ── Shared: cold-launch into the /game route ────────────────────────
  const bootIntoGame = async (page: import('@playwright/test').Page) => {
    game = new GamePage(page);
    await page.goto('http://localhost:5274/', { waitUntil: 'domcontentloaded' });
    await game.startNewAdventure();
    await page.waitForURL(/\/(setup|game)/, { timeout: 15_000 });
    if (page.url().includes('/setup')) {
      for (let i = 0; i < 8; i++) {
        if (page.url().includes('/game')) {
          break;
        }
        const nextBtn = page.getByRole('button', { name: /next|continue|finish|start/i });
        if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await nextBtn.click();
          await page.waitForTimeout(500);
        } else {
          break;
        }
      }
      expect(page.url()).toContain('/game');
    }
    await game.waitForEngineReady();
    await game.waitForPlayingState();
    await expect(game.canvas).toBeAttached();
    await expect(game.canvas).toBeVisible();
  };

  test('AC-1 + AC-3: combat mounts, resolves, and exits back to EXPLORE', async ({ page }) => {
    await bootIntoGame(page);

    // ── Enter dialogue with the NPC ──
    await game.approachAndTalkToNpc();
    await game.expectDialogueVisible();
    await game.skipDialogue();

    // ── Combat triggers (via combat chip / auto-trigger after dialogue) ──
    await page.waitForTimeout(2000);
    await game.expectCombatActive();

    // AC-1: the full battle UI is mounted — portrait stage, HP text, and
    // the action controls. (The turn tracker + dice are children of the
    // mounted CombatView; the attack button is the mount's leading edge.)
    await game.expectCombatUiVisible();

    // ── Resolve the fight (attack until the engine emits COMBAT_ENDED) ──
    for (let round = 0; round < 20; round++) {
      if (!(await game.isCombatAttackButtonVisible())) {
        break;
      }
      await game.waitForCombatActionReady();
      await game.clickAttack();
      await page.waitForTimeout(1000);
    }
    await game.expectCombatEnded();

    // AC-3: victory/defeat resolves and the combat overlay dismisses —
    // return to EXPLORE with the world running again.
    await page.waitForTimeout(3000);
    await expect(page.locator('[data-testid="combat-attack-btn"]')).toBeHidden({
      timeout: 15_000,
    });
    await game.waitForPlayingState();
  });
});
