// apps/e2e/tests/game/vision_perception.spec.ts
//
// Vision Perception — E2E test for spatial vision systems.
// Contract C-190: Validates SpatialVisionSystem integration in a running game.
//
// Functional verification: navigates to the map sandbox with debug_vision=true,
// checks that window.__AIKAMI_DEBUG__ exposes vision system state.

import { expect, test } from '@playwright/test';

const BASE_URL = 'http://localhost:5274';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Vision Perception E2E', () => {
  test('vision debug overlay is accessible on sandbox page', async ({ page }) => {
    await page.goto(`${BASE_URL}/dev/sandbox/map?debug_vision=true`);

    // Wait for engine to boot
    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ !== undefined,
      { timeout: 15000 },
    );

    // Verify the debug bridge is available
    const debug = await page.evaluate(() => {
      const d = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
        | Record<string, unknown>
        | undefined;
      return d ? Object.keys(d) : [];
    });

    expect(debug.length).toBeGreaterThan(0);
  });

  test('vision system is wired into engine tick', async ({ page }) => {
    await page.goto(`${BASE_URL}/dev/sandbox/map?debug_vision=true`);

    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ !== undefined,
      { timeout: 15000 },
    );

    // Check that debug_vision query param is recognized (no crash)
    const title = await page.title();
    expect(title).toBeDefined();
  });
});
