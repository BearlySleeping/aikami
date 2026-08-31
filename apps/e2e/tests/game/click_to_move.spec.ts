// apps/e2e/tests/game/click_to_move.spec.ts
// End-to-End Click-to-Move — pointer-driven movement tests
//
// Contract: C-380 AC-4, AC-5, AC-7
//
// Navigates to the isolated map sandbox at /dev/sandbox/map, dispatches
// pointer events to click on walkable tiles, and asserts via
// window.__AIKAMI_DEBUG__ that the player moved to the expected cell.
//
// Player starts at pixel (160, 160) in the debug JTON map (C-178) — the
// center of the map, which is walkable grass (tile 5,5).
// Map: 320×320 px (10×10 tiles at 32 px).

import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { MapSandboxPage } from '$pom';

const CLIENT_PORT = 5274 + Number(process.env.PUBLIC_EMULATOR_PORT_OFFSET || 0);
const BASE_URL = `http://localhost:${CLIENT_PORT}`;

type DebugPosition = {
  playerX: number;
  playerY: number;
};

/** Reads the current player world coordinates from the debug bridge. */
const _readPlayerPosition = async (page: Page): Promise<DebugPosition> =>
  page.evaluate(() => {
    const debug = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
      | DebugPosition
      | undefined;
    if (!debug || debug.playerX === undefined || debug.playerY === undefined) {
      throw new Error('__AIKAMI_DEBUG__ not available — engine may not have started');
    }
    return { playerX: debug.playerX, playerY: debug.playerY };
  });

/** Waits for the player to reach a target position within a tolerance. */
const _waitForPlayerPosition = async (
  page: Page,
  targetX: number,
  targetY: number,
  tolerance = 16,
  timeoutMs = 5000,
): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pos = await _readPlayerPosition(page);
    const dx = Math.abs(pos.playerX - targetX);
    const dy = Math.abs(pos.playerY - targetY);
    if (dx <= tolerance && dy <= tolerance) {
      return;
    }
    await page.waitForTimeout(100);
  }
  // Final read for assertion
  const pos = await _readPlayerPosition(page);
  const dx = Math.abs(pos.playerX - targetX);
  const dy = Math.abs(pos.playerY - targetY);
  expect(dx).toBeLessThanOrEqual(tolerance);
  expect(dy).toBeLessThanOrEqual(tolerance);
};

test.describe('Click-to-Move — Pointer Input', () => {
  let mapSandbox: MapSandboxPage;

  test.beforeEach(async ({ page }) => {
    mapSandbox = new MapSandboxPage(page);
    await page.goto(`${BASE_URL}/dev/sandbox/map`);
    // Wait for the engine to boot and render at least one frame
    await page.waitForFunction(
      () => {
        const debug = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
          | DebugPosition
          | undefined;
        return debug?.playerX !== undefined && debug?.playerY !== undefined;
      },
      { timeout: 10000 },
    );
  });

  test('AC-4: click on walkable ground walks the player there', async ({ page }) => {
    // Player starts at (160, 160) — tile (5, 5) in a 32px grid.
    // Click tile (7, 5) — two tiles to the right.
    // Canvas is 800×600, map is 320×320, camera centers on player.
    // Click position needs to be relative to the canvas.
    // Tile (7, 5) center = (7 * 32 + 16, 5 * 32 + 16) = (240, 176) in world pixels.
    // Camera is at player position (160, 160) with scale 4.
    // Screen position = center + (world - camera) * scale
    // = (400 + (240 - 160) * 4, 300 + (176 - 160) * 4)
    // = (400 + 320, 300 + 64) = (720, 364)
    const screenX = 400 + (240 - 160) * 4;
    const screenY = 300 + (176 - 160) * 4;

    await mapSandbox.clickCanvasAt({ x: screenX, y: screenY });

    // Wait for player to reach tile (7, 5) center = (240, 176)
    await _waitForPlayerPosition(page, 240, 176);
  });

  test('AC-7: keyboard cancels click-path', async ({ page }) => {
    // Click a far tile to start a path
    // Click tile (8, 5) — three tiles right
    const farScreenX = 400 + (272 - 160) * 4;
    const farScreenY = 300 + (176 - 160) * 4;
    await mapSandbox.clickCanvasAt({ x: farScreenX, y: farScreenY });

    // Wait a moment for the path to start
    await page.waitForTimeout(200);

    const beforeCancel = await _readPlayerPosition(page);
    const distanceBefore = Math.hypot(beforeCancel.playerX - 272, beforeCancel.playerY - 176);

    // Hold a movement key across several fixed simulation steps so the
    // cancellation assertion observes keyboard-driven movement.
    await page.keyboard.down('ArrowLeft');
    const afterCancel = await (async (): Promise<DebugPosition> => {
      try {
        await page.waitForTimeout(100);
        return await _readPlayerPosition(page);
      } finally {
        await page.keyboard.up('ArrowLeft');
      }
    })();

    const distanceAfter = Math.hypot(afterCancel.playerX - 272, afterCancel.playerY - 176);
    const movedLeft = afterCancel.playerX < beforeCancel.playerX;
    expect(movedLeft || distanceAfter > distanceBefore).toBe(true);
  });
});
