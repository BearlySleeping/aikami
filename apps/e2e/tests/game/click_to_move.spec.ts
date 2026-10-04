// apps/e2e/tests/game/click_to_move.spec.ts
// End-to-End Click-to-Move — pointer-driven movement tests
//
// Contract: C-380 AC-4, AC-5, AC-7
//
// Two suites live here:
//
// 1. The isolated map sandbox (/dev/sandbox/map) — pointer input against the
//    authored debug map `maps:sandbox_zone_a` (C-178). That map authors NO
//    `playerSpawn`, so the requested (0, 0) fallback is clamped by the worker to
//    the nearest walkable ground; the player's real start is therefore READ from
//    the live engine, never assumed.
// 2. Production-route movement on /game — the same interaction against the
//    world a player actually boots: the displayed world really loaded (terrain
//    rendered, NPC appearance textures resolved) and the camera — the
//    world→screen transform the player sees — follows the movement.
//
// 🔴 Every fact below is read LIVE. `__AIKAMI_ENGINE_STATE__` is published only
// in the frozen deterministic E2E mode (see `GameWorld._exposeEngineState`),
// where the ticker is stopped after one frame — i.e. exactly the mode in which
// movement cannot happen. Reading it here guaranteed the snapshot would be
// absent (or frozen) on an interactive route, so this suite reads the two
// globals an interactive route actually publishes:
//
//   • `__AIKAMI_DEBUG__` — player world position + NPC appearance map.
//   • `__PIXI_APP__` — the live Pixi stage/renderer, from which the world
//     container's actual transform yields the DISPLAYED camera and world scale.
//
// 🔴 No coordinate is invented. The click conversion inverts the same transform
// the renderer applied (`worldContainer.x = screen.width/2 − cameraX·scale`),
// and the click TARGET is derived from the player's own live position on the
// engine's 32 px grid — never from a hardcoded 160,160 / 800×600 assumption.

import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { GamePage, MapSandboxPage } from '$pom';
import { EMULATOR_PORTS } from '../../src/config';

const BASE_URL = `http://localhost:${EMULATOR_PORTS.client}`;

/** Player-scoped fields the engine publishes on the LIVE debug bridge. */
type DebugPosition = {
  playerX: number;
  playerY: number;
  npcCount: number;
  npcAppearance: Record<string, Record<string, string>>;
};

/**
 * The live world→screen transform, recovered from the running renderer's
 * world container rather than from any authored viewport constant.
 */
type LiveView = {
  /** Canvas element CSS size — the click coordinate space. */
  canvasCssWidth: number;
  canvasCssHeight: number;
  /** Renderer logical screen (CSS px) the camera centres against. */
  screenWidth: number;
  screenHeight: number;
  /** Live world scale (BASE_WORLD_SCALE × live camera zoom). */
  worldScale: number;
  /** Camera position recovered from the world container transform. */
  cameraX: number;
  cameraY: number;
  /** Rendered terrain evidence: bands present and chunk meshes actually built. */
  terrainBandCount: number;
  terrainChunkCount: number;
};

/** Engine tile size on the world grid (see `GameWorld.tileSize`). */
const TILE_SIZE_PX = 32;

/** Minimum world-pixel displacement that counts as "the player actually moved". */
const MIN_DISPLACEMENT_PX = 8;

/** Reads the current player world coordinates from the LIVE debug bridge. */
const _readPlayerPosition = async (page: Page): Promise<DebugPosition> =>
  page.evaluate(() => {
    const debug = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
      | Record<string, unknown>
      | undefined;
    if (!debug || debug.playerX === undefined || debug.playerY === undefined) {
      throw new Error('__AIKAMI_DEBUG__ not available — engine may not have started');
    }
    return debug as unknown as DebugPosition;
  });

/**
 * Reads the live render transform and terrain evidence off the Pixi stage.
 *
 * Fails loudly rather than returning defaults: a world with no tilemap band is a
 * blank/unloaded world, and the suite must say so instead of clicking at
 * something.
 */
