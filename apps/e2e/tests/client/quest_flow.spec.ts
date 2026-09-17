// apps/e2e/tests/client/quest_flow.spec.ts
//
// E2E tests for the active-quest overlay + the default Emberwatch quest
// (The Fading Ward). Covers:
//   - The quest overlay renders an empty-state hint on /game.
//   - Accepting the default quest (dev sandbox action) populates the
//     overlay and auto-completes the opening objective.
//   - Obtaining the Ward Wand (giveItem wiring → ITEM_PICKED_UP) advances
//     the required chain past the wand.
//   - The authored endings are offered ONLY at the quest's resolution point,
//     and the chosen conclusion resolves the quest.
//   - The overlay can be hidden via its ✕ button.
//
// The dev-sandbox route is used for deterministic quest seeding — the
// production NPC-walking flow is covered structurally by other specs.

import { expect, test } from '@playwright/test';

const QUEST_OVERLAY = '[data-testid="quest-overlay"]';
const QUEST_OVERLAY_VISIBLE_KEY = 'aikami:quest-overlay:visible';

/**
 * Enables the EXPANDED objective card for this page.
 *
 * C-527 Directive 7 made the compact objective tracker the exploration
 * default, so the expanded card this whole file drives is OFF for a new
 * player. Enable it explicitly instead of depending on a default that has
 * already changed once.
 */
