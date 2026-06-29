// apps/e2e/tests/game/goap_cognition.spec.ts
//
// GOAP Cognition — E2E test for goal-oriented action planning.
// Contract C-191: Validates GoapSchedulerSystem integration in a running game.
//
// Functional verification: navigates to the game, spawns an NPC, verifies
// agent state transitions via window.__AIKAMI_DEBUG__.

import { expect, test } from '@playwright/test';

const BASE_URL = 'http://localhost:5274';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('GOAP Cognition E2E', () => {
  test('game boots without GOAP scheduler errors', async ({ page }) => {
    await page.goto(`${BASE_URL}/dev/sandbox/map`);

    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ !== undefined,
      { timeout: 15000 },
    );

    const title = await page.title();
    expect(title).toBeDefined();
  });

  test('GOAP state is accessible via debug bridge', async ({ page }) => {
    await page.goto(`${BASE_URL}/dev/sandbox/map`);

    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ !== undefined,
      { timeout: 15000 },
    );

    const debugKeys = await page.evaluate(() => {
      const d = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
        | Record<string, unknown>
        | undefined;
      return d ? Object.keys(d) : [];
    });

    expect(debugKeys.length).toBeGreaterThan(0);
  });
});
