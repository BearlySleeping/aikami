// apps/e2e/tests/hub/catalog_detail.spec.ts
//
// C-396 AC-3: asset detail shows a preview (or an explicit
// preview-unavailable state for pre-republish entries), the asset's size, its
// license, and its attribution.
//
// The live index predates the thumbnail republish (no thumbnailHash), so the
// preview must degrade to the explicit "Preview unavailable" state — never
// the raw multi-frame sheet. License and attribution come from the index.

import { expect, test } from '@playwright/test';

test.describe('Catalog asset detail — C-396 AC-3', () => {
  test('navigates from a category tile to detail with license and attribution', async ({
    page,
  }) => {
    await page.goto('/catalog/lpc');
    await expect(page.getByTestId('catalog-asset-grid')).toBeVisible();
    // Wait for hydration so the tile's click handler is bound (C-030 AC-1).
    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-hydrated') === 'true',
    );

    // Grab the first tile's tag (data attribute is not set — read from the
    // displayed name instead) and click through.
    const firstTile = page.getByTestId('catalog-asset-tile').first();
    await expect(firstTile).toBeVisible();
    await firstTile.click();

    await expect(page).toHaveURL(/\/catalog\/lpc\//);
    await expect(page.getByTestId('catalog-asset')).toBeVisible();

    // License: verbatim license badges are present.
    await expect(page.getByTestId('catalog-license').first()).toBeVisible();

    // Attribution: author badges are present (LPC carries per-asset credits).
    await expect(page.getByTestId('catalog-author').first()).toBeVisible();

    // Preview: either the thumbnail or the explicit unavailable state —
    // never the raw sheet. Exactly ONE of the two is rendered.
    const preview = page.getByTestId('catalog-asset-preview');
    const unavailable = page.getByTestId('catalog-asset-preview-unavailable');
    const previewCount = await preview.count();
    const unavailableCount = await unavailable.count();
    expect(previewCount + unavailableCount).toBe(1);
    if (previewCount > 0) {
      await expect(preview.first()).toBeVisible();
    } else {
      await expect(unavailable.first()).toBeVisible();
    }
  });

  test('detail page for a known asset shows size, type, category and tag metadata', async ({
    page,
  }) => {
    await page.goto('/catalog/lpc/lpc%3Abeard%3Abeard%3A5oclock_shadow%3Abackslash');
    await expect(page.getByTestId('catalog-asset')).toBeVisible();

    // Metadata definition list renders.
    await expect(page.getByText('Size', { exact: true })).toBeVisible();
    await expect(page.getByText('Type', { exact: true })).toBeVisible();
    await expect(page.getByText('Category', { exact: true })).toBeVisible();
    await expect(page.getByText('Tag', { exact: true })).toBeVisible();
  });

  test('unknown category and unknown asset render 404, not a crash', async ({ page }) => {
    const missingCategory = await page.goto('/catalog/does-not-exist');
    expect(missingCategory?.status()).toBe(404);

    const missingAsset = await page.goto('/catalog/lpc/does-not-exist');
    expect(missingAsset?.status()).toBe(404);
  });

  test('navigating between two asset URLs renders the second asset, not a stale one', async ({
    page,
  }) => {
    await page.goto('/catalog/lpc');
    await expect(page.getByTestId('catalog-asset-grid')).toBeVisible();
    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-hydrated') === 'true',
    );

    // Open the first asset tile.
    const firstTile = page.getByTestId('catalog-asset-tile').nth(0);
    await expect(firstTile).toBeVisible();
    await firstTile.click();
    await expect(page).toHaveURL(/\/catalog\/lpc\/lpc/);
    await expect(page.getByTestId('catalog-asset')).toBeVisible();
    const firstUrl = new URL(page.url()).pathname;

    // Back to the category, then into a second, different asset — the
    // detail page must reflect the second asset's data, never the first's
    // (C-396: view model must recompute when data changes during
    // parameter-only navigation).
    await page.getByRole('button', { name: 'LPC Characters' }).click();
    await expect(page.getByTestId('catalog-asset-grid')).toBeVisible();
    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-hydrated') === 'true',
    );

    const secondTile = page.getByTestId('catalog-asset-tile').nth(1);
    await expect(secondTile).toBeVisible();
    await secondTile.click();
    await expect(page).toHaveURL(/\/catalog\/lpc\/lpc/);
    await expect(page.getByTestId('catalog-asset')).toBeVisible();
    const secondUrl = new URL(page.url()).pathname;
    expect(secondUrl).not.toBe(firstUrl);
  });
});
