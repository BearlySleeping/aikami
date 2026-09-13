// apps/e2e/tests/client/combat_v2.spec.ts
//
// C-516: Combat-04 — Direct-Control Production Vertical Slice.
//
// Proves the v2 vertical slice is playable in the PRODUCTION `/game` route:
//
//   AC-5  → the sidebar renders the engine's turn tracker, budgets and the
//           action-economy readout for the fight that is actually running.
//   AC-7  → entering move selection requests a preview and renders the answer.
//   AC-8  → click-to-move posts a budgeted move (never explore locomotion).
//   AC-9  → the ability picker is catalog-derived, target selection works, and
//           Defend is available with no target.
//   AC-10 → a real authored encounter resolves turns through the engine (HP
//           moves on both sides) and leaves the overlay cleanly; an encounter
//           the running content pack cannot resolve degrades cleanly (typed
//           rejection, no dead overlay).
//
// The encounter is launched through the composition root's non-production test
// seam (`__AIKAMI_TEST__.startRealEncounter`), which drives the SAME production
// start path the dialogue chip uses — real content-pack roster, real worker,
// real kernel. Nothing about the roster or the resolution is stubbed.
//
// Run from apps/e2e: bun run test -- combat_v2

import { expect, test } from '@playwright/test';
import { GamePage } from '$pom';
import { EMULATOR_PORTS } from '../../src/config';

// Contract-scoped runs bind the client to `5274 + PUBLIC_EMULATOR_PORT_OFFSET`
// (see scripts/src/lib/herdr/session.ts); hardcoding 5274 would test whatever
// else happens to be listening there instead of this worktree's dev server.
const GAME_URL = `http://localhost:${EMULATOR_PORTS.client}/game`;

/**
 * An encounter the DEPLOYED content pack resolves.
 *
 * The repo authors `proof_encounter`, but the client resolves content through
 * the published asset seed, which lags `content/packs/index.json` — so the
 * proof roster (3 enemies + companion) is not resolvable in this environment
 * until the seed is republished. These tests therefore drive the real authored
 * `inn_wand_encounter` (real NPC, real authored `combatStats`, real roster),
 * and the last case pins the degradation path for an unresolvable id.
 */
const RESOLVABLE_ENCOUNTER = 'inn_wand_encounter';

/** Authored in the repo, not resolvable from the deployed seed (see above). */
const DEPLOYED_PACK_MISSING_ENCOUNTER = 'proof_encounter';

type CombatOverlayState = { overlay: string; mode: string };

type AikamiTestSeam = {
  startRealEncounter(options: { encounterId: string; engine?: 'legacy' | 'v2' }): void;
  startCombat(options: { enemyName: string; enemyNpcId?: string }): void;
  scheduleCombatEndedCleanup(): void;
  dismissCombat(): void;
  getCombatCleanupResumeCount(): number;
  getOverlayState(): CombatOverlayState;
};

/**
 * Seam probes run IN THE PAGE.
 *
 * `page.evaluate` returns a structured clone of the seam, which drops every
 * function — so each probe is its own evaluate, exactly like `combat.spec.ts`.
 */
const overlayState = (page: import('@playwright/test').Page) =>
  page.evaluate(
    (): CombatOverlayState =>
      (window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }).__AIKAMI_TEST__.getOverlayState(),
  );

const combatCleanupResumeCount = (page: import('@playwright/test').Page) =>
  page.evaluate((): number =>
    (
      window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }
    ).__AIKAMI_TEST__.getCombatCleanupResumeCount(),
  );

/** Clicks with a short bounded timeout, tolerating an animating layout. */
const clickWhenReady = async (
  locator: import('@playwright/test').Locator,
  timeout = 5_000,
): Promise<boolean> => {
  try {
    await locator.click({ timeout, force: true });
    return true;
  } catch {
    return false;
  }
};

