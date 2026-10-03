// apps/e2e/tests/game/click_to_move.spec.ts
// End-to-End Click-to-Move — pointer-driven movement tests
//
// Contract: C-380 AC-4, AC-5, AC-7
//
// Two suites live here:
//
// 1. The isolated map sandbox (/dev/sandbox/map) — pointer input against a
//    known, fixed debug JTON map (C-178). Player starts at pixel (160, 160),
//    the centre of a 320×320 px map (10×10 tiles at 32 px).
// 2. Production-route movement on /game — the same interaction, but against
//    the world a player actually boots. It proves two things the sandbox
//    cannot: that the displayed world is really loaded (entity textures
//    resolved, NPCs present) and that the camera — the world→screen transform
//    the player sees — follows the movement.
//
// 🔴 Publishing `playerX`/`playerY` is NOT proof a map loaded. The sandbox
// reaches that state with a blank world when its debug atlas 404s, which is
// exactly how a click-to-move test can "pass" against nothing. Both suites
// therefore gate on loaded-world state first.

import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { GamePage, MapSandboxPage } from '$pom';
import { EMULATOR_PORTS } from '../../src/config';

const BASE_URL = `http://localhost:${EMULATOR_PORTS.client}`;

type DebugPosition = {
  playerX: number;
  playerY: number;
};

/** Frozen engine snapshot: entity counts plus the live camera position. */
type EngineState = {
  entityCount: number;
  npcCount: number;
  cameraX: number;
  cameraY: number;
};

/** Minimum world-pixel displacement that counts as "the player actually moved". */
const MIN_DISPLACEMENT_PX = 8;

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

/** Reads the frozen engine snapshot (entity counts + camera) from the debug bridge. */
const _readEngineState = async (page: Page): Promise<EngineState> =>
  page.evaluate(() => {
    const state = (window as unknown as Record<string, unknown>).__AIKAMI_ENGINE_STATE__ as
      | EngineState
      | undefined;
    if (!state || state.entityCount === undefined) {
      throw new Error('__AIKAMI_ENGINE_STATE__ not available — engine may not have started');
    }
    return {
      entityCount: state.entityCount,
      npcCount: state.npcCount,
      cameraX: state.cameraX,
      cameraY: state.cameraY,
    };
  });

/**
 * Polls `read` until `predicate` holds, then returns the satisfying snapshot.
 *
 * A real timeout failure (never a widened one): if the world never satisfies
 * the predicate the test fails with the last observed snapshot attached.
 */
const _waitUntil = async <T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs: number,
): Promise<T> => {
  const start = Date.now();
  let last = await read();
  while (Date.now() - start < timeoutMs) {
    if (predicate(last)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    last = await read();
  }
  throw new Error(
    `condition not met within ${timeoutMs}ms; last observed snapshot: ${JSON.stringify(last)}`,
  );
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
    // A published player position with an empty world is not a usable sandbox:
    // fail here with the real reason instead of asserting a click against a
    // blank map (the debug atlas 404 case).
    const state = await _readEngineState(page);
    expect(
      state.entityCount,
      'sandbox world has no entities — debug atlas/tiles did not load, so click-to-move cannot be proven here',
    ).toBeGreaterThan(0);
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

// ────────────────────────────────────────────────────────────
// Production route — /game, the world a player actually boots
// ────────────────────────────────────────────────────────────

test.describe('Click-to-Move — production /game route', () => {
  test('the displayed world is loaded before any movement is asserted', async ({ page }) => {
    const game = new GamePage(page);
    await game.goto();
    await game.waitForPlayingState();

    const state = await _readEngineState(page);
    // Entities exist…
    expect(state.entityCount).toBeGreaterThan(0);
    // …including NPCs, so the village actually populated…
    expect(state.npcCount).toBeGreaterThan(0);
    // …and their appearances resolved through the shared named-appearance
    // normalization, which only happens when real entity textures loaded.
    const elderSlots = await page.evaluate(
      () =>
        (window as unknown as Record<string, Record<string, Record<string, string>> | undefined>)
          .__AIKAMI_DEBUG__?.npcAppearance?.village_elder ?? {},
    );
    expect(Object.keys(elderSlots).length).toBeGreaterThan(0);
  });

  test('a click to the right moves the player and the camera follows', async ({ page }) => {
    const game = new GamePage(page);
    await game.goto();
    await game.waitForPlayingState();
    await expect(page.getByTestId('game-ui-overlay-layer')).toBeVisible();

    const canvasBox = await game.canvas.boundingBox();
    if (!canvasBox) {
      throw new Error('production game canvas is not visible');
    }
    // The camera centres the player, so a click right of centre is a walkable
    // target a few tiles away — no fixture tile coordinates are invented here.
    const clickX = canvasBox.x + canvasBox.width / 2 + canvasBox.width * 0.12;
    const clickY = canvasBox.y + canvasBox.height / 2;

    const before = {
      position: await _readPlayerPosition(page),
      state: await _readEngineState(page),
    };
    await page.mouse.click(clickX, clickY);

    // The player must actually displace toward the click…
    const moved = await _waitUntil(
      () => _readPlayerPosition(page),
      (position) => position.playerX - before.position.playerX >= MIN_DISPLACEMENT_PX,
      10_000,
    );
    expect(moved.playerX - before.position.playerX).toBeGreaterThanOrEqual(MIN_DISPLACEMENT_PX);

    // …and come to rest there, rather than drifting back to the spawn.
    const settled = await _waitUntil(
      () => _readPlayerPosition(page),
      (position) => Math.abs(position.playerX - moved.playerX) < 1,
      10_000,
    );
    expect(settled.playerX).toBeGreaterThan(before.position.playerX + MIN_DISPLACEMENT_PX);

    // The world→screen transform the player sees followed: the camera moved
    // with them, so the click landed where it was aimed.
    const after = await _readEngineState(page);
    expect(after.cameraX).toBeGreaterThan(before.state.cameraX);
  });
});
