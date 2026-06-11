// apps/e2e/tests/client/basic.spec.ts
// C-055: Fixed — PWA login page loads and renders.

import { test } from '../../src/fixtures';

test.describe('PWA Basic', () => {
  test('should load the login page', async ({ guestUser, client }) => {
    const { auth } = client(guestUser);
    await auth.gotoLogin();
    await auth.expectLoginPageVisible();
  });

  test('login page renders without errors', async ({ guestUser }) => {
    await guestUser.goto('/login');
    await guestUser.waitForLoadState('domcontentloaded');
  });
});
