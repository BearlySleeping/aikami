// apps/e2e/tests/client/combat_sandbox.spec.ts
//
// C-146: Freeform AI Combat Actions — E2E verification.
// C-149: Combat Mechanics & AI Gatekeeping
//
// Uses the CombatPage POM for all combat UI interactions.
// No inline page.locator() calls — strict POM adherence.

import { expect, test } from '@playwright/test';
import { CombatPage } from '$pom';

test.describe('Freeform AI Combat Actions (C-146)', () => {
  let combat: CombatPage;

  test.beforeEach(async ({ page }) => {
    combat = new CombatPage(page);
    await combat.gotoDev();
  });

  test('should render the custom action text input field', async () => {
    await expect(combat.customActionInput).toBeVisible();
    await expect(combat.customActionInput).toBeEnabled();
  });

  test('should render the Submit Action button', async () => {
    await expect(combat.customActionSubmit).toBeVisible();
    await combat.typeCustomAction('');
    await expect(combat.customActionSubmit).toBeDisabled();
  });

  test('should accept text input and enable submit button', async () => {
    await combat.typeCustomAction('I do a backflip and kick the slime!');
    await expect(combat.customActionInput).toHaveValue('I do a backflip and kick the slime!');
    await expect(combat.customActionSubmit).toBeEnabled();
  });

  test('should disable all combat buttons during custom action resolution', async () => {
    await combat.typeCustomAction('Test action');
    await combat.submitCustomAction();

    await expect(combat.attackButton).toBeDisabled();
    await expect(combat.defendButton).toBeDisabled();
    await expect(combat.fleeButton).toBeDisabled();
    await expect(combat.customActionSubmit).toBeDisabled();

    await combat.page.waitForTimeout(1000);

    await expect(combat.attackButton).toBeEnabled();
    await expect(combat.defendButton).toBeEnabled();
    await expect(combat.fleeButton).toBeEnabled();
    await expect(combat.customActionInput).toHaveValue('');
  });

  test('should show interpreting spinner while resolving', async () => {
    await combat.typeCustomAction('Test action');
    await combat.submitCustomAction();

    const spinner = combat.customActionSubmit.locator('.loading-spinner');
    await expect(spinner).toBeVisible();

    await combat.page.waitForTimeout(1000);
    await expect(combat.customActionSubmit).toHaveText('✨ Submit Action');
  });

  test('should append custom action narrative to combat log', async () => {
    await combat.typeCustomAction('I do a backflip and kick the slime!');
    await combat.submitCustomAction();
    await combat.page.waitForTimeout(1000);

    await expect(combat.combatLog).toContainText('Dev Mock');
    await expect(combat.combatLog).toContainText('You attempt');
  });

  test('should clear input after successful submission', async () => {
    await combat.typeCustomAction('Another cool move');
    await combat.submitCustomAction();
    await combat.page.waitForTimeout(1000);
    await expect(combat.customActionInput).toHaveValue('');
  });

  test('should handle empty input gracefully (submit disabled)', async () => {
    await combat.typeCustomAction('');
    await expect(combat.customActionSubmit).toBeDisabled();
    await combat.typeCustomAction('   ');
    await expect(combat.customActionSubmit).toBeDisabled();
  });

  test('should not show custom action input when combat has ended', async () => {
    const endVictoryBtn = combat.page.locator('button', { hasText: 'End Battle (Victory)' });
    await endVictoryBtn.click();
    await combat.page.waitForTimeout(500);

    await expect(combat.customActionInput).not.toBeVisible();
    await expect(combat.customActionSubmit).not.toBeVisible();
  });

  test('should gatekeep invalid item-based actions (C-149)', async () => {
    await combat.typeCustomAction('I drink a healing potion');
    await combat.submitCustomAction();
    await combat.page.waitForTimeout(1000);

    const logText = await combat.combatLog.textContent();
    expect(logText).toContain('🚫');
    expect(logText).toContain('inventory is empty');
    expect(logText).toContain('fingers grasping');

    await expect(combat.attackButton).toBeEnabled();
    await expect(combat.customActionInput).toHaveValue('');
  });
});
