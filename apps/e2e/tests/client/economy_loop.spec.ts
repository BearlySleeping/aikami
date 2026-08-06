// apps/e2e/tests/client/economy_loop.spec.ts
//
// Economy loop tests (C-331) against the new Emberwatch content pack
// (manifest v3 — village / inn / merchant shop):
//   - Buying from the merchant updates gold + inventory.
//   - Selling back (with confirmation) restores gold.
//   - Quest key items (Ward Wand) are not vendor-tradable (basePrice 0).
//
// Uses the standalone vendor dev sandbox (/dev/sandbox/vendor, Grimbold's
// Forge) for a deterministic buy/sell surface — the production merchant
// (Mara) lives in the merchant_shop map and is covered by the visual suite.
//
// Requires dev servers + emulator running.
import { expect, test } from '@playwright/test';

/** Parses the player gold from the vendor gold badge. */
const parseGold = async (page: import('@playwright/test').Page): Promise<number> => {
  const badge = page.locator('.badge-warning', { hasText: '🪙' });
  const text = (await badge.textContent()) ?? '';
  return Number.parseInt(text.replace(/[^0-9]/g, ''), 10) || 0;
};

/**
 * Polls the vendor gold badge until it parses to the expected amount.
 * Bounded polling replaces single-read textContent comparisons so the
 * assertion waits for the badge to settle after a transaction.
 */
const expectGold = async (
  page: import('@playwright/test').Page,
  expected: number,
): Promise<void> => {
  const badge = page.locator('.badge-warning', { hasText: '🪙' });
  await expect(badge).toBeVisible();
  await expect
    .poll(async () => parseGold(page), { timeout: 10_000, intervals: [250, 500, 1000] })
    .toBe(expected);
};

/** Clicks the Buy button inside the vendor card for the given item name. */
const buyItem = async (page: import('@playwright/test').Page, itemName: string) => {
  // Walk up from the item title to its nearest rounded-xl card container
  // (the vendor dialog itself is also rounded-xl — nearest wins).
  const itemTitle = page.locator('h4', { hasText: itemName }).first();
  const card = itemTitle.locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
  const buyButton = card.getByRole('button', { name: /Buy for/ });
  await expect(buyButton).toBeEnabled({ timeout: 10_000 });
  await buyButton.click();
};

test.describe('Economy loop (C-331) — new Emberwatch pack', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/sandbox/vendor');
    // Vendor sandbox seeds 400 gold.
    await expect(page.locator('.badge-warning', { hasText: '🪙' })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('AC-1: buying from the vendor decreases gold and adds the item to inventory', async ({
    page,
  }) => {
    const goldBefore = await parseGold(page);
    expect(goldBefore).toBeGreaterThanOrEqual(400);

    await buyItem(page, 'Iron Sword'); // 50g
    await buyItem(page, 'Health Potion'); // 10g

    await expectGold(page, goldBefore - 60);

    // Inventory badge/sell list reflects the purchase.
    await expect(page.locator('button[aria-label^="Sell Iron Sword"]')).toBeVisible({
      timeout: 5000,
    });
  });

  test('AC-2: selling an item back (with confirmation) restores gold', async ({ page }) => {
    // Seed inventory by buying, then sell it back.
    const goldBefore = await parseGold(page);
    await buyItem(page, 'Iron Sword'); // 50g
    await expectGold(page, goldBefore - 50);

    const sellButton = page.locator('button[aria-label^="Sell Iron Sword"]');
    await sellButton.click();

    // Confirmation dialog → confirm.
    const confirmButton = page.locator('button', { hasText: 'Confirm Sale' });
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();

    // Iron Sword sells for floor(50 × 0.5) = 25g.
    await expectGold(page, goldBefore - 50 + 25);

    // No longer sellable.
    await expect(page.locator('button[aria-label^="Sell Iron Sword"]')).toBeHidden();
  });

  test('AC-3: quest key items (Ward Wand) are not vendor-tradable', async ({ page }) => {
    // Wait for the vendor list to render (a known tradable item) before
    // asserting the Ward Wand is absent — the badge alone does not prove
    // the inventory list has loaded.
    await expect(page.locator('h4', { hasText: 'Iron Sword' })).toBeVisible({
      timeout: 10_000,
    });
    // The Ward Wand has no basePrice — the vendor must not list or buy it.
    await expect(page.locator('h4', { hasText: 'Ward Wand' })).toHaveCount(0);
    await expect(page.getByText('Nothing the vendor will buy.')).toBeVisible();
  });
});
