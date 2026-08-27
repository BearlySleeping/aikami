// apps/e2e/tests/client/offline_first_run.spec.ts
//
// E2E test for C-448 AC-6: A first run with no network degrades clearly.
// Given a fresh install with no network, when the client is launched,
// then it shows the named message about needing to download starter content,
// does not hang, and does not show a blank screen.
//
// Contract: C-448 De-bundle Content Packs

import { expect, test } from '@playwright/test';

test.describe('C-448 AC-6: Offline First Run', () => {
  test('should show actionable message when launched with no network on fresh install', async ({
    page,
    context,
  }) => {
    // Block all network requests to simulate no connectivity
    await context.route('**/*', (route) => {
      const url = route.request().url();
      // Allow data: and blob: URIs (local assets)
      if (url.startsWith('data:') || url.startsWith('blob:')) {
        route.continue();
      } else {
        route.abort('internetdisconnected');
      }
    });

    // Navigate to game with network blocked
    await page.goto('/game');

    // The app should show the actionable first-run connectivity error message
    const starterContentMessage = page.locator(
      'text=Aikami needs to download starter content the first time you play',
    );
    await expect(starterContentMessage).toBeVisible({ timeout: 30000 });

    // The message should instruct the user to connect to the internet
    const connectMessage = page.locator('text=Connect to the internet and try again');
    await expect(connectMessage).toBeVisible({ timeout: 5000 });

    // Verify the app is responsive (not crashed)
    expect(page.url()).toContain('/game');
  });
});
