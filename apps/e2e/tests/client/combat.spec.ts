// apps/e2e/tests/client/combat.spec.ts
//
// C-500: Combat Overlay Rendering and Engine Stall — production journey.
//
// Proves the combat surface actually MOUNTS in the production /game route.
// Before this contract, starting combat pushed the COMBAT overlay and paused
// the engine, but the mode-gated split-screen combat surface never mounted
// (production never flipped the main-thread game mode to COMBAT), so the
// input-locked world read as a hard freeze.
//
//   AC-1  → combat UI renders in production (portrait stage, HP text,
//           action controls) instead of a frozen world.
//   AC-2  → no ≥5s-delta / halt-yield re-loop stall signature while combat
//           is open.
//   AC-3  → combat dismisses cleanly, restoring EXPLORE mode and input.
//
// Combat is normally entered from an AI-generated dialogue combat chip. That
// requires a configured text provider, which the deterministic E2E lane does
// not have. The composition root exposes a non-production test seam
// (`__AIKAMI_TEST__.startCombat`) that drives the SAME production overlay
// entry path the dialogue chip uses, so this spec stays deterministic while
// still exercising the real mount, mode transition, and exit code.

import { expect, test } from '@playwright/test';
import { GamePage } from '$pom';

/** Result of the composition-root combat seam's overlay-state probe. */
type CombatOverlayState = { overlay: string; mode: string };

/** The non-production combat test seam exposed on `window`. */
type AikamiTestSeam = {
  startCombat: (options: { enemyName: string; enemyNpcId?: string }) => void;
  dismissCombat: () => void;
  getOverlayState: () => CombatOverlayState;
};

test.describe('Combat Overlay Rendering & Engine Stall (C-500)', () => {
  let game: GamePage;

  // ── Shared: boot straight into the /game production route ───────────
  //
  // Combat must be reachable without an AI provider (combat is local-first,
  // C-500 offline requirement). Going through the start-menu onboarding gates
  // the run behind text-provider setup, so boot /game directly — the boot
  // pipeline ensures the default campaign.
  const bootIntoGame = async (page: import('@playwright/test').Page) => {
    game = new GamePage(page);
    await page.goto('http://localhost:5274/game', { waitUntil: 'domcontentloaded' });
    await game.waitForEngineReady();
    await game.waitForPlayingState();
    await expect(game.canvas).toBeAttached();
    await expect(game.canvas).toBeVisible();

    // Wait for the composition root to expose the combat seam.
    await page.waitForFunction(
      () => {
        const seam = (window as unknown as { __AIKAMI_TEST__?: { startCombat?: unknown } })
          .__AIKAMI_TEST__;
        return typeof seam?.startCombat === 'function';
      },
      undefined,
      { timeout: 20_000 },
    );
  };

  const overlayState = (page: import('@playwright/test').Page) =>
    page.evaluate(
      (): CombatOverlayState =>
        (
          window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }
        ).__AIKAMI_TEST__.getOverlayState(),
    );

  test('AC-1 + AC-2 + AC-3: combat mounts, stays healthy, and exits to EXPLORE', async ({
    page,
  }) => {
    const consoleLines: string[] = [];
    page.on('console', (msg) => consoleLines.push(msg.text()));

    await bootIntoGame(page);

    // Baseline: exploring, no combat overlay.
    expect((await overlayState(page)).mode).toBe('EXPLORE');

    // ── Enter combat through the production overlay path ──
    await page.evaluate(() => {
      (window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }).__AIKAMI_TEST__.startCombat({
        enemyName: 'Rollo the Grasper',
        enemyNpcId: 'rollo_grasper',
      });
    });

    // AC-1: the game mode flips to COMBAT and the full battle UI mounts.
    await expect
      .poll(async () => (await overlayState(page)).mode, { timeout: 10_000 })
      .toBe('COMBAT');
    expect((await overlayState(page)).overlay).toBe('COMBAT');

    await game.expectCombatUiVisible();
    await expect(page.locator('[data-testid="combat-custom-action-input"]')).toBeVisible();
    // The world canvas remains mounted behind the combat surface (not torn
    // down), so exiting combat does not re-boot the engine.
    await expect(game.canvas).toBeAttached();

    // AC-2: no stall signature while combat is open — no halt-yield pinned at
    // a ≥5s delta and no zoning.position suppression storm.
    const stallLogs = consoleLines.filter(
      (line) => line.includes('path-follow:halt-yield') && line.includes('5000'),
    );
    expect(stallLogs).toHaveLength(0);
    const zoningStorm = consoleLines.filter((line) => /suppressed \d+ repeats in 10s/.test(line));
    expect(zoningStorm).toHaveLength(0);

    // AC-3: Escape dismisses combat cleanly — mode returns to EXPLORE, the
    // combat surface unmounts, and the world is interactive again.
    await page.keyboard.press('Escape');
    await expect
      .poll(async () => (await overlayState(page)).mode, { timeout: 10_000 })
      .toBe('EXPLORE');
    await expect(page.locator('[data-testid="combat-attack-btn"]')).toBeHidden({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="combat-portrait-stage"]')).toBeHidden();
  });

  test('AC-3: rapid dismiss restores EXPLORE exactly once', async ({ page }) => {
    await bootIntoGame(page);

    await page.evaluate(() => {
      (window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }).__AIKAMI_TEST__.startCombat({
        enemyName: 'Rollo the Grasper',
        enemyNpcId: 'rollo_grasper',
      });
    });
    await expect
      .poll(async () => (await overlayState(page)).mode, { timeout: 10_000 })
      .toBe('COMBAT');

    // Dismiss immediately through the production closeCombat path.
    await page.evaluate(() => {
      (window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }).__AIKAMI_TEST__.dismissCombat();
    });

    await expect
      .poll(async () => (await overlayState(page)).mode, { timeout: 10_000 })
      .toBe('EXPLORE');
    expect((await overlayState(page)).overlay).toBe('NONE');
    await expect(page.locator('[data-testid="combat-attack-btn"]')).toBeHidden();
  });
});
