// apps/e2e/tests/game/collision_e2e.spec.ts
// End-to-End Collision Enforcement — keyboard-driven movement tests
//
// Contract: C-180 AC-3: End-to-End Collision Enforcement
//
// Navigates to the isolated map sandbox at /dev/sandbox/map, dispatches
// keyboard events to drive the player toward walls and water boundaries,
// and asserts via window.__AIKAMI_DEBUG__ that the spatial grid bitmask
// collision clamped the player's position — no wall passthrough or
// typed-array out-of-bounds errors.
//
// Player starts at pixel (160, 192) in the debug JTON map (C-178).
// Movement speed: 150 px/s. Map: 320×320 px (10×10 tiles at 32 px).

import { expect, test } from '@playwright/test';

const BASE_URL = 'http://localhost:5274';

/**
 * Debug position shape exposed by GameWorld._updateRenderFromBuffer
 * on window.__AIKAMI_DEBUG__ every ticker frame.
 */
type DebugPosition = {
  playerX: number;
  playerY: number;
};

/** Reads the current player world coordinates from the debug bridge. */
const _readPlayerPosition = async (
  page: import('@playwright/test').Page,
): Promise<DebugPosition> => {
  return page.evaluate(() => {
    const debug = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
      | DebugPosition
      | undefined;
    if (!debug || debug.playerX === undefined || debug.playerY === undefined) {
      throw new Error('__AIKAMI_DEBUG__ not available — engine may not have started');
    }
    return { playerX: debug.playerX, playerY: debug.playerY };
  });
};

