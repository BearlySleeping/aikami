// apps/e2e/tests/client/combat_sandbox.spec.ts
//
// C-146: Freeform AI Combat Actions — E2E verification.
//
// Verifies that the freeform text input renders in the combat UI,
// accepts a string, disables the UI upon submission, and that the
// custom action flow completes (mock dev VM simulates AI response).
//
// Uses the /dev/combat route with CombatDevViewModel — no game
// engine required.

import { expect, test } from '@playwright/test';

const COMBAT_DEV_URL = 'http://localhost:5274/dev/combat';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Waits for the combat dev view to fully render with mock state.
 * The CombatDevViewModel injects mock combat data synchronously
 * on initialize, so we just wait for the attack button.
 */
const waitForCombatReady = async (page: import('@playwright/test').Page) => {
  await page.waitForSelector('[data-testid="combat-attack-btn"]', { timeout: 10000 });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Freeform AI Combat Actions (C-146)', () => {
  test('should render the custom action text input field', async ({ page }) => {
    await page.goto(COMBAT_DEV_URL, { waitUntil: 'domcontentloaded' });
    await waitForCombatReady(page);

    const input = page.locator('[data-testid="combat-custom-action-input"]');
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();
  });

  test('should render the Submit Action button', async ({ page }) => {
    await page.goto(COMBAT_DEV_URL, { waitUntil: 'domcontentloaded' });
    await waitForCombatReady(page);

    const submitButton = page.locator('[data-testid="combat-custom-action-submit"]');
    await expect(submitButton).toBeVisible();

    // Submit button should be disabled when input is empty
    const input = page.locator('[data-testid="combat-custom-action-input"]');
    await input.fill('');
    await expect(submitButton).toBeDisabled();
  });

  test('should accept text input and enable submit button', async ({ page }) => {
    await page.goto(COMBAT_DEV_URL, { waitUntil: 'domcontentloaded' });
    await waitForCombatReady(page);

    const input = page.locator('[data-testid="combat-custom-action-input"]');
    const submitButton = page.locator('[data-testid="combat-custom-action-submit"]');

    // Type a custom action
    await input.fill('I do a backflip and kick the slime!');

    // Verify the input value
    await expect(input).toHaveValue('I do a backflip and kick the slime!');

    // Submit button should be enabled when input has text
    await expect(submitButton).toBeEnabled();
  });

  test('should disable all combat buttons during custom action resolution', async ({ page }) => {
    await page.goto(COMBAT_DEV_URL, { waitUntil: 'domcontentloaded' });
    await waitForCombatReady(page);

    const input = page.locator('[data-testid="combat-custom-action-input"]');
    const submitButton = page.locator('[data-testid="combat-custom-action-submit"]');
    const attackButton = page.locator('[data-testid="combat-attack-btn"]');
    const defendButton = page.locator('[data-testid="combat-defend-btn"]');
    const fleeButton = page.locator('[data-testid="combat-flee-btn"]');

    // Fill the input and submit
    await input.fill('Test action');
    await submitButton.click();

    // During mock resolution (500ms delay in dev VM), buttons should be disabled
    // Attack/Defend/Flee buttons check isResolvingAiAction
    await expect(attackButton).toBeDisabled();
    await expect(defendButton).toBeDisabled();
    await expect(fleeButton).toBeDisabled();
    await expect(submitButton).toBeDisabled();

    // Wait for the mock AI resolution to complete
    await page.waitForTimeout(1000);

    // After resolution, buttons should be re-enabled
    await expect(attackButton).toBeEnabled();
    await expect(defendButton).toBeEnabled();
    await expect(fleeButton).toBeEnabled();

    // Input should be cleared after submission
    await expect(input).toHaveValue('');
  });

  test('should show interpreting spinner in submit button while resolving', async ({ page }) => {
    await page.goto(COMBAT_DEV_URL, { waitUntil: 'domcontentloaded' });
    await waitForCombatReady(page);

    const input = page.locator('[data-testid="combat-custom-action-input"]');
    const submitButton = page.locator('[data-testid="combat-custom-action-submit"]');

    await input.fill('Test action');

    // Click submit and immediately check for the spinner
    // The dev VM has a 500ms delay, so the spinner should be visible briefly
    await submitButton.click();

    // The button text should change to "Interpreting…" with a spinner
    // We can check that the loading spinner is present
    const spinner = submitButton.locator('.loading-spinner');
    await expect(spinner).toBeVisible();

    // Wait for resolution
    await page.waitForTimeout(1000);

    // Submit button should show the normal text again
    await expect(submitButton).toHaveText('✨ Submit Action');
  });

  test('should append custom action narrative to combat log', async ({ page }) => {
    await page.goto(COMBAT_DEV_URL, { waitUntil: 'domcontentloaded' });
    await waitForCombatReady(page);

    const input = page.locator('[data-testid="combat-custom-action-input"]');
    const submitButton = page.locator('[data-testid="combat-custom-action-submit"]');

    await input.fill('I do a backflip and kick the slime!');
    await submitButton.click();

    // Wait for mock resolution
    await page.waitForTimeout(1000);

    // The combat log should contain the dev mock narrative
    const combatLog = page.locator('ul.max-h-40');
    const logText = await combatLog.textContent();
    expect(logText).toContain('Dev Mock');
    expect(logText).toContain('You attempt');
  });

  test('should clear input after successful submission', async ({ page }) => {
    await page.goto(COMBAT_DEV_URL, { waitUntil: 'domcontentloaded' });
    await waitForCombatReady(page);

    const input = page.locator('[data-testid="combat-custom-action-input"]');
    const submitButton = page.locator('[data-testid="combat-custom-action-submit"]');

    await input.fill('Another cool move');
    await submitButton.click();

    // Wait for mock resolution
    await page.waitForTimeout(1000);

    // Input should be cleared
    await expect(input).toHaveValue('');
  });

  test('should handle empty input gracefully (submit disabled)', async ({ page }) => {
    await page.goto(COMBAT_DEV_URL, { waitUntil: 'domcontentloaded' });
    await waitForCombatReady(page);

    const input = page.locator('[data-testid="combat-custom-action-input"]');
    const submitButton = page.locator('[data-testid="combat-custom-action-submit"]');

    // Empty input
    await input.fill('');
    await expect(submitButton).toBeDisabled();

    // Whitespace-only input
    await input.fill('   ');
    await expect(submitButton).toBeDisabled();
  });

  test('should not show custom action input when combat has ended', async ({ page }) => {
    await page.goto(COMBAT_DEV_URL, { waitUntil: 'domcontentloaded' });
    await waitForCombatReady(page);

    // End the battle via the dev tools "End Battle (Victory)" button
    const endVictoryButton = page.locator('button', { hasText: 'End Battle (Victory)' });
    await endVictoryButton.click();
    await page.waitForTimeout(500);

    // After combat ends, the action input should not be visible
    // (it's inside {#if !viewModel.combatResult} block)
    const input = page.locator('[data-testid="combat-custom-action-input"]');
    await expect(input).not.toBeVisible();

    const submitButton = page.locator('[data-testid="combat-custom-action-submit"]');
    await expect(submitButton).not.toBeVisible();
  });

  test('should gatekeep invalid item-based actions and show DM reasoning (C-149)', async ({
    page,
  }) => {
    await page.goto(COMBAT_DEV_URL, { waitUntil: 'domcontentloaded' });
    await waitForCombatReady(page);

    const input = page.locator('[data-testid="combat-custom-action-input"]');
    const submitButton = page.locator('[data-testid="combat-custom-action-submit"]');

    // Type an action that tries to use an item the player doesn't have
    await input.fill('I drink a healing potion');
    await submitButton.click();

    // Wait for mock resolution (500ms dev VM delay)
    await page.waitForTimeout(1000);

    // The combat log should contain the gatekeeping response
    const combatLog = page.locator('ul.max-h-40');
    const logText = await combatLog.textContent();

    // The 🚫 gatekeeping indicator should appear
    expect(logText).toContain('🚫');

    // The invalid reason should mention empty inventory
    expect(logText).toContain('inventory is empty');

    // The narrative should be visible too
    expect(logText).toContain('fingers grasping');

    // The attack button should be re-enabled (turn was NOT consumed)
    const attackButton = page.locator('[data-testid="combat-attack-btn"]');
    await expect(attackButton).toBeEnabled();

    // Input should be cleared
    await expect(input).toHaveValue('');
  });
});
