// apps/frontend/game/tests/firebase_integration.spec.ts
/**
 * Firebase REST Integration E2E Tests
 *
 * Tests the game's lightweight Firebase REST client:
 * - Auth emulator reachability
 * - Firestore document CRUD
 * - Anonymous auth user creation
 * - Game page load
 */

import { expect, test } from '@playwright/test';

const AUTH_PORT = 9099;
const FIRESTORE_PORT = 8080;
const GAME_URL = 'http://localhost:5174';

// ── Helpers ─────────────────────────────────────────────────

/**
 * Creates an anonymous user via the Auth emulator REST API.
 */
const createAnonymousUser = async (): Promise<{ uid: string }> => {
  const resp = await fetch(
    `http://localhost:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // biome-ignore lint/style/useNamingConvention: HTTP header name
        Authorization: 'Bearer owner',
      },
      body: JSON.stringify({ returnSecureToken: true }),
    },
  );
  const data = (await resp.json()) as { localId: string };
  return { uid: data.localId };
};

test.describe('Firebase REST Integration', () => {
  test('Auth emulator is reachable', async () => {
    const resp = await fetch(`http://localhost:${AUTH_PORT}/`);
    expect(resp.status).toBeLessThan(500);
  });

  test('Firestore emulator CRUD operations', async () => {
    const baseUrl = `http://localhost:${FIRESTORE_PORT}/v1/projects/demo-aikami-emulator/databases/(default)/documents`;
    const headers = {
      'Content-Type': 'application/json',
      // biome-ignore lint/style/useNamingConvention: HTTP header name
      Authorization: 'Bearer owner',
    };

    // Create
    const createResp = await fetch(`${baseUrl}/test_items?documentId=e2e_test_1`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        fields: {
          name: { stringValue: 'test-item' },
          value: { integerValue: '42' },
        },
      }),
    });
    expect(createResp.ok).toBeTruthy();

    // Read
    const readResp = await fetch(`${baseUrl}/test_items/e2e_test_1`, { headers });
    expect(readResp.ok).toBeTruthy();
    const doc = (await readResp.json()) as {
      fields: { name: { stringValue: string }; value: { integerValue: string } };
    };
    expect(doc.fields.name.stringValue).toBe('test-item');
    expect(doc.fields.value.integerValue).toBe('42');

    // Delete
    const delResp = await fetch(`${baseUrl}/test_items/e2e_test_1`, {
      method: 'DELETE',
      headers,
    });
    expect(delResp.ok).toBeTruthy();
  });

  test('Anonymous auth creates user', async () => {
    const user = await createAnonymousUser();
    expect(user.uid).toBeTruthy();
  });
});

test.describe('Game Page Load', () => {
  test('game page loads and canvas renders', async ({ page }) => {
    await page.goto(GAME_URL);
    await page.waitForSelector('#menu-screen', { state: 'visible' });
    await expect(page.locator('#menu-screen h1')).toHaveText('AIKAMI');
  });
});
