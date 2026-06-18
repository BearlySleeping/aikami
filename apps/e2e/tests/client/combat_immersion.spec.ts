// apps/e2e/tests/client/combat_immersion.spec.ts
//
// C-148: Combat Immersion — E2E verification.
//
// Verifies:
// - Visual d20 dice UI mounts and shows rolling animation
// - Scene image generation button works (dev sandbox mock)
// - Enemy quotes appear in combat log (dev sandbox mock)
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
 */
const waitForCombatReady = async (page: import('@playwright/test').Page) => {
  await page.waitForSelector('[data-testid="combat-attack-btn"]', { timeout: 10000 });
};

/**
 * Triggers a custom action and waits for the mock AI resolution to complete.
 */
const submitCustomAction = async (
  page: import('@playwright/test').Page,
  prompt: string,
) => {
  const input = page.locator('[data-testid="combat-custom-action-input"]');
  const submitButton = page.locator('[data-testid="combat-custom-action-submit"]');

  await input.fill(prompt);
  await submitButton.click();

  // Wait for mock AI resolution (500ms dev VM delay + buffer)
  await page.waitForTimeout(1000);
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Combat Immersion (C-148)', () => {
  // ── Dice UI ───────────────────────────────────────────────────────────

  test('should show dice roll overlay when attacking', async ({ page }) => {
    await page.goto(COMBAT_DEV_URL, { waitUntil: 'domcontentloaded' });
    await waitForCombatReady(page);

    const attackButton = page.locator('[data-testid="combat-attack-btn"]');
    await attackButton.click();

    // The dice overlay should appear (dev VM triggers _mockDiceRoll immediately)
    const diceOverlay = page.locator('.dice-roll-overlay');
    await expect(diceOverlay).toBeVisible({ timeout: 2000 });

    // The d20 die should be spinning
    const spinningDie = page.locator('.d20-spinning');
    await expect(spinningDie).toBeVisible();

    // Wait for animation to complete (~1.5s)
    await page.waitForTimeout(2000);

    // The final value should be visible after animation
    const revealedDie = page.locator('.d20-reveal');
    await expect(revealedDie).toBeVisible();

    // The value should be a number between 1-20
    const valueEl = page.locator('.d20-value');
    const valueText = await valueEl.textContent();
    const value = Number.parseInt(valueText ?? '', 10);
    expect(value).toBeGreaterThanOrEqual(1);
    expect(value).toBeLessThanOrEqual(20);
  });

  test('should show dice roll on custom action submission', async ({ page }) => {
    await page.goto(COMBAT_DEV_URL, { waitUntil: 'domcontentloaded' });
    await waitForCombatReady(page);

    await submitCustomAction(page, 'I swing my sword at the goblin!');

    // The dice overlay should have appeared during mock resolution
    // (dev VM triggers _mockDiceRoll inside executeCustomAction override)
    const diceOverlay = page.locator('.dice-roll-overlay');
    await expect(diceOverlay).toBeVisible({ timeout: 2000 });

    // Wait for dice animation to complete
    await page.waitForTimeout(2000);

    // After animation, should see the final result
    const revealedDie = page.locator('.d20-reveal');
    await expect(revealedDie).toBeVisible();
  });

  test('should show HIT or MISS label after dice animation', async ({ page }) => {
    await page.goto(COMBAT_DEV_URL, { waitUntil: 'domcontentloaded' });
    await waitForCombatReady(page);

    const attackButton = page.locator('[data-testid="combat-attack-btn"]');
    await attackButton.click();

    // Wait for animation to complete
    await page.waitForTimeout(2000);

    // Either HIT! or MISS should be visible
    const resultLabel = page.locator('.dice-container .text-lg').first();
    const resultText = await resultLabel.textContent();
    expect(['HIT!', 'MISS'].includes(resultText?.trim() ?? '')).toBe(true);
  });

  // ── Scene Image Generation ────────────────────────────────────────────

  test('should render the Generate Scene button', async ({ page }) => {
    await page.goto(COMBAT_DEV_URL, { waitUntil: 'domcontentloaded' });
    await waitForCombatReady(page);

    const generateButton = page.locator('[data-testid="combat-generate-scene-btn"]');
    await expect(generateButton).toBeVisible();
    await expect(generateButton).toBeEnabled();
  });

  test('should hide Generate Scene button when combat has ended', async ({ page }) => {
    await page.goto(COMBAT_DEV_URL, { waitUntil: 'domcontentloaded' });
    await waitForCombatReady(page);

    // End the battle
    const endVictoryButton = page.locator('button', { hasText: 'End Battle (Victory)' });
    await endVictoryButton.click();
    await page.waitForTimeout(500);

    // Generate Scene button should not be visible (inside {#if !viewModel.combatResult} block)
    const generateButton = page.locator('[data-testid="combat-generate-scene-btn"]');
    await expect(generateButton).not.toBeVisible();
  });

  // ── Enemy Quotes ──────────────────────────────────────────────────────

  test('should show enemy quotes in combat log from custom actions', async ({ page }) => {
    await page.goto(COMBAT_DEV_URL, { waitUntil: 'domcontentloaded' });
    await waitForCombatReady(page);

    // Submit multiple custom actions to increase chance of seeing an enemy quote
    // (dev VM has ~60% chance of including a quote per action)
    for (let i = 0; i < 5; i++) {
      await submitCustomAction(page, `I attack with my sword! (attempt ${i + 1})`);
    }

    // Check combat log for enemy quote (italicized *Goblin "..."* format)
    const combatLog = page.locator('ul.max-h-40');
    const logText = await combatLog.textContent();

    // Look for enemy quote markers — "Goblin" in asterisks
    const hasEnemyQuote = logText?.includes('*Goblin') ?? false;
    // After 5 attempts with ~60% chance each, probability of at least 1 > 99%
    expect(hasEnemyQuote).toBe(true);
  });

  // ── Full flow: dice + quote + log append ──────────────────────────────

  test('should complete full immersion flow: custom action → dice → quote → log', async ({
    page,
  }) => {
    await page.goto(COMBAT_DEV_URL, { waitUntil: 'domcontentloaded' });
    await waitForCombatReady(page);

    // Submit a custom action that should trigger everything
    await submitCustomAction(page, 'I do a backflip and kick the goblin into the fire!');

    // Dice overlay should have appeared
    const diceOverlay = page.locator('.dice-roll-overlay');
    await expect(diceOverlay).toBeVisible({ timeout: 2000 });

    // Wait for dice animation
    await page.waitForTimeout(2000);

    // Combat log should contain the custom action narrative
    const combatLog = page.locator('ul.max-h-40');
    const logText = await combatLog.textContent();
    expect(logText).toContain('backflip');
    expect(logText).toContain('Dev Mock');

    // Submit button should be re-enabled after resolution
    const submitButton = page.locator('[data-testid="combat-custom-action-submit"]');
    await expect(submitButton).toBeEnabled();
  });
});
