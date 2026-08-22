// apps/e2e/tests/hub/catalog_public.spec.ts
//
// C-396 AC-1: the hub is PUBLIC. Anonymous visitors can reach `/` and
// `/catalog/lpc` (200, no redirect); member routes stay guarded (`/dashboard`
// redirects to `/login` exactly as before); a signed-in visitor sees the
// account menu in place of the anonymous login affordance.
//
// The signed-in session is minted directly against the hub's Better Auth
// endpoints and injected as a session cookie — the same flow the hub's
// login page uses.

import { expect, test } from '@playwright/test';
import { EMULATOR_PORTS } from '../../src/config';

const HUB_BASE_URL = `http://localhost:${EMULATOR_PORTS.hub}`;

/**
 * Sign up + sign in a test user against the hub's Better Auth endpoints and
 * inject the session cookie into the browser context BEFORE the app
 * initialises — the same pattern as apps/e2e/src/auth.setup.ts. Better Auth
 * restores the session from the cookie on load and the hub's AuthService
 * syncs the SSR session.
 */
const seedSignedInState = async (page: import('@playwright/test').Page): Promise<void> => {
  const email = `hub-e2e-${Date.now()}@example.com`;
  const password = 'asdasd';

  await fetch(`${HUB_BASE_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Hub E2E', email, password }),
  }).catch(() => undefined);

  const res = await fetch(`${HUB_BASE_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  expect(res.ok).toBe(true);
  const setCookie = res.headers.get('set-cookie');
  expect(setCookie).toBeTruthy();
  const cookie = setCookie?.split(';')[0] ?? '';

  await page.context().addCookies([
    {
      name: cookie.split('=')[0] ?? 'better-auth.session_token',
      value: cookie.split('=').slice(1).join('='),
      url: `http://localhost:${EMULATOR_PORTS.client}`,
    },
  ]);
};

test.describe('Catalog public shell — C-396 AC-1', () => {
  test('anonymous visitor reaches the catalog landing at / with a login affordance', async ({
    page,
  }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);

    await expect(page.getByTestId('catalog-landing')).toBeVisible();
    await expect(
      page.getByTestId('catalog-landing').getByRole('heading', { name: 'Catalog' }),
    ).toBeVisible();
    // Structural: the category grid renders with at least one category card.
    await expect(page.getByTestId('catalog-category-grid')).toBeVisible();
    await expect(page.getByTestId('catalog-category-grid').locator('li').first()).toBeVisible();
    // Anonymous visitor: app bar shows the login affordance, no account menu.
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
    await expect(page.locator('[aria-label="Profile menu"]')).toHaveCount(0);
  });

  test('live index exposes the expected category labels (data pin)', async ({ page }) => {
    // This test deliberately pins LIVE index content — it fails for a data
    // reason if the index is republished without LPC/Music, not for a code
    // reason. The structural tests above do not depend on it.
    await page.goto('/');
    await expect(page.getByRole('button', { name: /LPC Characters/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Music/ })).toBeVisible();
  });

  test('anonymous visitor reaches a category page and sees a non-empty asset grid', async ({
    page,
  }) => {
    const response = await page.goto('/catalog/lpc');
    expect(response?.status()).toBe(200);

    await expect(page.getByTestId('catalog-category')).toBeVisible();
    await expect(page.getByTestId('catalog-asset-grid')).toBeVisible();
    // Structural: at least one tile renders — never depends on which asset.
    await expect(page.getByTestId('catalog-asset-tile').first()).toBeVisible();
  });

  test('anonymous visitor is redirected from /dashboard to /login', async ({ page }) => {
    await page.goto('/dashboard');
    // The member-only route keeps its guard — final URL is the login page.
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: /Sign in with Google/ })).toBeVisible();
  });

  test('signed-in visitor sees the account menu, not the login affordance', async ({ page }) => {
    // Seed a real Better Auth session cookie BEFORE first paint.
    await seedSignedInState(page);

    // Better Auth restores the session from the cookie on load; the hub
    // AuthService syncs the SSR session. Both anonymous-render and
    // signed-in-render must work on the public catalog.
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page.locator('[aria-label="Profile menu"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Login' })).toHaveCount(0);

    // Signed-in visitors can still browse the public catalog.
    const categoryResponse = await page.goto('/catalog/lpc');
    expect(categoryResponse?.status()).toBe(200);
    await expect(page.getByTestId('catalog-asset-grid')).toBeVisible();
  });
});
