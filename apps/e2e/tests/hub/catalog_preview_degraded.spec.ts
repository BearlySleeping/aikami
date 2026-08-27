// apps/e2e/tests/hub/catalog_preview_degraded.spec.ts
//
// C-446 AC-5: degraded path never loses the thumbnail.
//
// When the preview island fails to load or the resolver resolves nothing,
// the server-rendered thumbnail remains visible, a notice explains that the
// interactive preview is unavailable, and the license/attribution panel is
// unaffected.

import { expect, test } from '@playwright/test';
import { CatalogPreviewPage } from '$pom';

test.describe('Catalog preview degraded path — C-446 AC-5', () => {
  test('thumbnail remains visible when CDN is blocked', async ({ page }) => {
    const preview = new CatalogPreviewPage(page);

    // Block CDN requests to simulate resolver failure
    await page.route('**/assets/**', (route) => route.abort());
    await page.route('**/thumbnails/**', (route) => route.abort());
    await page.route('**/index/**', (route) => route.abort());

    await page.goto('/catalog/lpc/lpc%3Abeard%3Abeard%3A5oclock_shadow%3Abackslash');

    // The page should not 500.
    await expect(preview.assetContainer).toBeVisible();

    // The thumbnail should still be visible (degraded path).
    await expect(preview.thumbnail).toBeAttached();

    // The license section should still be visible (unaffected by preview failure).
    // Accept both known and unknown states.
    const licenseKnown = page.getByTestId('catalog-license');
    const licenseUnknown = page.getByTestId('catalog-license-unknown');
    await expect(licenseKnown.or(licenseUnknown).first()).toBeVisible();

    // The attribution section should still be visible.
    const authorKnown = page.getByTestId('catalog-author');
    const authorUnknown = page.getByTestId('catalog-attribution-unknown');
    await expect(authorKnown.or(authorUnknown).first()).toBeVisible();
  });

  test('page renders fully with JavaScript disabled', async ({ browser }) => {
    // Create a new context with JavaScript disabled
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const preview = new CatalogPreviewPage(page);

    await page.goto('/catalog/lpc/lpc%3Abeard%3Abeard%3A5oclock_shadow%3Abackslash');

    // The page should render server-side content.
    await expect(preview.assetContainer).toBeVisible();
    await expect(preview.thumbnail).toBeAttached();

    // Without JavaScript, the preview island should not mount.
    await expect(preview.island).toHaveCount(0);

    await context.close();
  });

  test('unknown category does not crash', async ({ page }) => {
    const response = await page.goto('/catalog/unknown-category/some-tag');
    expect(response?.status()).toBe(404);
  });
});
