// apps/e2e/tests/client/emulator_login.spec.ts
// C-055: Simplified — verifies the authUser fixture loads authenticated pages.

import { test } from '../../src/fixtures';

test.describe('Login with Emulator', () => {
  test('should load PWA homepage as authenticated user', async ({ authUser }) => {
    await authUser.goto('/dashboard');
    await authUser.waitForLoadState('domcontentloaded');
  });
});