const enableExpandedQuestOverlay = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.addInitScript((key: string) => {
    try {
      localStorage.setItem(key, '1');
    } catch {
      // Private mode: the card stays off and the test fails loudly below.
    }
  }, QUEST_OVERLAY_VISIBLE_KEY);
};

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
    await enableExpandedQuestOverlay(page);
    await page.goto('/game');
    await page.waitForSelector('#game-canvas-container canvas', { timeout: 30_000 });

    const overlay = page.locator(QUEST_OVERLAY);
    await expect(overlay).toBeVisible({ timeout: 15_000 });
    await expect(overlay.getByText(/no active quest/i).first()).toBeVisible();
  });

  test('accepting the default quest populates the overlay and auto-completes the opening objective', async ({
    page,
  }) => {
    await enableExpandedQuestOverlay(page);
    await page.goto('/dev/sandbox');
    await waitForSandboxReady(page);

    // Accept the default quest from the elder via the dev action.
    await page.locator('[data-testid="dev-action-accept-default-quest-fading-ward"]').click();

    const overlay = page.locator(QUEST_OVERLAY);
    await expect(overlay).toBeVisible({ timeout: 10_000 });
    await expect(overlay.getByText('The Fading Ward')).toBeVisible();

    // The opening objective is auto-completed; the current step is the inn.
    await expect(overlay.getByText('Ask Elder Thalia about the failing ward')).toBeVisible();
    // The authored text uses a typographic apostrophe (U+2019).
    await expect(overlay.locator('[aria-current="step"]')).toContainText(
      'Find the Ward Wand\u2019s keeper at the inn',
    );
  });

  test('obtaining the Ward Wand advances the required objective chain', async ({ page }) => {
    await enableExpandedQuestOverlay(page);
    await page.goto('/dev/sandbox');
    await waitForSandboxReady(page);

    await page.locator('[data-testid="dev-action-accept-default-quest-fading-ward"]').click();
    const overlay = page.locator(QUEST_OVERLAY);
    await expect(overlay.getByText('The Fading Ward')).toBeVisible({ timeout: 10_000 });

    // The authored optional side objectives (Sella, Mara) legitimately come
    // first in the card, so assert on the REQUIRED objective's own state
    // rather than on whichever objective happens to be the current step.
    const wandObjective = overlay
      .locator('li')
      .filter({ hasText: 'Obtain the Ward Wand from its keeper' });

    // Enter the inn (fires MAP_ENTERED, unlocking the wand objective).
    await page.locator('[data-testid="dev-action-enter-inn-map"]').click();
    await expect(wandObjective).toBeVisible();
    await expect(wandObjective).not.toHaveClass(/line-through/);

    // Grant the Ward Wand — exercises the giveItem → ITEM_PICKED_UP wiring.
    await page.locator('[data-testid="dev-action-insert-item-ward-wand"]').click();

    // The wand objective is checked off and the next required step is open.
    await expect(wandObjective).toHaveClass(/line-through/);
    await expect(overlay.getByText('Walk the old road toward the ruined shrine')).toBeVisible();
  });

  test('offers authored endings only at the final resolution point', async ({ page }) => {
    await enableExpandedQuestOverlay(page);
    await page.goto('/dev/sandbox');
    await waitForSandboxReady(page);

    await page.locator('[data-testid="dev-action-accept-default-quest-fading-ward"]').click();

    const options = page.getByTestId('quest-ending-options');
    // Accepting the quest must NOT expose the conclusion.
    await expect(options).toBeHidden();

    // Walk the authored objective chain until the quest is resolution-ready.
    // The dev action fires the trigger the next incomplete objective declares,
    // so this is the same production `evaluateTriggers` path a player walks.
    const progress = page.locator('[data-testid="dev-action-progress-objective"]');
    for (let step = 0; step < 8; step++) {
      if (await options.isVisible().catch(() => false)) {
        break;
      }
      if ((await progress.count()) === 0) {
        break;
      }
      await progress.click();
      await page.waitForTimeout(200);
    }

    await expect(options).toBeVisible({ timeout: 10_000 });
    const renewed = options.locator('[data-ending-id="ward_renewed"]');
    const reconciled = options.locator('[data-ending-id="ward_reconciled"]');
    await expect(renewed).toBeEnabled();
    // Locked conclusions are shown, but cannot be selected.
    await expect(reconciled).toBeDisabled();

    await renewed.click();

    // The explicit choice is the resolution: the quest is done and its ending
    // control is gone.
    const overlay = page.locator(QUEST_OVERLAY);
    await expect(overlay.getByText(/no active quest/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(options).toBeHidden();
  });

  test('entering the inn before accepting the quest still unlocks the inn objective', async ({
    page,
  }) => {
    await enableExpandedQuestOverlay(page);
    await page.goto('/dev/sandbox');
    await waitForSandboxReady(page);

    // Enter the inn BEFORE accepting — the zone entry must be remembered.
    await page.locator('[data-testid="dev-action-enter-inn-map"]').click();
    await page.locator('[data-testid="dev-action-accept-default-quest-fading-ward"]').click();

    const overlay = page.locator(QUEST_OVERLAY);
    await expect(overlay.getByText('The Fading Ward')).toBeVisible({ timeout: 10_000 });
    // The inn step is already done, and the required wand step is now open.
    await expect(
      overlay.locator('li').filter({ hasText: 'Find the Ward Wand\u2019s keeper at the inn' }),
    ).toHaveClass(/line-through/);
    await expect(overlay.getByText('Obtain the Ward Wand from its keeper')).toBeVisible();
  });

  test('Progress Objective walks the whole quest chain to its resolution point', async ({
    page,
  }) => {
    await enableExpandedQuestOverlay(page);
    await page.goto('/dev/sandbox');
    await waitForSandboxReady(page);

    await page.locator('[data-testid="dev-action-accept-default-quest-fading-ward"]').click();
    const overlay = page.locator(QUEST_OVERLAY);
    await expect(overlay.getByText('The Fading Ward')).toBeVisible({ timeout: 10_000 });

    // Walk the chain. The quest parks at its resolution point rather than
    // completing, so the objective stepper stops advancing and the authored
    // ending options appear instead.
    const progress = page.locator('[data-testid="dev-action-progress-objective"]');
    const options = page.getByTestId('quest-ending-options');
    for (let step = 0; step < 8; step++) {
      if (await options.isVisible().catch(() => false)) {
        break;
      }
      if ((await progress.count()) === 0) {
        break;
      }
      await progress.click();
      await page.waitForTimeout(200);
    }

    // Ward Wand should be in the inventory (exact label — the quest overlay
    // contains the phrase but never as an exact standalone label).
    await page.keyboard.press('KeyI');
    await expect(page.getByText('Ward Wand', { exact: true }).first()).toBeVisible({
      timeout: 5000,
    });
    await page.keyboard.press('Escape');

    // The resolution point: the quest is still active and awaiting the choice.
    await expect(overlay.getByText('The Fading Ward')).toBeVisible();
    await expect(options).toBeVisible({ timeout: 10_000 });

    // Choosing the conclusion is what completes the quest.
    await options.locator('[data-ending-id="ward_renewed"]').click();
    await expect(overlay.getByText(/no active quest/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('hides the overlay via its ✕ button', async ({ page }) => {
    await enableExpandedQuestOverlay(page);
    await page.goto('/game');
    await page.waitForSelector('#game-canvas-container canvas', { timeout: 30_000 });

    const overlay = page.locator(QUEST_OVERLAY);
    await expect(overlay).toBeVisible({ timeout: 15_000 });

    await overlay.getByRole('button', { name: /hide quest overlay/i }).click();
    await expect(overlay).toBeHidden({ timeout: 5000 });
  });
});
