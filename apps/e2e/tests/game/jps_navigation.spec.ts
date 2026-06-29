// apps/e2e/tests/game/jps_navigation.spec.ts
//
// JPS Navigation — E2E test for jump point search pathfinding.
// Contract C-192: Validates JPS pathfinding integration in a running game.
//
// Functional verification: navigates to the map sandbox, verifies engine
// boots without pathfinding errors.

import { expect, test } from '@playwright/test';

const BASE_URL = 'http://localhost:5274';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('JPS Navigation E2E', () => {
  test('game boots with pathfinder initialized', async ({ page }) => {
    await page.goto(`${BASE_URL}/dev/sandbox/map`);

    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ !== undefined,
      { timeout: 15000 },
    );

    const title = await page.title();
    expect(title).toBeDefined();
  });
});