const _readLiveView = async (page: Page): Promise<LiveView> =>
  page.evaluate(() => {
    type Dict = Record<string, unknown>;
    const isRecord = (value: unknown): value is Dict => value instanceof Object;
    const childrenOf = (value: unknown): unknown[] =>
      isRecord(value) && Array.isArray(value.children) ? (value.children as unknown[]) : [];
    const labelOf = (value: unknown): string =>
      isRecord(value) && typeof value.label === 'string' ? value.label : '';
    const startsWith = (value: unknown, prefix: string): boolean =>
      labelOf(value).startsWith(prefix);
    const numberOf = (value: unknown, key: string): number | undefined => {
      if (!isRecord(value)) {
        return undefined;
      }
      const candidate = value[key];
      return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
    };
    const required = (value: unknown, what: string): Dict => {
      if (!isRecord(value)) {
        throw new Error(`${what} is unavailable — the live render bridge is not published`);
      }
      return value;
    };
    /** Counts terrain chunk meshes under a node — the actual terrain draw calls. */
    const countChunks = (node: unknown): number =>
      (startsWith(node, 'chunk-') ? 1 : 0) +
      childrenOf(node).reduce<number>((total, child) => total + countChunks(child), 0);

    const globals = window as unknown as Dict;
    const app = required(globals.__PIXI_APP__, '__PIXI_APP__');
    const canvas = document.querySelector('canvas');
    if (!canvas) {
      throw new Error('no canvas element on the page');
    }
    const worldContainer = required(
      childrenOf(app.stage).find((child) =>
        childrenOf(child).some((nested) => startsWith(nested, 'tilemap-band-')),
      ),
      'the world container — the map terrain never rendered (blank world)',
    );
    // An empty chunk set is an unloaded map even when the band container exists.
    const terrainChunkCount = countChunks(worldContainer);
    if (terrainChunkCount === 0) {
      throw new Error(
        'tilemap band present but no terrain chunk meshes were built — map not loaded',
      );
    }
    const rendererScreen = isRecord(app.renderer) ? app.renderer.screen : undefined;
    const screenWidth = numberOf(rendererScreen, 'width') ?? numberOf(app.screen, 'width') ?? 0;
    const screenHeight = numberOf(rendererScreen, 'height') ?? numberOf(app.screen, 'height') ?? 0;
    const worldScale = numberOf(worldContainer.scale, 'x') ?? 0;
    if (screenWidth <= 0 || screenHeight <= 0 || worldScale <= 0) {
      throw new Error(
        `degenerate render transform: screen=${screenWidth}x${screenHeight} scale=${worldScale}`,
      );
    }
    const terrainBandCount = childrenOf(worldContainer).filter((nested) =>
      startsWith(nested, 'tilemap-band-'),
    ).length;
    return {
      canvasCssWidth: canvas.clientWidth,
      canvasCssHeight: canvas.clientHeight,
      screenWidth,
      screenHeight,
      worldScale,
      // The renderer applies `worldContainer.x = screen.width/2 − cameraX·scale`
      // every frame; inverting it recovers the camera the player actually sees.
      cameraX: (screenWidth / 2 - (numberOf(worldContainer.position, 'x') ?? 0)) / worldScale,
      cameraY: (screenHeight / 2 - (numberOf(worldContainer.position, 'y') ?? 0)) / worldScale,
      terrainBandCount,
      terrainChunkCount,
    };
  });

/**
 * Waits until the live view satisfies `predicate`, then returns the snapshot.
 *
 * Boot publishes the debug and Pixi bridges on different frames, so a read that
 * throws while the world is still coming up is a "not yet", not a failure: the
 * error is kept and surfaced only if the timeout expires. A real timeout
 * failure (never a widened one) — the last snapshot OR the last read error is
 * attached to it, so a world that never comes up says why.
 */
const _waitUntil = async <T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs: number,
  label: string,
): Promise<T> => {
  const start = Date.now();
  let last: T | undefined;
  let lastError: unknown;
  const sample = async (): Promise<T | undefined> => {
    try {
      last = await read();
      lastError = undefined;
      return predicate(last) ? last : undefined;
    } catch (error) {
      lastError = error;
      return undefined;
    }
  };
  const satisfied = await sample();
  if (satisfied !== undefined) {
    return satisfied;
  }
  while (Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const value = await sample();
    if (value !== undefined) {
      return value;
    }
  }
  const detail =
    lastError !== undefined
      ? `last read error: ${String(lastError)}`
      : `last observed snapshot: ${JSON.stringify(last)}`;
  throw new Error(`condition "${label}" not met within ${timeoutMs}ms; ${detail}`);
};

