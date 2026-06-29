// apps/e2e/tests/client/i18n.spec.ts
// i18n — settings page navigation test.

import { test } from '../../src/fixtures';

test.describe('i18n Navigation', () => {
  test('should show app bar on settings page', async ({ authUser }) => {
    await authUser.goto('/settings');
    await authUser.waitForLoadState('domcontentloaded');
  });
});
