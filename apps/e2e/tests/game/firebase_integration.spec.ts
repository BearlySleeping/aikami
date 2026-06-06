// apps/e2e/tests/game/firebase_integration.spec.ts
// C-054 refactored: uses guestUser fixture and GameMenuPage POM for game page tests.
// Firebase REST API tests remain as-is (they don't need browser fixtures).

import { EMULATOR_PORTS } from '../../src/config';
import { expect, test } from '../../src/fixtures';

const AUTH_PORT = EMULATOR_PORTS.auth;
const FIRESTORE_PORT = EMULATOR_PORTS.firestore;

// ── REST API Helpers ─────────────────────────────────────────

/**
 * Creates an anonymous user via the Auth emulator REST API.
 */
const createAnonymousUser = async (): Promise<{ uid: string }> => {
  const resp = await fetch(
    `http://localhost:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    const headers: Record<string, string> = {
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
          name: { stringValue: 'E2E Test Item' },
          value: { integerValue: '42' },
        },
      }),
    });
    expect(createResp.ok).toBeTruthy();

    // Read
    const readResp = await fetch(`${baseUrl}/test_items/e2e_test_1`, {
      headers,
    });
    expect(readResp.ok).toBeTruthy();
    const readData = (await readResp.json()) as {
      fields: { name: { stringValue: string }; value: { integerValue: string } };
    };
    expect(readData.fields.name.stringValue).toBe('E2E Test Item');
    expect(readData.fields.value.integerValue).toBe('42');

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
  test('game page loads and canvas renders', async ({ guestUser, game }) => {
    const { menu } = game(guestUser);
    await menu.goto();

    await menu.expectMenuVisible();
    await menu.expectTitleAndSubtitle({
      title: 'AIKAMI',
      subtitle: 'Chronicles of the Lost Realm',
    });
  });
});