/** Waits for a loaded, rendering world on either route (live bridge, no freeze). */
const _waitForRenderedWorld = async (page: Page): Promise<LiveView> =>
  _waitUntil(
    async () => {
      // Both reads are required: the debug bridge proves the engine is ticking
      // with a player, the Pixi bridge proves terrain is actually on screen.
      await _readPlayerPosition(page);
      return await _readLiveView(page);
    },
    () => true,
    30_000,
    'rendered world (live debug bridge + rendered terrain)',
  );

/**
 * Converts a world point to canvas-CSS pixels through the LIVE transform.
 *
 * `screenPoint = centre + (world − camera)·scale`, where `centre` is the
 * renderer's logical screen — so a canvas whose CSS size differs from the
 * renderer screen (device pixel ratio, autoDensity) still clicks the tile the
 * player sees.
 */
const _canvasPointForWorld = async (
  page: Page,
  worldX: number,
  worldY: number,
): Promise<{ x: number; y: number }> => {
  const view = await _readLiveView(page);
  const localX = view.screenWidth / 2 + (worldX - view.cameraX) * view.worldScale;
  const localY = view.screenHeight / 2 + (worldY - view.cameraY) * view.worldScale;
  if (view.canvasCssWidth <= 0 || view.canvasCssHeight <= 0) {
    throw new Error('canvas has no CSS size — cannot convert a world point to a click');
  }
  return {
    x: localX * (view.canvasCssWidth / view.screenWidth),
    y: localY * (view.canvasCssHeight / view.screenHeight),
  };
};

/** True while the player is still travelling (position keeps changing). */
const _isMoving = (page: Page, sampleMs = 150): Promise<boolean> =>
  page.evaluate(async (waitMs) => {
    const read = (): { x: number; y: number } | undefined => {
      const debug = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
        | { playerX?: number; playerY?: number }
        | undefined;
      return debug?.playerX === undefined || debug.playerY === undefined
        ? undefined
        : { x: debug.playerX, y: debug.playerY };
    };
    const first = read();
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    const second = read();
    if (first === undefined || second === undefined) {
      return false;
    }
    return Math.hypot(second.x - first.x, second.y - first.y) > 0.5;
  }, sampleMs);

/**
 * Waits for the player to come to rest and returns the resting position.
 *
 * Settlement — not a fixed sleep — is what proves the walk ENDED at the clicked
 * ground instead of merely starting.
 */
const _waitForRest = async (
  page: Page,
  timeoutMs = 15_000,
): Promise<{ playerX: number; playerY: number; npcCount: number; npcAppearance: unknown }> =>
  _waitUntil(
    async () => ({ position: await _readPlayerPosition(page), moving: await _isMoving(page) }),
    (sample) => !sample.moving,
    timeoutMs,
    'player came to rest',
  ).then((sample) => sample.position);

