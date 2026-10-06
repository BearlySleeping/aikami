// apps/e2e/tests/client/settings_navigation.spec.ts
// Settings page navigation test.

import { test } from '../../src/fixtures';

test.describe('Settings Navigation', () => {
  test('should show app bar on settings page', async ({ authUser }) => {
    await authUser.goto('/settings');
    await authUser.waitForLoadState('domcontentloaded');
  });
});
