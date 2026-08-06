// apps/e2e/tests/client/quest_flow.spec.ts
//
// E2E tests for the active-quest overlay + the default Emberwatch quest
// (The Fading Ward). Covers:
//   - The quest overlay renders an empty-state hint on /game.
//   - Accepting the default quest (dev sandbox action) populates the
//     overlay and auto-completes the opening objective.
//   - Obtaining the Ward Wand (giveItem wiring → ITEM_PICKED_UP) advances
//     the current objective to "Return the Ward Wand".
//   - The overlay can be hidden via its ✕ button.
//
// The dev-sandbox route is used for deterministic quest seeding — the
// production NPC-walking flow is covered structurally by other specs.

import { expect, test } from '@playwright/test';

const QUEST_OVERLAY = '[data-testid="quest-overlay"]';

/**
 * Waits for the sandbox game to be fully booted (engine playing + HUD up)
 * before clicking quest dev actions. Clicking before the composition root
 * configures questStateService would silently no-op.
 */
const waitForSandboxReady = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.waitForSelector('#game-canvas-container canvas', { timeout: 30_000 });
  // Loading overlay disappears when boot completes (quest service configured).
  await page
    .getByText('Loading game engine...')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => {});
  // Player HUD visible = engine in playing state.
  await page.locator('.bg-base-200\\/80').first().waitFor({ state: 'visible', timeout: 20_000 });
  // Let the boot pipeline settle after HUD appears.
  await page.waitForTimeout(1500);
};

test.describe('Quest System — active quest overlay', () => {
  // The sandbox boots a full WebGL engine per test — running these in
  // parallel workers starves the headless GPU context and stalls map
  // transitions. Serial keeps them in one worker.
  test.describe.configure({ mode: 'serial' });

  test('shows the empty-state hint on /game when no quest is active', async ({ page }) => {
    await page.goto('/game');
    await page.waitForSelector('#game-canvas-container canvas', { timeout: 30_000 });

    const overlay = page.locator(QUEST_OVERLAY);
    await expect(overlay).toBeVisible({ timeout: 15_000 });
    await expect(overlay.getByText(/no active quest/i).first()).toBeVisible();
  });

  test('accepting the default quest populates the overlay and auto-completes the opening objective', async ({
    page,
  }) => {
    await page.goto('/dev/sandbox');
    await waitForSandboxReady(page);

    // Accept the default quest from the elder via the dev action.
    await page.locator('[data-testid="dev-action-accept-default-quest-fading-ward"]').click();

    const overlay = page.locator(QUEST_OVERLAY);
    await expect(overlay).toBeVisible({ timeout: 10_000 });
    await expect(overlay.getByText('The Fading Ward')).toBeVisible();

    // The opening objective is auto-completed; the current step is the inn.
    await expect(overlay.getByText('Ask Elder Thalia about the failing ward')).toBeVisible();
    await expect(overlay.locator('[aria-current="step"]')).toContainText(
      "Find the Ward Wand's keeper at the inn",
    );
  });

  test('obtaining the Ward Wand advances the current objective', async ({ page }) => {
    await page.goto('/dev/sandbox');
    await waitForSandboxReady(page);

    await page.locator('[data-testid="dev-action-accept-default-quest-fading-ward"]').click();
    const overlay = page.locator(QUEST_OVERLAY);
    await expect(overlay.getByText('The Fading Ward')).toBeVisible({ timeout: 10_000 });

    // Enter the inn (fires MAP_ENTERED, unlocking the wand objective).
    await page.locator('[data-testid="dev-action-enter-inn-map"]').click();
    await expect(overlay.locator('[aria-current="step"]')).toContainText(
      'Obtain the Ward Wand from its keeper',
    );

    // Grant the Ward Wand — exercises the giveItem → ITEM_PICKED_UP wiring.
    await page.locator('[data-testid="dev-action-insert-item-ward-wand"]').click();

    await expect(overlay.locator('[aria-current="step"]')).toContainText(
      'Return the Ward Wand to Elder Thalia',
    );
    // The "Obtain the Ward Wand" objective is now checked off.
    await expect(overlay.getByText('Obtain the Ward Wand from its keeper')).toBeVisible();
  });

  test('entering the inn before accepting the quest still unlocks the inn objective', async ({
    page,
  }) => {
    await page.goto('/dev/sandbox');
    await waitForSandboxReady(page);

    // Enter the inn BEFORE accepting — the zone entry must be remembered.
    await page.locator('[data-testid="dev-action-enter-inn-map"]').click();
    await page.locator('[data-testid="dev-action-accept-default-quest-fading-ward"]').click();

    const overlay = page.locator(QUEST_OVERLAY);
    await expect(overlay.getByText('The Fading Ward')).toBeVisible({ timeout: 10_000 });
    // The inn step is already done → current objective is the wand.
    await expect(overlay.locator('[aria-current="step"]')).toContainText(
      'Obtain the Ward Wand from its keeper',
    );
  });

  test('Progress Objective walks the whole quest chain', async ({ page }) => {
    await page.goto('/dev/sandbox');
    await waitForSandboxReady(page);

    await page.locator('[data-testid="dev-action-accept-default-quest-fading-ward"]').click();
    const overlay = page.locator(QUEST_OVERLAY);
    await expect(overlay.getByText('The Fading Ward')).toBeVisible({ timeout: 10_000 });

    // 1. Progress → enter inn
    await page.locator('[data-testid="dev-action-progress-objective"]').click();
    await expect(overlay.locator('[aria-current="step"]')).toContainText(
      'Obtain the Ward Wand from its keeper',
    );

    // 2. Progress → obtain the wand (also grants the item)
    await page.locator('[data-testid="dev-action-progress-objective"]').click();
    await expect(overlay.locator('[aria-current="step"]')).toContainText(
      'Return the Ward Wand to Elder Thalia',
    );
    // Ward Wand should be in the inventory (exact label — the quest overlay
    // contains the phrase but never as an exact standalone label).
    await page.keyboard.press('KeyI');
    await expect(page.getByText('Ward Wand', { exact: true }).first()).toBeVisible({
      timeout: 5000,
    });
    await page.keyboard.press('Escape');

    // 3. Progress → return the wand → quest completes (no active quest left)
    await page.locator('[data-testid="dev-action-progress-objective"]').click();
    await expect(overlay.getByText(/no active quest/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('hides the overlay via its ✕ button', async ({ page }) => {
    await page.goto('/game');
    await page.waitForSelector('#game-canvas-container canvas', { timeout: 30_000 });

    const overlay = page.locator(QUEST_OVERLAY);
    await expect(overlay).toBeVisible({ timeout: 15_000 });

    await overlay.getByRole('button', { name: /hide quest overlay/i }).click();
    await expect(overlay).toBeHidden({ timeout: 5000 });
  });
});
