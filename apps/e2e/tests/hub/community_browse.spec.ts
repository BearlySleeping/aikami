// apps/e2e/tests/hub/community_browse.spec.ts
//
// C-513 AC-4: the hub's public community browse page at `/community/{category}`
// — the contract's Production Surface.
//
// The local hub dev server is run without the private intake binding
// (`UPLOADS_BUCKET` is an ops prerequisite), so the route exercises its
// *degraded* path here: an explicit 503 with a fixed message, never a 500.
// The positive rendering path — approved + promoted rows only, pending and
// rejected never listed — is asserted against a real D1 in the hub unit suite
// (`src/lib/views/community/__tests__/community_category_load.test.ts`).
//
// Contract: C-513 End-User Asset Publishing and Community Sharing

import { expect, test } from '@playwright/test';

test.describe('Community browse — C-513 AC-4', () => {
  test('an unknown category is a 404, not a crash', async ({ page }) => {
    const response = await page.goto('/community/not-a-category');
    expect(response?.status()).toBe(404);
  });

  test('a category that cannot exist in the catalog schema is a 404', async ({ page }) => {
    // `toString` is on Object.prototype — a naive `in` check would let it
    // through. The route validates against the catalog category schema.
    const response = await page.goto('/community/toString');
    expect(response?.status()).toBe(404);
  });

  test('a known category never 500s — it either renders or degrades to an explicit 503', async ({
    page,
  }) => {
    const response = await page.goto('/community/music');
    const status = response?.status() ?? 0;

    expect([200, 503]).toContain(status);
    expect(status).not.toBe(500);

    if (status === 503) {
      // Degraded mode is a first-class answer, with a fixed user-facing message
      // (asserted on the body rather than a locator: the hub's error shell does
      // not render the message in a single visible node).
      const body = await response?.text();
      expect(body).toContain('unavailable in this deployment');
    } else {
      // Configured deployment: the browse surface itself renders.
      await expect(page.getByTestId('community-asset-list')).toBeVisible();
    }
  });

  test('a malformed cursor is rejected rather than silently ignored', async ({ page }) => {
    const response = await page.goto('/community/music?cursor=not-a-cursor');

    // The cursor is part of the request shape, so it is validated before the
    // binding is consulted — a 400 regardless of whether the intake plane is
    // configured in this deployment.
    expect(response?.status()).toBe(400);
    expect(await response?.text()).toContain('page link is not valid');
  });

  test('the public catalog surfaces are unaffected by the new route', async ({ page }) => {
    // The community route joins the `(public)` group — it must not disturb the
    // catalog pages already served there.
    expect((await page.goto('/'))?.status()).toBe(200);
    expect((await page.goto('/catalog/lpc'))?.status()).toBe(200);
  });
});
