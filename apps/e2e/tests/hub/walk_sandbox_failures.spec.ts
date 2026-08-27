// apps/e2e/tests/hub/walk_sandbox_failures.spec.ts
//
// C-447 AC-4: failure states are explicit — unknown tag 404s, WebGL
// unavailability, worker failure, and map load failure each render
// their named message.

import { expect, test } from '@playwright/test';

test.describe('Hub walk sandbox failures — C-447 AC-4', () => {
  test('unknown map tag returns 404', async ({ page }) => {
    const response = await page.goto('/sandbox/does-not-exist');
    expect(response?.status()).toBe(404);
  });

  test('WebGL unavailable shows explicit error', async ({ page }) => {
    // Simulate WebGL unavailability by overriding getContext
    await page.addInitScript(() => {
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = ((...args: [contextId: string, options?: unknown]) => {
        const contextType = args[0];
        if (contextType === 'webgl2' || contextType === 'webgl') {
          return null;
        }
        return originalGetContext.apply(HTMLCanvasElement.prototype, args);
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
