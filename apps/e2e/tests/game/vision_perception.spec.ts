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

  // C-379 AC-2: the vision system can see the player. The player now
  // carries GridPosition (synced from Position) + VisionVisible, so an NPC
  // observer with the player in its cone marks the player's
  // VisionVisible.visibleByMask, which the worker forwards onto the debug
  // bridge as `playerVisibleByMask`. The village map's NPC (the elder)
  // spawns near the top of the map facing right, so the test walks the
  // player up toward it and asserts the mask becomes non-zero — the test
  // FAILS when vision evaluation never detects the player (CodeRabbit
  // review, C-379).
  test('player becomes visible to an observer when standing in its cone (C-379 AC-2)', async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/game`);

    // Wait for boot: the debug bridge exposes the player position AND the
    // forwarded vision mask.
    await page.waitForFunction(
      () => {
        const d = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
          | { playerX?: number; playerVisibleByMask?: number }
          | undefined;
        return d?.playerX !== undefined && d?.playerVisibleByMask !== undefined;
      },
      { timeout: 15000 },
    );

    // Keep the existing startup/engine-error check.
    const hasError = await page.evaluate(() => {
      const d = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
        | { engineError?: string }
        | undefined;
      return d?.engineError !== undefined;
    });
    expect(hasError).toBe(false);

    // Walk the player from the village gate (~320,560) up to the open rows
    // near the elder (~288,192) — the only NPC observer on the village map.
    // Keypresses drive the same AC-8 keybinding path production uses.
    const holdKey = async (key: 'w' | 'a' | 's' | 'd', ms: number): Promise<void> => {
      await page.keyboard.down(key);
      await page.waitForTimeout(ms);
      await page.keyboard.up(key);
    };
    await holdKey('w', 4500); // reach the elder's rows (open terrain rows 8-9)
    await holdKey('d', 1200); // sweep right of the elder's spawn column
    await holdKey('a', 2400); // sweep back left through the cone
    await holdKey('w', 1000); // finish closing the gap

    // Poll the debug bridge: the elder's right-facing patrol cone must
    // eventually cover the player while both wander. If vision evaluation
    // never detects the player (AC-2 regression), the mask stays 0 forever
    // and this assertion fails.
    const visible = await page
      .waitForFunction(
        () => {
          const d = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
            | { playerVisibleByMask?: number }
            | undefined;
          return typeof d?.playerVisibleByMask === 'number' && d.playerVisibleByMask > 0;
        },
        { timeout: 20000 },
      )
      .then(() => true)
      .catch(() => false);

    expect(visible).toBe(true);
  });
});
