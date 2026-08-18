// apps/e2e/tests/client/vendor_import.spec.ts
//
// C-419 growth features — functional E2E:
//   AC-3: the vendor haggle panel collapses until engaged and expands on
//         demand (production VendorView via the /dev/sandbox/vendor route).
//   AC-4: vendor items with content-pack art render an <img>, not a 📦.
//   AC-1: the persona list exposes the card-import affordance.
//
// Run: bun moon run e2e:test-client -- --grep vendor_import

import { expect, test } from '@playwright/test';

test.describe('C-419 vendor + persona import (production VendorView)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/sandbox/vendor');
    // Vendor sandbox seeds 400 gold and shows the gold badge.
    await expect(page.locator('.badge-warning', { hasText: '🪙' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('AC-3: haggle panel is collapsed until engaged, then expands', async ({ page }) => {
    // Collapsed by default: no textarea/chat pane, slim strip present.
    await expect(page.getByRole('button', { name: /start a conversation to haggle/i })).toBeVisible(
      {
        timeout: 10_000,
      },
    );
    await expect(page.locator('textarea')).toHaveCount(0);

    // Clicking the affordance expands the chat pane.
    await page.getByRole('button', { name: /start a conversation to haggle/i }).click();
    await expect(page.locator('textarea')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Start a conversation to haggle with the vendor')).toBeVisible();
  });

  test('AC-4: inventory items render art instead of a uniform 📦', async ({ page }) => {
    // The dev catalog (rustySword, ironSword, steelSword, woodenShield,
    // leatherArmor, ironArmor, healthPotion, manaPotion) declares lpcAssetId
    // for the six gear items — cropped sprite frames should appear once the
    // LPC sheets load (rendered as a background-image div, not an <img>).
    await expect(page.locator('.badge-warning', { hasText: '🪙' })).toBeVisible({
      timeout: 15_000,
    });

    // Every fixture item that declares lpcAssetId must render its art cell,
    // targeted by its stable item id — not just "at least one icon".
    const artItems = [
      'rustySword',
      'ironSword',
      'steelSword',
      'woodenShield',
      'leatherArmor',
      'ironArmor',
    ];
    for (const itemId of artItems) {
      await expect
        .poll(
          async () =>
            await page
              .locator(`[data-item-id="${itemId}"] .vendor-item-icon div[style*="background-image"]`)
              .count(),
          { timeout: 15_000, intervals: [500, 1000, 2000] },
        )
        .toBeGreaterThan(0);
    }

    // Consumables (healthPotion, manaPotion) declare no lpcAssetId and
    // legitimately fall back to the emoji tier (🧪), never a blank cell.
    for (const itemId of ['healthPotion', 'manaPotion']) {
      await expect(page.locator(`[data-item-id="${itemId}"] .vendor-item-icon`)).toContainText('🧪', {
        timeout: 10_000,
      });
    }
  });
});

test.describe('C-419 AC-1 persona import affordance', () => {
  test('persona list exposes the Import Card button', async ({ page }) => {
    await page.goto('/personas');
    await page
      .getByRole('button', { name: 'Import Card' })
      .waitFor({ state: 'visible', timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Import Card' })).toBeVisible();
  });
});
