// apps/e2e/tests/hub/walk_sandbox_failures.spec.ts
//
// C-447 AC-4: failure states are explicit — unknown tag 404s, WebGL
// unavailability, worker failure, and map load failure each render
// their named message.

import { expect, test } from '@playwright/test';

test.describe('Hub walk sandbox failures — C-447 AC-4', () => {
  test('unknown map tag shows not-found error', async ({ page }) => {
    const response = await page.goto('/sandbox/does-not-exist');

    // In dev mode, SvelteKit returns 200 for the app shell and renders
    // the error page client-side. In production, the server load function
    // returns a proper 404. We assert on the response status when available
    // and on the page content as a fallback.
    if (response && response.status() !== 200) {
      expect(response.status()).toBe(404);
    } else {
      // Dev mode: the error page should mention "not found"
      await expect(page.locator('body')).toContainText(/not found/i);
    }
  });

  test('WebGL unavailable shows explicit error', async ({ page }) => {
    // Simulate WebGL unavailability by overriding getContext
    await page.addInitScript(() => {
      const originalGetContext = HTMLCanvasElement.prototype.getContext.bind(
        HTMLCanvasElement.prototype,
      );
      HTMLCanvasElement.prototype.getContext = ((contextId: string, ...args: unknown[]) => {
        if (contextId === 'webgl2' || contextId === 'webgl') {
          return null;
        }
        return originalGetContext(contextId, ...args);
      }) as typeof HTMLCanvasElement.prototype.getContext;
    });

    await page.goto('/sandbox/maps:sandbox_zone_a');
    await expect(page.getByTestId('sandbox-error')).toBeVisible({ timeout: 15000 });
    const errorText = await page.getByTestId('sandbox-error').textContent();
    expect(errorText?.toLowerCase()).toContain('webgl');
  });

  test('worker failure shows explicit error', async ({ page }) => {
    // Block worker script to simulate worker construction failure
    await page.route('**/ecs_worker*', (route) => route.abort('blockedbyclient'));

    await page.goto('/sandbox/maps:sandbox_zone_a');
    await expect(page.getByTestId('sandbox-error')).toBeVisible({ timeout: 15000 });
    const errorText = await page.getByTestId('sandbox-error').textContent();
    expect(errorText?.toLowerCase()).toContain('worker');
  });

  test('map load failure shows explicit error', async ({ page }) => {
    // Block asset requests to simulate map load failure
    await page.route('**/assets/**', (route) => route.abort('blockedbyclient'));

    await page.goto('/sandbox/maps:sandbox_zone_a');
    await expect(page.getByTestId('sandbox-error')).toBeVisible({ timeout: 15000 });
    const errorText = await page.getByTestId('sandbox-error').textContent();
    expect(errorText?.toLowerCase()).toContain('could not load');
  });
});
