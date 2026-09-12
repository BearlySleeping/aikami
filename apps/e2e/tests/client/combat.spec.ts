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
  startCombat(options: { enemyName: string; enemyNpcId?: string }): void;
  scheduleCombatEndedCleanup(): void;
  dismissCombat(): void;
  getCombatCleanupResumeCount(): number;
  getOverlayState(): CombatOverlayState;
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
    await page.waitForTimeout(5_000);
    const stallLogs = consoleLines
      .filter((line) => line.includes('path-follow:halt-yield'))
      .filter((line) => {
        const match = /["']?haltedForMs["']?\s*:\s*(\d+(?:\.\d+)?)/.exec(line);
        return match === null || Number(match[1]) >= 5_000;
      });
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

    // Schedule the production listener's delayed cleanup, then dismiss
    // immediately through the same closeCombat path. The delayed call must
    // be a no-op rather than resuming an already-running engine again.
    await page.evaluate(() => {
      const seam = (window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }).__AIKAMI_TEST__;
      seam.scheduleCombatEndedCleanup();
      seam.dismissCombat();
    });

    await page.waitForTimeout(3_000);

    await expect
      .poll(async () => (await overlayState(page)).mode, { timeout: 10_000 })
      .toBe('EXPLORE');
    expect((await overlayState(page)).overlay).toBe('NONE');
    expect(
      await page.evaluate(() =>
        (
          window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }
        ).__AIKAMI_TEST__.getCombatCleanupResumeCount(),
      ),
    ).toBe(1);
    await expect(page.locator('[data-testid="combat-attack-btn"]')).toBeHidden();
  });
});

// ── C-514 AC-4 + AC-7: explicit end turn in the production combat UI ───────

test.describe('Combat explicit end turn (C-514)', () => {
  let game: GamePage;

  /** The C-514 turn/budget seam added to the composition root test hook. */
  type CombatTurnSeam = {
    startCombat(options: { enemyName: string; enemyNpcId?: string }): void;
    emitCombatTurn(options: {
      currentEntityId: number;
      activeEntities: number[];
      actionEconomy: {
        movementRemaining: number;
        actionAvailable: boolean;
        quickActionAvailable: boolean;
        bonusActionAvailable: boolean;
        reactionAvailable: boolean;
      };
    }): void;
    getOverlayState(): CombatOverlayState;
  };

  const bootIntoGame = async (page: import('@playwright/test').Page) => {
    game = new GamePage(page);
    await page.goto('http://localhost:5274/game', { waitUntil: 'domcontentloaded' });
    await game.waitForEngineReady();
    await game.waitForPlayingState();
    await expect(game.canvas).toBeVisible();
    await page.waitForFunction(
      () => {
        const seam = (window as unknown as { __AIKAMI_TEST__?: { emitCombatTurn?: unknown } })
          .__AIKAMI_TEST__;
        return typeof seam?.emitCombatTurn === 'function';
      },
      undefined,
      { timeout: 20_000 },
    );
  };

  const overlayMode = (page: import('@playwright/test').Page) =>
    page.evaluate(
      (): string =>
        (window as unknown as { __AIKAMI_TEST__: CombatTurnSeam }).__AIKAMI_TEST__.getOverlayState()
          .mode,
    );

  const emitTurn = (
    page: import('@playwright/test').Page,
    movementRemaining: number,
    currentEntityId = 1,
  ) =>
    page.evaluate(
      ({ movement, entityId }) => {
        const seam = (window as unknown as { __AIKAMI_TEST__: CombatTurnSeam }).__AIKAMI_TEST__;
        seam.emitCombatTurn({
          currentEntityId: entityId,
          activeEntities: [1, 2],
          actionEconomy: {
            movementRemaining: movement,
            actionAvailable: movement > 0,
            quickActionAvailable: true,
            bonusActionAvailable: true,
            reactionAvailable: true,
          },
        });
      },
      { movement: movementRemaining, entityId: currentEntityId },
    );

  test('AC-4 + AC-7: budgets are visible, End Turn is reachable, and combat still exits cleanly', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await bootIntoGame(page);

    // Enter combat through the production overlay path.
    await page.evaluate(() => {
      const seam = (window as unknown as { __AIKAMI_TEST__: CombatTurnSeam }).__AIKAMI_TEST__;
      seam.startCombat({ enemyName: 'Rollo the Grasper', enemyNpcId: 'rollo_grasper' });
    });

    await expect.poll(async () => overlayMode(page), { timeout: 10_000 }).toBe('COMBAT');
    await game.expectCombatUiVisible();

    // Drive the production TURN_CHANGED → ACTION_ECONOMY_CHANGED pair the ECS
    // worker emits. The ViewModel attaches its bridge asynchronously (it
    // lazily imports the engine module), so re-emit until the turn header is
    // live.
    const budgetDots = page.locator('[data-testid="combat-budget-dots"]');
    await expect
      .poll(
        async () => {
          await emitTurn(page, 6);
          return budgetDots.count();
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);

    // AC-4: the four-budget readout and the End Turn control are reachable
    // from the existing combat controls.
    await expect(budgetDots).toBeVisible();
    await expect(budgetDots).toContainText('Move 6');
    await expect(budgetDots).toContainText('Action');
    await expect(budgetDots).toContainText('Quick');
    await expect(budgetDots).toContainText('Reaction');

    const endTurn = page.locator('[data-testid="combat-end-turn-btn"]');
    await expect(endTurn).toBeVisible();
    await expect(endTurn).toBeEnabled();

    // The readout follows ACTION_ECONOMY_CHANGED: movement is spent without any
    // local UI mutation.
    await emitTurn(page, 4);
    await expect(budgetDots).toContainText('Move 4');

    // AC-4 + AC-7: the active-turn indicator is driven only by the engine's
    // TURN_CHANGED — it moves to the enemy and back with no local mutation.
    const turnHeader = page.locator('.turn-tracker-header');
    await expect(turnHeader).toContainText('Your Turn');
    await emitTurn(page, 6, 2);
    await expect(turnHeader).toContainText('Enemy Turn');
    await emitTurn(page, 6, 1);
    await expect(turnHeader).toContainText('Your Turn');

    // Clicking End Turn sends COMBAT_END_TURN through the engine bridge; the
    // overlay must stay mounted and healthy regardless of the response.
    await endTurn.click();
    await page.waitForTimeout(1_000);
    await expect(page.locator('[data-testid="combat-portrait-stage"]')).toBeVisible();
    expect(await overlayMode(page)).toBe('COMBAT');

    // AC-7: the clean-exit behaviour (C-500) is not regressed.
    await page.keyboard.press('Escape');
    await expect.poll(async () => overlayMode(page), { timeout: 10_000 }).toBe('EXPLORE');
    await expect(page.locator('[data-testid="combat-end-turn-btn"]')).toBeHidden({
      timeout: 10_000,
    });
    await expect(game.canvas).toBeVisible();
    expect(pageErrors).toHaveLength(0);
  });
});