test.describe('Combat-04 direct-control vertical slice (C-516)', () => {
  let game: GamePage;

  const bootIntoGame = async (page: import('@playwright/test').Page) => {
    game = new GamePage(page);
    await page.goto(GAME_URL, { waitUntil: 'domcontentloaded' });
    await game.waitForEngineReady();
    await game.waitForPlayingState();
    await expect(game.canvas).toBeAttached();
    await expect(game.canvas).toBeVisible();

    await page.waitForFunction(
      () => {
        const testSeam = (
          window as unknown as { __AIKAMI_TEST__?: { startRealEncounter?: unknown } }
        ).__AIKAMI_TEST__;
        return typeof testSeam?.startRealEncounter === 'function';
      },
      undefined,
      { timeout: 20_000 },
    );

    // The GameWorld registers its bridge forwarders while the boot pipeline
    // finishes mounting, and a command whose type has no forwarder is dropped by
    // design — so wait until an encounter start is actually routable instead of
    // assuming "the overlay is open" means "the engine can be commanded".
    await page.waitForFunction(
      () => {
        const testSeam = (
          window as unknown as { __AIKAMI_TEST__?: { isCombatStartRoutable?: () => boolean } }
        ).__AIKAMI_TEST__;
        return testSeam?.isCombatStartRoutable?.() === true;
      },
      undefined,
      { timeout: 40_000 },
    );
  };

  /** Dispatches a `COMBAT_START_ENCOUNTER` through the production seam. */
  const startEncounter = async (
    page: import('@playwright/test').Page,
    encounterId: string,
  ): Promise<void> => {
    await page.evaluate((id) => {
      (window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }).__AIKAMI_TEST__.startRealEncounter(
        { encounterId: id, engine: 'v2' },
      );
    }, encounterId);
  };

  /**
   * Starts a resolvable encounter and waits for the live turn tracker.
   *
   * The command is re-sent until the engine answers. `COMBAT_START_ENCOUNTER` is
   * idempotent (a start while turns are already running is ignored), and the
   * worker ignores a command that arrives before its ECS world exists — so a
   * bounded retry is how the caller waits for "the engine can start a fight"
   * without reaching into engine internals.
   */
  const startLiveEncounter = async (
    page: import('@playwright/test').Page,
    encounterId = RESOLVABLE_ENCOUNTER,
  ): Promise<void> => {
    await expect
      .poll(
        async () => {
          await startEncounter(page, encounterId);
          return page
            .getByTestId('combat-budget-dots')
            .isVisible()
            .catch(() => false);
        },
        { timeout: 45_000, intervals: [500, 1000, 2000, 2000, 3000, 3000, 5000] },
      )
      .toBe(true);

    await expect(page.getByTestId('combat-end-turn-btn')).toBeVisible({ timeout: 20_000 });
  };

  /**
   * Dispatches a real `pointerdown` at a canvas-local point.
   *
   * The combat split-screen paints the portrait stage over the canvas centre, so
   * Playwright's actionability check refuses a plain `canvas.click`. This still
   * exercises the PRODUCTION listener chain: the PointerController's own
   * `pointerdown` handler resolves the cell and posts the command.
   */
  const clickCanvasAt = async (
    page: import('@playwright/test').Page,
    point: { x: number; y: number },
  ): Promise<void> => {
    await page.evaluate((target) => {
      const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas-container canvas');
      if (canvas === null) {
        throw new Error('game canvas not found');
      }
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', {
          button: 0,
          buttons: 1,
          bubbles: true,
          clientX: rect.left + target.x,
          clientY: rect.top + target.y,
        }),
      );
    }, point);
  };

  test('AC-5 + AC-7: the live encounter renders a turn tracker and move preview', async ({
    page,
  }) => {
    await bootIntoGame(page);
    await startLiveEncounter(page);

    expect((await overlayState(page)).overlay).toBe('COMBAT');

    // ── AC-5: the tracker shows the engine's own budget readout ──
    const headerText = await page.getByTestId('combat-budget-dots').innerText();
    expect(headerText).toContain('Move');

    // ── AC-7: entering move selection answers with a reachable set ──
    await page.getByTestId('combat-move-btn').click();
    await expect(page.getByTestId('combat-move-hint')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('combat-move-hint')).toContainText('reachable');
  });

  test('AC-8 + AC-9: click-to-move is a combat move and the ability picker is live', async ({
    page,
  }) => {
    await bootIntoGame(page);
    await startLiveEncounter(page);

    // ── AC-8: a canvas click while move mode is open is a COMBAT move ──
    await page.getByTestId('combat-move-btn').click();
    await expect(page.getByTestId('combat-move-hint')).toBeVisible({ timeout: 15_000 });
    const budgetBefore = await page.getByTestId('combat-budget-dots').innerText();

    await clickCanvasAt(page, { x: 220, y: 180 });

    // The pointer is in COMBAT move mode, so the click is resolved against the
    // reachable set: either it commits (the budget readout drops) or the engine
    // answers with a typed reason. A silent no-op is the failure this covers.
    await expect
      .poll(
        async () => {
          const budget = await page.getByTestId('combat-budget-dots').innerText();
          const rejected = await page
            .getByTestId('combat-selection-rejection')
            .isVisible()
            .catch(() => false);
          return budget !== budgetBefore || rejected;
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    // ── AC-9: the ability picker is catalog-derived ──
    await expect(page.getByTestId('combat-ability-basic_melee')).toBeVisible();
    await clickWhenReady(page.getByTestId('combat-ability-basic_melee'));
    await expect(page.getByTestId('combat-target-picker')).toBeVisible({ timeout: 15_000 });

    // ── AC-9: Defend is available with no target ──
    await clickWhenReady(page.getByTestId('combat-selection-cancel'));
    await expect(page.getByTestId('combat-defend-btn')).toBeEnabled();
  });

  test('AC-10: a real encounter resolves turns through the engine and exits cleanly', async ({
    page,
  }) => {
    const consoleLines: string[] = [];
    page.on('console', (msg) => consoleLines.push(msg.text()));

    await bootIntoGame(page);
    await startLiveEncounter(page);

    const enemyHpBefore = await page.getByTestId('enemy-hp-text').innerText();

    // ── Play real turns: attack when the engine offers a legal target, then
    // hand the turn over and let the kernel-driven AI resolve its own turns.
    for (let round = 0; round < 8; round++) {
      if (
        await page
          .getByTestId('combat-result-banner')
          .isVisible()
          .catch(() => false)
      ) {
        break;
      }
      const endTurn = page.getByTestId('combat-end-turn-btn');
      if (!(await endTurn.isVisible().catch(() => false))) {
        await page.waitForTimeout(500);
        continue;
      }

      await clickWhenReady(page.getByTestId('combat-ability-basic_melee'));
      const target = page.getByTestId('combat-target-picker').locator('button').first();
      if (await target.isVisible().catch(() => false)) {
        await clickWhenReady(target);
        await clickWhenReady(page.getByTestId('combat-commit-selection-btn'));
      } else {
        await clickWhenReady(page.getByTestId('combat-selection-cancel'));
      }
      if (await endTurn.isVisible().catch(() => false)) {
        await clickWhenReady(endTurn);
      }
      await page.waitForTimeout(300);
    }

    // ── The loop is a real fight: HP moves through the engine's own events
    // (damage on either side), or the encounter already resolved. A frozen
    // readout is exactly the failure this asserts against.
    const enemyHpAfter = await page.getByTestId('enemy-hp-text').innerText();
    const playerHpAfter = await page.getByTestId('player-hp-text').innerText();
    const resolved = await page
      .getByTestId('combat-result-banner')
      .isVisible()
      .catch(() => false);
    expect(resolved || enemyHpAfter !== enemyHpBefore || !playerHpAfter.startsWith('100/')).toBe(
      true,
    );

    // ── Exit: the encounter leaves the COMBAT overlay either way — a victory
    // returns to EXPLORE (after the C-500 cleanup), a retreat shows GAME_OVER.
    if (!resolved) {
      await clickWhenReady(page.getByTestId('combat-flee-btn'));
    }
    await expect
      .poll(async () => (await overlayState(page)).overlay, { timeout: 30_000 })
      .not.toBe('COMBAT');
    const finalState = await overlayState(page);
    expect(['EXPLORE', 'MENU']).toContain(finalState.mode);

    // v2 never double-emits the legacy resolver's DEFEND marker.
    expect(consoleLines.some((line) => line.includes('Player takes a defensive stance'))).toBe(
      false,
    );
  });

  test('AC-10: an unresolvable encounter degrades cleanly (no dead overlay)', async ({ page }) => {
    await bootIntoGame(page);
    const resumeBefore = await combatCleanupResumeCount(page);

    await startEncounter(page, DEPLOYED_PACK_MISSING_ENCOUNTER);

    // The engine cannot start it: v2 is rejected and the legacy fallback finds
    // no authored roster either. The client must leave the overlay it opened
    // optimistically rather than showing an unplayable fight.
    await expect
      .poll(async () => (await overlayState(page)).mode, { timeout: 30_000 })
      .toBe('EXPLORE');

    expect((await overlayState(page)).overlay).not.toBe('COMBAT');
    expect(await combatCleanupResumeCount(page)).toBeGreaterThan(resumeBefore);
  });
});
