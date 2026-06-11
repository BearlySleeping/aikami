// apps/e2e/tests/client/example.spec.ts
// C-055: Fixed — uses corrected ClientAuthPage methods.
// "Forgot password?" and "Don't have an account?" are buttons, not links.

import { test } from '../../src/fixtures';

test.describe('PWA Public Pages', () => {
  test('should show login page for unauthenticated users', async ({ guestUser, client }) => {
    const { auth } = client(guestUser);
    await auth.gotoLogin();
    await auth.expectLoginPageVisible();
  });

  test('should show register page for unauthenticated users', async ({ guestUser, client }) => {
    const { auth } = client(guestUser);
    await auth.gotoRegister();
    await auth.expectRegisterPageVisible();
  });

  test('should show forgot password button on login page', async ({ guestUser, client }) => {
    const { auth } = client(guestUser);
    await auth.gotoLogin();
    await auth.expectForgotPasswordButton();
  });

  test('should show register prompt on login page', async ({ guestUser, client }) => {
    const { auth } = client(guestUser);
    await auth.gotoLogin();
    await auth.expectRegisterPrompt();
  });
});
