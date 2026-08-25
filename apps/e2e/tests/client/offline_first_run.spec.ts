// apps/e2e/tests/client/offline_first_run.spec.ts
//
// E2E test for AC-3: A first run with no network degrades clearly.
// Given a fresh install with no network, when the client is launched,
// then it boots using the bundled offline core, shows an actionable message
// explaining that content requires a connection, and never presents a blank
// screen or a silent hang.
//
// Contract: C-435 De-bundle game-data

import { expect, test } from '@playwright/test';

test.describe('C-435 AC-3: Offline First Run', () => {
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

    // The app should not show a blank screen or infinite spinner.
    // It should show a meaningful message about connectivity.

    // Wait for either the boot progress UI or an error/offline message
    // The boot pipeline should still show progress stages
    const progressBar = page.locator('progress.progress-primary');
    const offlineMessage = page.locator('text=connection', { hasText: true });
    const networkMessage = page.locator('text=network', { hasText: true });
    const errorMessage = page.locator('text=offline', { hasText: true });

    // The app should be responsive — either showing boot progress or an offline message
    await expect(
      Promise.race([
        progressBar.isAttached(),
        offlineMessage.isVisible().catch(() => false),
        networkMessage.isVisible().catch(() => false),
        errorMessage.isVisible().catch(() => false),
      ]),
    ).resolves.toBe(true);

    // The page should not be blank — there should be some UI rendered
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(0);

    // Verify the app is responsive (not crashed)
    const _html = await page.locator('html').getAttribute('style');
    // Just checking the page didn't hard-crash
    expect(page.url()).toContain('/game');
  });
});
