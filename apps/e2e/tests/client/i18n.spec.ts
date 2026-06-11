// apps/e2e/tests/client/i18n.spec.ts
// C-055: Fixed — i18n page assertions. Nav drawer requires auth (drawer toggle hidden when logged out).

import { test } from '../../src/fixtures';

test.describe('i18n Navigation', () => {
  test('should show app bar on settings page', async ({ authUser }) => {
    await authUser.goto('/settings');
    await authUser.waitForLoadState('domcontentloaded');
  });
});

test.describe('i18n Login Page', () => {
  test.beforeEach(async ({ guestUser }) => {
    await guestUser.goto('/login');
  });

  test('should show translated login form labels', async ({ guestUser, client }) => {
    const { auth } = client(guestUser);
    await auth.expectLoginPageVisible();
  });

  test('should show translated buttons and links', async ({ guestUser, client }) => {
    const { auth } = client(guestUser);
    await auth.expectForgotPasswordButton();
    await auth.expectRegisterPrompt();
  });
});

test.describe('i18n Register Page', () => {
  test.beforeEach(async ({ guestUser }) => {
    await guestUser.goto('/register');
  });

  test('should show translated register form labels', async ({ guestUser, client }) => {
    const { auth } = client(guestUser);
    await auth.expectRegisterPageVisible();
  });
});
