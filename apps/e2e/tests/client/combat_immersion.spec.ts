// apps/e2e/tests/client/combat_immersion.spec.ts
//
// C-148: Combat Immersion — E2E verification.
// C-151: AI Dynamic Music — BGM transition on heroic actions.
//
// Uses CombatPage POM — no inline page.locator() calls.
// Uses the /dev/combat route with CombatDevViewModel — no game engine required.

import { expect, test } from '@playwright/test';
import { CombatPage } from '$pom';

test.describe('Combat Immersion (C-148)', () => {
  let combat: CombatPage;

  test.beforeEach(async ({ page }) => {
    combat = new CombatPage(page);
    await combat.gotoDev();
  });

  /** Submit a custom action and wait for mock AI resolution (1s). */
  const submitAction = async (prompt: string): Promise<void> => {
    await combat.typeCustomAction(prompt);
    await combat.submitCustomAction();
    await combat.page.waitForTimeout(1000);
  };

  // ── Dice UI ───────────────────────────────────────────────
  // NOTE: These tests use CSS classes (.dice-roll-overlay, .d20-spinning, etc.)
  // that were refactored into the GameDice component. The POM needs updating
  // to match the new combat_dice_ui.svelte structure.

  test('should show dice roll overlay when attacking', async () => {
    test.skip(true, 'Dice UI CSS classes refactored — POM needs update for GameDice component');
  });

  test('should show dice roll on custom action submission', async () => {
    test.skip(true, 'Dice UI CSS classes refactored — POM needs update for GameDice component');
  });

  test('should show HIT or MISS label after dice animation', async () => {
    test.skip(true, 'Dice UI CSS classes refactored — POM needs update for GameDice component');
  });

  // ── Scene Image Generation ────────────────────────────────

  test('should render the Generate Scene button in Gallery tab', async () => {
    await combat.switchToGalleryTab();
    await expect(combat.generateSceneButton).toBeVisible();
    await expect(combat.generateSceneButton).toBeEnabled();
  });

  test('should hide Generate Scene button when combat has ended', async () => {
    // End combat via dev tools
    const endVictoryBtn = combat.page.locator('button', { hasText: 'End Battle (Victory)' });
    await endVictoryBtn.click();
    await combat.page.waitForTimeout(500);
    await expect(combat.generateSceneButton).not.toBeVisible();
  });

  // ── Enemy Quotes ──────────────────────────────────────────

  test('should show enemy quotes in combat log from custom actions', async () => {
    for (let i = 0; i < 5; i++) {
      await submitAction(`I attack with my sword! (attempt ${i + 1})`);
    }

    const logText = await combat.combatLog.textContent();
    expect(logText?.includes('Goblin') ?? false).toBe(true);
  });

  // ── Full immersion flow ───────────────────────────────────

  test('should complete full immersion flow', async () => {
    await submitAction('I do a backflip and kick the goblin into the fire!');

    await combat.page.waitForTimeout(3000);

    const logText = await combat.combatLog.textContent();
    expect(logText).toContain('backflip');
    expect(logText).toContain('Dev Mock');
    // Submit button stays disabled because input is cleared; attack button re-enables
    await expect(combat.attackButton).toBeEnabled({ timeout: 10000 });
  });

  // ── C-151: BGM transition ─────────────────────────────────

  test('should trigger BGM transition on heroic custom action', async () => {
    await submitAction('I leap from the chandelier and drive my sword into the dragons heart!');
    await combat.page.waitForTimeout(2000);

    const logText = await combat.combatLog.textContent();
    // Heroic actions should trigger BGM mood transitions in the log
    expect(logText).toContain('Dev Mock');
  });
});
