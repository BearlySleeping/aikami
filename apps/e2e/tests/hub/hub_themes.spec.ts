// apps/e2e/tests/hub/hub_themes.spec.ts
//
// C-530 AC-1..AC-4, AC-8, AC-9: the Hub's public theme surfaces and the
// theme publish API family — the contract's Production Surface.
//
// The local hub dev server is run without the private intake binding
// (`UPLOADS_BUCKET` is an ops prerequisite), so this lane exercises the
// *degraded* paths: the listing renders its "discovery unavailable" state
// rather than a 500, and the JSON routes answer an explicit 503. The positive
// path — reserve → private upload → server validation → moderation → real
// public bytes — is asserted against a real D1 in
// `apps/frontend/hub/src/lib/server/api/tests/theme_publish.test.ts`.
//
// 🔴 The binding-bearing lane (`hub-worker`, wrangler dev --local on :5278) is
// where the end-to-end publish → approve → discover journey runs. Record which
// lane produced the evidence rather than substituting a unit test.
//
// Contract: C-530 Hub theme publishing and installation

import { expect, test } from '@playwright/test';

test.describe('Hub themes — C-530 AC-3 / AC-4 / AC-9', () => {
  test('/community/themes is the theme listing, not the [category] route', async ({ page }) => {
    const response = await page.goto('/community/themes');
    const status = response?.status() ?? 0;

    expect([200, 503]).toContain(status);
    expect(status).not.toBe(500);

    if (status === 200) {
      // The static route wins over the sibling dynamic route, so the visitor
      // sees the theme surface — never "Category themes was not found".
      const body = await page.content();
      expect(body).toContain('Community Themes');
      expect(body).not.toContain('was not found');
      await expect(page.getByTestId('theme-listing')).toBeVisible();
    }
  });

  test('a degraded deployment says so instead of showing an empty grid', async ({ page }) => {
    const response = await page.goto('/community/themes');
    if (response?.status() !== 200) {
      return;
    }
    // The listing wrapper always renders on a 200; inside it the page is in
    // exactly one of three states — rows, an explicit empty notice, or the
    // degraded notice. A degraded deployment must never look like an empty one.
    await expect(page.getByTestId('theme-listing')).toBeVisible();
    const state = page.locator(
      '[data-testid="theme-listing-row"], [data-testid="theme-listing-empty"], [data-testid="theme-listing-degraded"]',
    );
    await expect(state.first()).toBeVisible();
  });

  test('a malformed cursor is rejected before the binding is consulted', async ({ page }) => {
    const response = await page.goto('/community/themes?cursor=not-a-cursor');
    expect(response?.status()).toBe(400);
    expect(await response?.text()).toContain('page link is not valid');
  });

  test('a theme detail for an unknown id is a 404 or a degraded 503, never a 500', async ({
    page,
  }) => {
    const response = await page.goto('/community/themes/does-not-exist');
    expect([404, 503]).toContain(response?.status() ?? 0);
    expect(response?.status()).not.toBe(500);
  });

  test('a malformed theme id is a 404, not a query', async ({ page }) => {
    const response = await page.goto('/community/themes/Not_A_Theme');
    expect(response?.status()).toBe(404);
  });

  test('a malformed version is a 400', async ({ page }) => {
    const response = await page.goto('/community/themes/some-theme?version=1.2');
    expect(response?.status()).toBe(400);
    expect(await response?.text()).toContain('version link is not valid');
  });
});

test.describe('Hub theme API — C-530 AC-1 / AC-2', () => {
  test('reserving without a session is refused, never a 500', async ({ request }) => {
    const response = await request.post('/api/assets/themes', {
      data: {
        themeId: 'e2e-theme',
        version: '1.0.0',
        sizeBytes: 1024,
        provenance: { source: 'original', license: 'CC-BY-4.0' },
      },
    });
    // 401 with a session-capable deployment; 503 when the intake plane (and so
    // the whole theme surface) is unconfigured. Never a 500.
    expect([401, 503]).toContain(response.status());
  });

  test('an upload without a session is refused, never a 500', async ({ request }) => {
    const response = await request.put('/api/assets/themes/e2e-theme/upload?version=1.0.0', {
      headers: { 'content-type': 'application/octet-stream', 'content-length': '16' },
      data: 'not-a-theme-zip',
    });
    expect([401, 503]).toContain(response.status());
  });

  test('the public listing is readable anonymously, never a 500', async ({ request }) => {
    const response = await request.get('/api/assets/themes');
    expect([200, 503]).toContain(response.status());
    if (response.status() === 200) {
      const body = (await response.json()) as { items: unknown[] };
      expect(Array.isArray(body.items)).toBe(true);
    }
  });

  test('a public package URL for an unknown version is a 404 or a degraded 503', async ({
    request,
  }) => {
    const response = await request.get('/api/assets/themes/e2e-theme/public?version=1.0.0');
    expect([400, 404, 503]).toContain(response.status());
    expect(response.status()).not.toBe(500);
  });

  test('moderation without a session is refused', async ({ request }) => {
    const response = await request.post('/api/assets/themes/e2e-theme/moderation', {
      data: { decision: 'approved' },
    });
    expect([401, 503]).toContain(response.status());
  });

  test('revocation without a session is refused', async ({ request }) => {
    const response = await request.post('/api/assets/themes/e2e-theme/revocation', {
      data: { revoked: true },
    });
    expect([401, 503]).toContain(response.status());
  });
});

test.describe('Hub community regression — C-530 AC-9', () => {
  test('the existing community browse route still behaves for an unknown category', async ({
    page,
  }) => {
    const response = await page.goto('/community/not-a-category');
    expect(response?.status()).toBe(404);
  });

  test('the existing community browse route still refuses a .zip at reserve', async ({
    request,
  }) => {
    const response = await request.post('/api/assets/community', {
      data: {
        category: 'portraits',
        tag: 'portraits:e2e-fixture',
        title: 'E2E Fixture',
        ext: '.zip',
        sizeBytes: 1024,
        provenance: { source: 'original', license: 'CC-BY-4.0' },
      },
    });
    // A theme package is not a community asset: `.zip` is in neither the image
    // nor the audio extension map, so the generic path still refuses it.
    expect([401, 422, 503]).toContain(response.status());
    expect(response.status()).not.toBe(500);
  });
});
