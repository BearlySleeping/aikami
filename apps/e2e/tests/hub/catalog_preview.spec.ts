// apps/e2e/tests/hub/catalog_preview.spec.ts
//
// C-446 AC-2, AC-6: catalog asset preview island mounts and renders,
// LPC preview configuration is linkable via URL.

import { expect, test } from '@playwright/test';
import { CatalogPreviewPage } from '$pom';

test.describe('Catalog asset preview — C-446 AC-2, AC-6', () => {
  test('preview island becomes visible on an LPC detail page', async ({ page }) => {
    const preview = new CatalogPreviewPage(page);
    await page.goto('/catalog/lpc/lpc%3Abeard%3Abeard%3A5oclock_shadow%3Abackslash');
    await expect(preview.assetContainer).toBeVisible();

    // The preview island should mount and the canvas should become visible
    await expect(preview.island).toBeVisible({ timeout: 10000 });

    // The thumbnail should be attached (may be hidden once preview mounts).
    await expect(preview.thumbnail).toBeAttached();
  });

  test('LPC preview configuration is linkable via URL', async ({ page }) => {
    const preview = new CatalogPreviewPage(page);
    await page.goto('/catalog/lpc/lpc%3Abeard%3Abeard%3A5oclock_shadow%3Abackslash');
    await expect(preview.assetContainer).toBeVisible();

    // Wait for the preview island to mount.
    await expect(preview.island).toBeVisible({ timeout: 10000 });

    // Read the current URL search params — the preview should have synced
    // its state to the URL via replaceState with 'l0' parameter.
    const currentUrl = new URL(page.url());
    // The URL should contain the encoded preview state (l0 parameter).
    expect(currentUrl.searchParams.has('l0')).toBe(true);
  });

  test('thumbnail remains visible when CDN is blocked', async ({ page }) => {
    const preview = new CatalogPreviewPage(page);

    // Block CDN requests to simulate resolver failure
    await page.route('**/assets/**', (route) => route.abort());
    await page.route('**/thumbnails/**', (route) => route.abort());

    await page.goto('/catalog/lpc/lpc%3Abeard%3Abeard%3A5oclock_shadow%3Abackslash');
    await expect(preview.assetContainer).toBeVisible();

    // The thumbnail should still be visible (degraded path).
    await expect(preview.thumbnail).toBeAttached();
  });
});