test.describe('Click-to-Move — Pointer Input', () => {
  let mapSandbox: MapSandboxPage;

  test.beforeEach(async ({ page }) => {
    mapSandbox = new MapSandboxPage(page);
    await page.goto(`${BASE_URL}/dev/sandbox/map`);
    // A loaded, rendering world — NOT "a published player position". The debug
    // atlas/tiles can publish a position against a blank world, which is how a
    // click-to-move test "passes" against nothing.
    await _waitForRenderedWorld(page);
  });

  test('AC-4: click on walkable ground walks the player there', async ({ page }) => {
    const view = await _waitForRenderedWorld(page);
    expect(view.terrainChunkCount, 'sandbox terrain never rendered').toBeGreaterThan(0);

    // The sandbox map authors no spawn: read where the player actually is and
    // aim two tiles to its right on the engine's own grid.
    const before = await _readPlayerPosition(page);
    const targetX = before.playerX + 2 * TILE_SIZE_PX;
    const targetY = before.playerY;
    const click = await _canvasPointForWorld(page, targetX, targetY);

    await mapSandbox.clickCanvasAt(click);

    // The player actually displaced toward the clicked ground…
    const moved = await _waitUntil(
      () => _readPlayerPosition(page),
      (position) => position.playerX - before.playerX >= MIN_DISPLACEMENT_PX,
      15_000,
      'player displaced toward the click',
    );
    expect(moved.playerX - before.playerX).toBeGreaterThanOrEqual(MIN_DISPLACEMENT_PX);
    // …and came to REST there rather than drifting back to the spawn.
    const rest = await _waitForRest(page);
    expect(rest.playerX).toBeGreaterThan(before.playerX + MIN_DISPLACEMENT_PX);
    // The click resolved to walkable ground on the targeted tile row: the
    // engine snaps an unreachable click to the nearest enterable cell, so the
    // resting column must be within one tile of the aimed column.
    expect(Math.abs(rest.playerX - targetX)).toBeLessThan(TILE_SIZE_PX * 1.5);
  });

  test('AC-7: keyboard cancels click-path', async ({ page }) => {
    // Start a path, then prove a keyboard input takes over from it.
    const before = await _readPlayerPosition(page);
    const targetX = before.playerX + 3 * TILE_SIZE_PX;
    await mapSandbox.clickCanvasAt(await _canvasPointForWorld(page, targetX, before.playerY));

    // Wait until the click-path is actually driving the player.
    await _waitUntil(
      () => _readPlayerPosition(page),
      (position) => position.playerX - before.playerX >= MIN_DISPLACEMENT_PX,
      15_000,
      'click-path started moving the player',
    );
    const duringPath = await _readPlayerPosition(page);

    // Hold a movement key across several fixed simulation steps so the
    // cancellation assertion observes keyboard-driven movement.
    await page.keyboard.down('ArrowLeft');
    const afterCancel = await (async (): Promise<DebugPosition> => {
      try {
        await page.waitForTimeout(200);
        return await _readPlayerPosition(page);
      } finally {
        await page.keyboard.up('ArrowLeft');
      }
    })();

    // The keyboard took authority: the player moved against the click-path
    // direction instead of continuing right toward the clicked tile.
    expect(afterCancel.playerX).toBeLessThan(duringPath.playerX);
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

    // The live render transform: terrain bands and their chunk meshes exist on
    // the stage. This is the "a map really loaded" gate — entity counts alone
    // are satisfied by a blank world whose atlas 404s.
    const view = await _waitForRenderedWorld(page);
    expect(view.terrainBandCount).toBeGreaterThan(0);
    expect(view.terrainChunkCount).toBeGreaterThan(0);

    const debug = await _readPlayerPosition(page);
    // NPCs populated the village…
    expect(debug.npcCount).toBeGreaterThan(0);
    // …and their appearances resolved through the shared named-appearance
    // normalization, which only happens when real entity textures loaded.
    expect(Object.keys(debug.npcAppearance?.village_elder ?? {}).length).toBeGreaterThan(0);
  });

  test('a click on ground to the right moves the player and the camera follows', async ({
    page,
  }) => {
    const game = new GamePage(page);
    await game.goto();
    await game.waitForPlayingState();
    await expect(page.getByTestId('game-ui-overlay-layer')).toBeVisible();
    await _waitForRenderedWorld(page);

    const before = {
      position: await _readPlayerPosition(page),
      view: await _readLiveView(page),
    };
    // Aim at walkable ground derived from the player's OWN live coordinates —
    // no authored tile, spawn, or viewport constant is assumed.
    const targetX = before.position.playerX + 3 * TILE_SIZE_PX;
    const canvasBox = await game.canvas.boundingBox();
    if (!canvasBox) {
      throw new Error('production game canvas is not visible');
    }
    const click = await _canvasPointForWorld(page, targetX, before.position.playerY);
    await page.mouse.click(canvasBox.x + click.x, canvasBox.y + click.y);

    // The player must actually displace toward the click…
    const moved = await _waitUntil(
      () => _readPlayerPosition(page),
      (position) => position.playerX - before.position.playerX >= MIN_DISPLACEMENT_PX,
      15_000,
      'player displaced toward the click',
    );
    expect(moved.playerX - before.position.playerX).toBeGreaterThanOrEqual(MIN_DISPLACEMENT_PX);

    // …and come to rest there, rather than drifting back to the spawn.
    const rest = await _waitForRest(page);
    expect(rest.playerX).toBeGreaterThan(before.position.playerX + MIN_DISPLACEMENT_PX);

    // The world→screen transform the player sees followed: the live camera
    // panned right with them, so the click landed where it was aimed.
    const after = await _waitUntil(
      () => _readLiveView(page),
      (view) => view.cameraX > before.view.cameraX + MIN_DISPLACEMENT_PX / 2,
      15_000,
      'camera followed the player right',
    );
    expect(after.cameraX).toBeGreaterThan(before.view.cameraX + MIN_DISPLACEMENT_PX / 2);
  });
});
