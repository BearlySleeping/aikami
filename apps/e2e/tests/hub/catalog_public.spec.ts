// apps/e2e/tests/hub/catalog_public.spec.ts
//
// C-396 AC-1: the hub is PUBLIC. Anonymous visitors can reach `/` and
// `/catalog/lpc` (200, no redirect); member routes stay guarded (`/dashboard`
// redirects to `/login` exactly as before); a signed-in visitor sees the
// account menu in place of the anonymous login affordance.
//
// The signed-in session is minted directly against the Firebase Auth
// emulator and synced through the hub's own POST /api/auth/session — the
// same flow the hub's login page uses.

import { expect, test } from '@playwright/test';

const EMULATOR_PORT_OFFSET = Number(process.env.PUBLIC_EMULATOR_PORT_OFFSET || 0);
const AUTH_EMULATOR_URL = `http://127.0.0.1:${9098 + EMULATOR_PORT_OFFSET}`;
const FIREBASE_API_KEY = 'fake-api-key';
const AUTH_STORAGE_KEY = `firebase:authUser:${FIREBASE_API_KEY}:[DEFAULT]`;

/**
 * Create a Firebase emulator user and inject its auth state into the
 * browser's IndexedDB BEFORE the app initialises — the same pattern as
 * apps/e2e/src/auth.setup.ts. Firebase Auth restores the session on load and
 * the hub's AuthService syncs the SSR session cookie itself.
 */
const seedSignedInState = async (page: import('@playwright/test').Page): Promise<void> => {
  const response = await fetch(
    `${AUTH_EMULATOR_URL}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `hub-e2e-${Date.now()}@example.com`,
        password: 'asdasd',
        returnSecureToken: true,
      }),
    },
  );
  expect(response.ok).toBe(true);
  const data = (await response.json()) as {
    idToken: string;
    refreshToken: string;
    localId: string;
    email: string;
  };
  expect(data.idToken).toBeTruthy();

  await page.addInitScript(
    (state: {
      key: string;
      idToken: string;
      refreshToken: string;
      email: string;
      uid: string;
      apiKey: string;
    }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('firebaseLocalStorageDb', 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('firebaseLocalStorage')) {
            db.createObjectStore('firebaseLocalStorage');
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['firebaseLocalStorage'], 'readwrite');
          const store = tx.objectStore('firebaseLocalStorage');
          store.put({
            name: state.key,
            value: {
              uid: state.uid,
              email: state.email,
              emailVerified: false,
              isAnonymous: false,
              providerData: [{ providerId: 'password', uid: state.email, email: state.email }],
              stsTokenManager: {
                refreshToken: state.refreshToken,
                accessToken: state.idToken,
                expirationTime: Date.now() + 3_600_000,
              },
              createdAt: String(Date.now()),
              lastLoginAt: String(Date.now()),
              apiKey: state.apiKey,
              appName: '[DEFAULT]',
            },
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
        request.onerror = () => reject(request.error);
      }),
    {
      key: AUTH_STORAGE_KEY,
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      email: data.email,
      uid: data.localId,
      apiKey: FIREBASE_API_KEY,
    },
  );
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
    // Category cards from the live index.
    await expect(page.getByRole('button', { name: /LPC Characters/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Music/ })).toBeVisible();
    // Anonymous visitor: app bar shows the login affordance, no account menu.
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
    await expect(page.locator('[aria-label="Profile menu"]')).toHaveCount(0);
  });

  test('anonymous visitor reaches a category page and sees the asset grid', async ({ page }) => {
    const response = await page.goto('/catalog/lpc');
    expect(response?.status()).toBe(200);

    await expect(page.getByTestId('catalog-category')).toBeVisible();
    await expect(page.getByTestId('catalog-asset-grid')).toBeVisible();
    await expect(page.getByTestId('catalog-asset-tile').first()).toBeVisible();
  });

  test('anonymous visitor is redirected from /dashboard to /login', async ({ page }) => {
    await page.goto('/dashboard');
    // The member-only route keeps its guard — final URL is the login page.
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: /Sign in with Google/ })).toBeVisible();
  });

  test('signed-in visitor sees the account menu, not the login affordance', async ({ page }) => {
    // Seed a real Firebase emulator session (IndexedDB) BEFORE first paint.
    await seedSignedInState(page);

    // Firebase Auth restores the session on load; the hub AuthService syncs
    // the SSR session cookie. Both anonymous-render and signed-in-render must
    // work on the public catalog.
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