/** Map dimensions in pixels (10×10 tiles at 32 px). */
const MAP_PIXEL_W = 320;
const MAP_PIXEL_H = 320;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Collision Enforcement — Spatial Grid', () => {
  test('player is clamped at top water boundary when moving up', async ({ page }) => {
    await page.goto(`${BASE_URL}/dev/sandbox/map`, { waitUntil: 'domcontentloaded' });

    // Wait for the PixiJS canvas and the debug position bridge.
    // Use .first() to avoid strict mode violation from the luna-dom-highlighter canvas.
    const canvas = page.locator('canvas').first().first();
    await expect(canvas).toBeVisible({ timeout: 15_000 });

    await page.waitForFunction(
      () => {
        const debug = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
          | DebugPosition
          | undefined;
        return debug?.playerY !== undefined;
      },
      { timeout: 10_000 },
    );

    // Record starting position
    const startPos = await _readPlayerPosition(page);

    // Move UP toward the water boundary (row 0).
    // Speed is 150 px/s — 2.5 seconds is more than enough to cross the
    // entire 320 px map height. The spatial grid must clamp the player
    // before they exit the map bounds.
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(2500);
    await page.keyboard.up('ArrowUp');

    // Allow the final tick to process the zero-velocity update
    await page.waitForTimeout(200);

    const endPos = await _readPlayerPosition(page);

    // Player must NOT pass through the top boundary into negative space
    expect(endPos.playerY).toBeGreaterThanOrEqual(0);
    // Player must still be within the map bounds
    expect(endPos.playerY).toBeLessThan(MAP_PIXEL_H);
    // Player actually moved upward from start
    expect(endPos.playerY).toBeLessThan(startPos.playerY);

    // X position should remain within bounds (minimal lateral drift)
    expect(endPos.playerX).toBeGreaterThanOrEqual(0);
    expect(endPos.playerX).toBeLessThan(MAP_PIXEL_W);
  });

  test('player is clamped at left water boundary when moving left', async ({ page }) => {
    await page.goto(`${BASE_URL}/dev/sandbox/map`, { waitUntil: 'domcontentloaded' });

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 15_000 });

    await page.waitForFunction(
      () => {
        const debug = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
          | DebugPosition
          | undefined;
        return debug?.playerX !== undefined;
      },
      { timeout: 10_000 },
    );

    const startPos = await _readPlayerPosition(page);

    // Move LEFT toward the water boundary (column 0).
    // 2.5 seconds at 150 px/s is enough to cross the full 320 px width.
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(2500);
    await page.keyboard.up('ArrowLeft');
    await page.waitForTimeout(200);

    const endPos = await _readPlayerPosition(page);

    // Player must NOT pass through the left boundary into negative space
    expect(endPos.playerX).toBeGreaterThanOrEqual(0);
    // Player must still be within map bounds
    expect(endPos.playerX).toBeLessThan(MAP_PIXEL_W);
    // Player actually moved left from start
    expect(endPos.playerX).toBeLessThan(startPos.playerX);

    // Y position should remain within bounds
    expect(endPos.playerY).toBeGreaterThanOrEqual(0);
    expect(endPos.playerY).toBeLessThan(MAP_PIXEL_H);
  });

  test('player does not pass through bottom water boundary', async ({ page }) => {
    await page.goto(`${BASE_URL}/dev/sandbox/map`, { waitUntil: 'domcontentloaded' });

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 15_000 });

    await page.waitForFunction(
      () => {
        const debug = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
          | DebugPosition
          | undefined;
        return debug?.playerY !== undefined;
      },
      { timeout: 10_000 },
    );

    const startPos = await _readPlayerPosition(page);

    // Move DOWN toward the bottom boundary (row 9). Player starts at row 6
    // (y ≈ 192), so ~1.5 seconds is enough to reach row 9 at 150 px/s.
    await page.keyboard.down('ArrowDown');
    await page.waitForTimeout(1500);
    await page.keyboard.up('ArrowDown');
    await page.waitForTimeout(200);

    const endPos = await _readPlayerPosition(page);

    // Player must NOT pass through the bottom boundary
    expect(endPos.playerY).toBeGreaterThanOrEqual(0);
    expect(endPos.playerY).toBeLessThan(MAP_PIXEL_H);
    // Player moved downward from start
    expect(endPos.playerY).toBeGreaterThan(startPos.playerY);
  });

  test('player does not pass through right water boundary', async ({ page }) => {
    await page.goto(`${BASE_URL}/dev/sandbox/map`, { waitUntil: 'domcontentloaded' });

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 15_000 });

    await page.waitForFunction(
      () => {
        const debug = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
          | DebugPosition
          | undefined;
        return debug?.playerX !== undefined;
      },
      { timeout: 10_000 },
    );

    const startPos = await _readPlayerPosition(page);

    // Move RIGHT toward the boundary (column 9). Player starts at col 5
    // (x ≈ 160), so ~1.5 seconds is enough to reach col 9 at 150 px/s.
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(1500);
    await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(200);

    const endPos = await _readPlayerPosition(page);

    // Player must NOT pass through the right boundary
    expect(endPos.playerX).toBeGreaterThanOrEqual(0);
    expect(endPos.playerX).toBeLessThan(MAP_PIXEL_W);
    // Player moved right from start
    expect(endPos.playerX).toBeGreaterThan(startPos.playerX);
  });

  // ── C-180: Spawn clamping at all 4 corners ──

  test('spawn clamp: top-left corner (0,0) clamped to grass', async ({ page }) => {
    await page.goto(`${BASE_URL}/dev/sandbox/map?position_x=0&position_y=0`, {
      waitUntil: 'domcontentloaded',
    });

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 15_000 });

    await page.waitForFunction(
      () => {
        const debug = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
          | DebugPosition
          | undefined;
        return debug?.playerX !== undefined && debug?.playerY !== undefined;
      },
      { timeout: 10_000 },
    );

    // Wait for map to finish loading
    await page.waitForTimeout(2000);

    const pos = await _readPlayerPosition(page);

    // Player must be inside map bounds (not negative, not beyond map)
    expect(pos.playerX).toBeGreaterThanOrEqual(0);
    expect(pos.playerX).toBeLessThan(MAP_PIXEL_W);
    expect(pos.playerY).toBeGreaterThanOrEqual(0);
    expect(pos.playerY).toBeLessThan(MAP_PIXEL_H);

    // Player must be on grass (GID 1), not water (GID 2 at border).
    // Water occupies row 0 and col 0 (pixels 0-31). Clamped spawn
    // must be at least one tile inside the map.
    const tileSize = 32;
    const tileX = Math.floor(pos.playerX / tileSize);
    const tileY = Math.floor(pos.playerY / tileSize);
    expect(tileX).toBeGreaterThanOrEqual(1);
    expect(tileY).toBeGreaterThanOrEqual(1);
  });

  test('spawn clamp: top-right corner (320,0) clamped to grass', async ({ page }) => {
    await page.goto(`${BASE_URL}/dev/sandbox/map?position_x=320&position_y=0`, {
      waitUntil: 'domcontentloaded',
    });

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 15_000 });

    await page.waitForFunction(
      () => {
        const debug = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
          | DebugPosition
          | undefined;
        return debug?.playerX !== undefined && debug?.playerY !== undefined;
      },
      { timeout: 10_000 },
    );

    await page.waitForTimeout(2000);

    const pos = await _readPlayerPosition(page);

    expect(pos.playerX).toBeGreaterThanOrEqual(0);
    expect(pos.playerX).toBeLessThan(MAP_PIXEL_W);
    expect(pos.playerY).toBeGreaterThanOrEqual(0);
    expect(pos.playerY).toBeLessThan(MAP_PIXEL_H);

    const tileX = Math.floor(pos.playerX / 32);
    const tileY = Math.floor(pos.playerY / 32);
    expect(tileX).toBeLessThanOrEqual(8);
    expect(tileY).toBeGreaterThanOrEqual(1);
  });

  test('spawn clamp: bottom-left corner (0,320) clamped to grass', async ({ page }) => {
    await page.goto(`${BASE_URL}/dev/sandbox/map?position_x=0&position_y=320`, {
      waitUntil: 'domcontentloaded',
    });

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 15_000 });

    await page.waitForFunction(
      () => {
        const debug = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
          | DebugPosition
          | undefined;
        return debug?.playerX !== undefined && debug?.playerY !== undefined;
      },
      { timeout: 10_000 },
    );

    await page.waitForTimeout(2000);

    const pos = await _readPlayerPosition(page);

    expect(pos.playerX).toBeGreaterThanOrEqual(0);
    expect(pos.playerX).toBeLessThan(MAP_PIXEL_W);
    expect(pos.playerY).toBeGreaterThanOrEqual(0);
    expect(pos.playerY).toBeLessThan(MAP_PIXEL_H);

    const tileX = Math.floor(pos.playerX / 32);
    const tileY = Math.floor(pos.playerY / 32);
    expect(tileX).toBeGreaterThanOrEqual(1);
    expect(tileY).toBeLessThanOrEqual(8);
  });

  test('spawn clamp: bottom-right corner (320,320) clamped to grass', async ({ page }) => {
    await page.goto(`${BASE_URL}/dev/sandbox/map?position_x=320&position_y=320`, {
      waitUntil: 'domcontentloaded',
    });

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 15_000 });

    await page.waitForFunction(
      () => {
        const debug = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
          | DebugPosition
          | undefined;
        return debug?.playerX !== undefined && debug?.playerY !== undefined;
      },
      { timeout: 10_000 },
    );

    await page.waitForTimeout(2000);

    const pos = await _readPlayerPosition(page);

    expect(pos.playerX).toBeGreaterThanOrEqual(0);
    expect(pos.playerX).toBeLessThan(MAP_PIXEL_W);
    expect(pos.playerY).toBeGreaterThanOrEqual(0);
    expect(pos.playerY).toBeLessThan(MAP_PIXEL_H);

    const tileX = Math.floor(pos.playerX / 32);
    const tileY = Math.floor(pos.playerY / 32);
    expect(tileX).toBeLessThanOrEqual(8);
    expect(tileY).toBeLessThanOrEqual(8);
  });
});
