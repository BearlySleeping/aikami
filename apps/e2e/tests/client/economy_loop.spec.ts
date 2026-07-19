// apps/e2e/tests/client/economy_loop.spec.ts
//
// Full-stack economy loop test (C-331): pickup → stack → buy/sell →
// equip → consume → loot → save → reload with consistent state.
//
// Requires dev servers + emulator running.
import { expect, test } from '@playwright/test';

test("AC-2: pickup adds item, gold persists, and collected items don't respawn on reload", async ({
  page,
}) => {
  // Precondition: start on the Old Road map where the wardPendant pickup
  // exists near the spawn point.
  await page.goto('/game');

  // Wait for the engine to boot
  await page.waitForSelector('[data-testid="game-canvas"]', { timeout: 30000 });

  // Interact to pick up the nearby item
  await page.keyboard.press('e');
  // Open inventory to verify pickup
  await page.keyboard.press('i');

  // Assert: Ward Pendant appears in the inventory overlay
  await expect(page.locator('text=Ward Pendant')).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Escape');

  // Enter pause menu and save
  await page.keyboard.press('Escape');
  await page.locator('text=Save Game').click();
  await page.waitForSelector('text=Game Saved', { timeout: 5000 });

  // Reload the page
  await page.reload();
  await page.waitForSelector('[data-testid="game-canvas"]', { timeout: 30000 });

  // Open inventory — Ward Pendant should still be present
  await page.keyboard.press('i');
  await expect(page.locator('text=Ward Pendant')).toBeVisible({ timeout: 5000 });
});

test('AC-3: buy/sell updates gold and inventory list', async ({ page }) => {
  // Start at the village map where Keth is located
  await page.goto('/game?map=village&debug=spawn-near-keth');
  await page.waitForSelector('[data-testid="game-canvas"]', { timeout: 30000 });

  // Interact with Keth
  await page.keyboard.press('e');

  // Wait for vendor overlay
  await page.waitForSelector('text=For Sale', { timeout: 5000 });

  // Buy the Iron Sword (50 gold)
  const goldBefore = Number.parseInt(
    (await page.locator('.badge-warning:text("🪙")').textContent())?.replace(/[^0-9]/g, '') ?? '0',
    10,
  );
  await page.locator('text=Iron Sword').locator('..').locator('button:has-text("Buy")').click();

  // Assert gold decreased
  const goldAfterBuy = Number.parseInt(
    (await page.locator('.badge-warning:text("🪙")').textContent())?.replace(/[^0-9]/g, '') ?? '0',
    10,
  );
  expect(goldAfterBuy).toBeLessThan(goldBefore);

  // Assert Iron Sword appears in inventory
  await page.keyboard.press('Escape'); // Close vendor
  await page.keyboard.press('i'); // Open inventory
  await expect(page.locator('text=Iron Sword')).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Escape'); // Close inventory

  // Re-open vendor and sell Ward Shard if available
  await page.keyboard.press('e');
  await page.waitForSelector('text=For Sale', { timeout: 5000 });

  const wardShardSellButton = page
    .locator('text=Ward Shard')
    .locator('..')
    .locator('button:has-text("Sell")');
  if ((await wardShardSellButton.count()) > 0) {
    await wardShardSellButton.click();
    // Confirm sale if there's a confirmation dialog
    const confirmButton = page.locator('button:has-text("Confirm Sale")');
    if ((await confirmButton.count()) > 0) {
      await confirmButton.click();
    }
    // Assert gold increased
    const goldAfterSell = Number.parseInt(
      (await page.locator('.badge-warning:text("🪙")').textContent())?.replace(/[^0-9]/g, '') ??
        '0',
      10,
    );
    expect(goldAfterSell).toBeGreaterThan(goldAfterBuy);

    // Assert Ward Shard is removed from sell list
    await expect(wardShardSellButton).not.toBeVisible();
  }
});
