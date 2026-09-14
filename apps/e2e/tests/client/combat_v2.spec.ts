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

  type CombatHighlightDebug = {
    cellX: number;
    cellY: number;
    kind: 'reachable' | 'target';
    screenX: number;
    screenY: number;
  };

  /** Reads the engine-published highlight cells (C-525 R-2). */
  const readHighlights = (page: import('@playwright/test').Page) =>
    page.evaluate(
      (): CombatHighlightDebug[] =>
        (
          window as unknown as {
            __AIKAMI_DEBUG__?: { combatHighlights?: CombatHighlightDebug[] };
          }
        ).__AIKAMI_DEBUG__?.combatHighlights ?? [],
    );

  const canvasLocator = (page: import('@playwright/test').Page) =>
    page.locator('#game-canvas-container canvas');

  /** Whether a canvas-local point currently hit-tests to the canvas element. */
  const isCanvasPointClickable = async (
    page: import('@playwright/test').Page,
    box: { x: number; y: number },
    point: { x: number; y: number },
  ): Promise<boolean> =>
    page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.tagName.toLowerCase() === 'canvas',
      { x: box.x + point.x, y: box.y + point.y },
    );

  /**
   * Derives the affine cell→canvas-local mapping from the published highlights.
   *
   * Each highlight carries both its cell and its screen centre, so two distinct
   * cells on an axis determine the cell pitch and origin. Returns `null` when a
   * single row/column makes an axis underdetermined.
   */
  const deriveCellGrid = (
    highlights: readonly CombatHighlightDebug[],
  ): { x: { pitch: number; origin: number }; y: { pitch: number; origin: number } } | null => {
    const axis = (picker: (h: CombatHighlightDebug) => [number, number]) => {
      const byCell = new Map<number, number>();
      for (const highlight of highlights) {
        const [cell, screen] = picker(highlight);
        byCell.set(cell, screen);
      }
      const entries = [...byCell.entries()].sort((a, b) => a[0] - b[0]);
      const first = entries[0];
      const last = entries[entries.length - 1];
      if (!first || !last || first[0] === last[0]) {
        return null;
      }
      const pitch = (last[1] - first[1]) / (last[0] - first[0]);
      return { pitch, origin: first[1] - (first[0] + 0.5) * pitch };
    };
    const x = axis((h) => [h.cellX, h.screenX]);
    const y = axis((h) => [h.cellY, h.screenY]);
    return x && y ? { x, y } : null;
  };

  /**
   * Clicks a reachable cell with a REAL, actionability-checked pointer click.
   *
   * The renderer is window-sized while the tactical column is narrower, so some
   * published endpoints project outside the visible area. Candidates are sorted
   * by distance to the camera-centred player and the first that hit-tests to the
   * canvas is clicked through Playwright's actionability check — never a
   * synthetic `pointerdown` dispatch.
   */
  const clickReachableHighlight = async (
    page: import('@playwright/test').Page,
  ): Promise<CombatHighlightDebug> => {
    let clicked: CombatHighlightDebug | undefined;
    await expect
      .poll(
        async () => {
          const reachable = (await readHighlights(page)).filter(
            (highlight) =>
              highlight.kind === 'reachable' &&
              Number.isFinite(highlight.screenX) &&
              Number.isFinite(highlight.screenY),
          );
          if (reachable.length === 0) {
            return false;
          }
          const box = await canvasLocator(page).boundingBox();
          if (!box) {
            return false;
          }
          const centre = { x: box.width / 2, y: box.height / 2 };
          reachable.sort(
            (a, b) =>
              Math.hypot(a.screenX - centre.x, a.screenY - centre.y) -
              Math.hypot(b.screenX - centre.x, b.screenY - centre.y),
          );
          for (const highlight of reachable) {
            const point = { x: highlight.screenX, y: highlight.screenY };
            if (!(await isCanvasPointClickable(page, box, point))) {
              continue;
            }
            await canvasLocator(page).click({
              position: point,
              timeout: 10_000,
            });
            clicked = highlight;
            return true;
          }
          return false;
        },
        { timeout: 15_000, intervals: [200, 300, 500, 1000, 1000, 2000] },
      )
      .toBe(true);
    if (!clicked) {
      throw new Error('no clickable reachable highlight was published');
    }
    return clicked;
  };

  /** Reads the turn tracker's `Turn N` counter (0 when the tracker is absent). */
  const readTurnNumber = async (page: import('@playwright/test').Page): Promise<number> => {
    const text = await page
      .locator('.turn-tracker-header')
      .innerText()
      .catch(() => '');
    const match = /Turn\s+(\d+)/.exec(text);
    return match ? Number(match[1]) : 0;
  };

  /** Reads the numeric HP out of a `current/max` readout (e.g. "12/40"). */
  const parseHp = (text: string): number => {
    const match = /^(\d+)/.exec(text.trim());
    return match ? Number(match[1]) : Number.NaN;
  };

  /**
   * Clicks a real canvas point whose cell is outside the reachable set.
   *
   * The reachable set can span most of the visible column, so this scans the
   * visible canvas for a point that derives to a non-reachable cell and
   * hit-tests to the canvas, then issues a real trusted pointer click. The
   * ViewModel must ignore it (no budget change), which the caller asserts.
   */
  const clickAwayFromHighlights = async (page: import('@playwright/test').Page): Promise<void> => {
    const reachable = (await readHighlights(page)).filter(
      (highlight) => highlight.kind === 'reachable',
    );
    const box = await canvasLocator(page).boundingBox();
    if (!box || reachable.length === 0) {
      throw new Error('cannot compute an outside point without a reachable set');
    }
    const grid = deriveCellGrid(reachable);
    if (!grid) {
      throw new Error('cannot derive the cell grid for an outside point');
    }
    const reachableKeys = new Set(reachable.map((h) => `${h.cellX},${h.cellY}`));
    const viewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    const maxX = Math.min(box.width, viewport.width - box.x) - 24;
    const maxY = Math.min(box.height, viewport.height - box.y) - 24;
    for (let x = 40; x < maxX; x += 48) {
      for (let y = 40; y < maxY; y += 48) {
        const cellX = Math.round((x - grid.x.origin) / grid.x.pitch - 0.5);
        const cellY = Math.round((y - grid.y.origin) / grid.y.pitch - 0.5);
        if (reachableKeys.has(`${cellX},${cellY}`)) {
          continue;
        }
        if (!(await isCanvasPointClickable(page, box, { x, y }))) {
          continue;
        }
        await page.mouse.click(box.x + x, box.y + y);
        return;
      }
    }
    throw new Error('no clickable point outside the reachable set was found');
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

  test('AC-8 + AC-9: a real click on a highlighted cell commits a combat move', async ({
    page,
  }) => {
    await bootIntoGame(page);
    await startLiveEncounter(page);

    // ── AC-8: enter move mode and wait for the engine's reachable answer ──
    await page.getByTestId('combat-move-btn').click();
    await expect(page.getByTestId('combat-move-hint')).toBeVisible({ timeout: 15_000 });
    const budgetBefore = await page.getByTestId('combat-budget-dots').innerText();

    // A reachable cell is published by the engine and highlighted on the
    // canvas; click it with a real, actionability-checked pointer click.
    await clickReachableHighlight(page);

    // Committing the budgeted move drops the movement budget readout.
    await expect
      .poll(async () => page.getByTestId('combat-budget-dots').innerText(), { timeout: 15_000 })
      .not.toBe(budgetBefore);

    // ── AC-8: a click outside the reachable set does nothing ──
    await page.getByTestId('combat-move-btn').click();
    await expect(page.getByTestId('combat-move-hint')).toBeVisible({ timeout: 15_000 });
    const budgetAfterMove = await page.getByTestId('combat-budget-dots').innerText();
    await clickAwayFromHighlights(page);
    await page.waitForTimeout(750);
    expect(await page.getByTestId('combat-budget-dots').innerText()).toBe(budgetAfterMove);
    // The selection stays open so the player can still pick a legal cell.
    await expect(page.getByTestId('combat-move-hint')).toBeVisible();
    await clickWhenReady(page.getByTestId('combat-selection-cancel'));

    // ── AC-9: the ability picker is catalog-derived ──
    await expect(page.getByTestId('combat-ability-basic_melee')).toBeVisible();
    await clickWhenReady(page.getByTestId('combat-ability-basic_melee'));
    await expect(page.getByTestId('combat-target-picker')).toBeVisible({ timeout: 15_000 });

    // ── AC-9: Defend is available with no target ──
    await clickWhenReady(page.getByTestId('combat-selection-cancel'));
    await expect(page.getByTestId('combat-defend-btn')).toBeEnabled();
  });

  test('AC-9: picking a legal target renders the engine forecast, not an empty panel', async ({
    page,
  }) => {
    await bootIntoGame(page);
    await startLiveEncounter(page);

    // A fresh encounter, before any budget is spent: the engine must declare at
    // least one legal target for the basic attack.
    await expect(page.getByTestId('combat-ability-basic_melee')).toBeVisible();
    await clickWhenReady(page.getByTestId('combat-ability-basic_melee'));

    // Only the targets the ENGINE declared legal — never a count computed here.
    // Bounded to `button[...]` so the picker container (`combat-target-picker`)
    // is not mistaken for a target.
    const legalTargets = page.locator('button[data-testid^="combat-target-"]');
    await expect(legalTargets.first()).toBeVisible({ timeout: 15_000 });
    await clickWhenReady(legalTargets.first());

    // The `legalTargets` answer carries only an empty forecast, so the panel is
    // filled by the follow-up `action` query the client issues on target pick.
    // Before that follow-up existed the panel rendered as an empty <div> — the
    // AC-7 "forecast panel" promise was structurally present but data-free.
    const forecastPanel = page.getByTestId('combat-forecast-panel');
    await expect(forecastPanel).toBeVisible({ timeout: 15_000 });
    await expect(forecastPanel).toContainText('% to hit');
    await expect(forecastPanel).toContainText('dmg');

    // The follow-up query must not erase the set the player is choosing from.
    await expect(legalTargets.first()).toBeVisible();
    await expect(page.getByTestId('combat-selection-rejection')).toBeHidden();
  });

  test('AC-10: a real encounter resolves turns through the engine and exits cleanly', async ({
    page,
  }) => {
    const consoleLines: string[] = [];
    page.on('console', (msg) => consoleLines.push(msg.text()));

    await bootIntoGame(page);
    await startLiveEncounter(page);

    const enemyHpBefore = parseHp(await page.getByTestId('enemy-hp-text').innerText());
    const turnNumberBefore = await readTurnNumber(page);
    let playerAttackLanded = false;

    // ── Play real turns: attack the engine-declared enemy, then hand the turn
    // over and let the kernel-driven AI resolve its own turns. A frozen overlay
    // advances neither the turn counter nor the enemy HP, so neither assertion
    // below can pass without the engine actually resolving a turn.
    for (let round = 0; round < 16; round++) {
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
        // Not the player's turn — let the deterministic AI resolve.
        await page.waitForTimeout(400);
        continue;
      }

      const enemyHpAtRoundStart = parseHp(await page.getByTestId('enemy-hp-text').innerText());
      await clickWhenReady(page.getByTestId('combat-ability-basic_melee'));
      const target = page.getByTestId('combat-target-picker').locator('button').first();
      if (await target.isVisible().catch(() => false)) {
        await clickWhenReady(target);
        await clickWhenReady(page.getByTestId('combat-commit-selection-btn'));
        // The kernel resolves on the next frame; give it one turn's worth of
        // frames and then read the engine's own HP readout.
        await page.waitForTimeout(600);
        const enemyHpAtRoundEnd = parseHp(await page.getByTestId('enemy-hp-text').innerText());
        const immediateVictory = await page
          .getByTestId('combat-result-banner')
          .filter({ hasText: 'Victory' })
          .isVisible()
          .catch(() => false);
        if (
          immediateVictory ||
          (Number.isFinite(enemyHpAtRoundStart) &&
            Number.isFinite(enemyHpAtRoundEnd) &&
            enemyHpAtRoundEnd < enemyHpAtRoundStart)
        ) {
          playerAttackLanded = true;
        }
      } else {
        await clickWhenReady(page.getByTestId('combat-selection-cancel'));
      }
      if (await endTurn.isVisible().catch(() => false)) {
        await clickWhenReady(endTurn);
      }
      await page.waitForTimeout(300);
    }

    const enemyHpAfter = parseHp(await page.getByTestId('enemy-hp-text').innerText());
    const turnNumberAfter = await readTurnNumber(page);
    const resolved = await page
      .getByTestId('combat-result-banner')
      .isVisible()
      .catch(() => false);

    // ── A real turn resolved: the engine advanced the turn counter through
    // TURN_CHANGED. A frozen/stubbed overlay leaves it at the initial value.
    expect(turnNumberAfter).toBeGreaterThan(turnNumberBefore);
    // ── A real engine-resolved hit landed: the intended target's HP fell, or
    // that attack immediately produced Victory. Resolution alone cannot let a
    // no-op attack or Defeat satisfy this assertion.
    expect(playerAttackLanded).toBe(true);
    if (playerAttackLanded && !resolved) {
      expect(Number.isFinite(enemyHpBefore)).toBe(true);
      expect(Number.isFinite(enemyHpAfter)).toBe(true);
      expect(enemyHpAfter).toBeLessThan(enemyHpBefore);
      expect(enemyHpAfter).toBeGreaterThanOrEqual(0);
    }
    // If the fight finished while being driven, it must show a real result.
    if (resolved) {
      await expect(page.getByTestId('combat-result-banner')).toContainText('Victory');
    }

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

  // -------------------------------------------------------------------------
  // C-525 (Combat-05): natural-language intent + confirmation
  // -------------------------------------------------------------------------

  type SeamWithMultiHostile = AikamiTestSeam & {
    startMultiHostileEncounter(options: { npcId: string; count: number }): void;
  };

  /** Starts an ENGINE-placed multi-hostile encounter (see the seam's contract). */
  const startMultiHostileEncounter = async (
    page: import('@playwright/test').Page,
    npcId = 'rollo_grasper',
  ): Promise<void> => {
    await expect
      .poll(
        async () => {
          await page.evaluate(
            ({ id }) =>
              (
                window as unknown as { __AIKAMI_TEST__: SeamWithMultiHostile }
              ).__AIKAMI_TEST__.startMultiHostileEncounter({ npcId: id, count: 2 }),
            { id: npcId },
          );
          return game.isCombatBudgetVisible();
        },
        { timeout: 45_000, intervals: [500, 1000, 2000, 3000, 5000] },
      )
      .toBe(true);
    await expect(game.combatIntentForm).toBeVisible({ timeout: 20_000 });
  };

  const intentStatusText = (target: GamePage): Promise<string> => target.readCombatIntentStatus();

  const submitIntent = async (target: GamePage, text: string): Promise<void> =>
    target.submitCombatIntent(text);

  /** Movement cells left, read from the engine's own budget readout. */
  const readMovement = async (target: GamePage): Promise<number> => {
    const text = await target.readCombatBudgetText();
    const match = /Move\s+(\d+)/.exec(text);
    return match ? Number(match[1]) : Number.NaN;
  };

  /**
   * Submits an instruction until the engine answers with a compiled preview.
   *
   * The AI turn runs first in this encounter, and a compile while the enemy is
   * active is rejected with `notActiveCombatant` — a legitimate answer, not a
   * failure. Every other rejection fails the test immediately so a real defect
   * cannot hide behind the retry.
   */
  const submitUntilPreview = async (
    target: GamePage,
    text: string,
    timeoutMs = 30_000,
  ): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    let lastStatus = '';
    while (Date.now() < deadline) {
      await submitIntent(target, text);
      // The snapshot + interpreter + compiler round trip is asynchronous.
      const readOutcome = async (): Promise<string> => {
        if ((await target.combatIntentPreview.count()) > 0) {
          return 'preview';
        }
        if ((await target.combatIntentClarification.count()) > 0) {
          return 'clarification';
        }
        // 'Reading your instruction…' (interpreting) and 'Compiling a plan…'
        // (compiling) are both IN FLIGHT; only a preview, a clarification or a
        // typed rejection is terminal.
        const status = await intentStatusText(target);
        return status === 'Reading your instruction…' || status === 'Compiling a plan…'
          ? 'pending'
          : 'rejected';
      };
      const outcome = await expect
        .poll(readOutcome, { timeout: 8_000, intervals: [200, 300, 500] })
        .not.toBe('pending')
        .then(() => true)
        .catch(() => false);
      if (!outcome) {
        lastStatus = await intentStatusText(target);
        continue;
      }
      lastStatus = await intentStatusText(target);
      if ((await target.combatIntentPreview.count()) > 0) {
        return;
      }
      if ((await target.combatIntentClarification.count()) > 0) {
        return;
      }
      if (lastStatus.includes('not your turn')) {
        await target.page.waitForTimeout(500);
        continue;
      }
      throw new Error(`intent was rejected with "${lastStatus}" instead of previewing`);
    }
    throw new Error(`no compiled preview appeared within ${timeoutMs}ms (last: "${lastStatus}")`);
  };

  test('AC-4 + AC-6 + AC-9: language → preview → confirm commits a real move', async ({ page }) => {
    const aiRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (/11434|8188|8089|text|generate/.test(url) && !url.includes('localhost:7716')) {
        aiRequests.push(url);
      }
    });

    await bootIntoGame(page);
    await startLiveEncounter(page);
    await expect(game.combatIntentForm).toBeVisible({ timeout: 20_000 });

    const movementBefore = await readMovement(game);

    // ── AC-6: the interpreter provider is DOWN in this environment, so a
    // compiled plan can only come from the deterministic offline parser.
    await submitUntilPreview(game, 'move to the nearest enemy');

    // ── AC-4: the compiled plan previews and commits nothing by itself.
    const preview = game.combatIntentPreview;
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('move');
    await expect(game.combatIntentConfirmButton).toBeVisible();
    expect(await readMovement(game)).toBe(movementBefore);

    // ── AC-9: an explicit confirmation commits through the existing v2 path,
    // and the engine answers with a real budget change.
    await game.combatIntentConfirmButton.click();
    await expect
      .poll(async () => readMovement(game), { timeout: 20_000, intervals: [300, 500, 1000] })
      .toBeLessThan(movementBefore);

    // The plan is gone: a committed decision returns to idle, never a pending
    // or rejected surface.
    await expect(game.combatIntentPreview).toHaveCount(0);
    expect(await intentStatusText(game)).not.toContain('Reading your instruction');

    // No model call was made for the instruction (nothing to wait on).
    expect(aiRequests).toEqual([]);
  });

  test('AC-4 + AC-9: a cancelled plan commits nothing and mixed input still works', async ({
    page,
  }) => {
    await bootIntoGame(page);
    await startLiveEncounter(page);
    await expect(game.combatIntentForm).toBeVisible({ timeout: 20_000 });

    const movementBefore = await readMovement(game);

    // ── Cancel: parsed, previewed, and explicitly NOT committed.
    await submitUntilPreview(game, 'move to the nearest enemy');
    await expect(game.combatIntentPreview).toBeVisible();
    await game.combatIntentCancelButton.click();
    await expect(game.combatIntentPreview).toHaveCount(0);
    expect(await readMovement(game)).toBe(movementBefore);

    // ── Mixed input: a real click on a highlighted cell commits a budgeted
    // move through the direct controls, in the same encounter.
    await page.getByTestId('combat-move-btn').click();
    await expect(page.getByTestId('combat-move-hint')).toBeVisible({ timeout: 15_000 });
    const clicked = await clickReachableHighlight(page);
    expect(clicked.kind).toBe('reachable');
    await expect
      .poll(async () => readMovement(game), { timeout: 20_000, intervals: [300, 500, 1000] })
      .toBeLessThan(movementBefore);
  });

  test('AC-4: a language instruction is announced to the engine and never commits before confirmation', async ({
    page,
  }) => {
    await bootIntoGame(page);
    await startLiveEncounter(page);
    await expect(game.combatIntentForm).toBeVisible({ timeout: 20_000 });

    const actionClassBefore = await game.readCombatActionLabelClass();
    if (actionClassBefore === null) {
      throw new Error('expected the Action budget label to expose its availability state');
    }
    expect(actionClassBefore).not.toContain('text-base-content/30');
    await submitUntilPreview(game, 'defend');

    // The compiled DEFEND remains a proposal until the explicit confirmation:
    // its preview is visible while the engine-owned Action budget is unchanged.
    await expect(game.combatIntentPreview).toBeVisible();
    await expect(game.combatIntentConfirmButton).toBeVisible();
    expect(await game.readCombatActionLabelClass()).toBe(actionClassBefore);
  });

  test('AC-5: a unique reading previews directly without a clarification round', async ({
    page,
  }) => {
    await bootIntoGame(page);
    await startLiveEncounter(page);
    await expect(game.combatIntentForm).toBeVisible({ timeout: 20_000 });

    await submitUntilPreview(game, 'attack the nearest enemy');

    // One hostile in this encounter: exactly one reading, so the system must
    // not ask.
    await expect(game.combatIntentPreview).toBeVisible();
    await expect(game.combatIntentClarification).toHaveCount(0);
  });

  test('C-526 AC-7 + AC-9: the AI-offline lane surfaces readable intent and the deterministic fallback', async ({
    page,
  }, testInfo) => {
    await bootIntoGame(page);
    await startLiveEncounter(page);

    const log = page.getByTestId('combat-log');
    await expect(log).toBeVisible({ timeout: 20_000 });

    /** Reads the rendered combat log, the only place these lines are visible. */
    const logText = async (): Promise<string> =>
      (await log.innerText().catch(() => '')).replace(/\s+/g, ' ');

    // ── Play until the enemy side has actually taken a turn. This lane runs
    // WITHOUT an AI provider and with `PUBLIC_COMBAT_LLM_AGENTS` unset, so the
    // pinned kill switch must keep every AI turn on the deterministic planner
    // and report that fallback once per actor (AC-9), visibly (AC-7).
    await expect
      .poll(
        async () => {
          const endTurn = page.getByTestId('combat-end-turn-btn');
          if (await endTurn.isVisible().catch(() => false)) {
            await clickWhenReady(endTurn);
          }
          await page.waitForTimeout(500);
          const text = await logText();
          return text.includes('Deterministic AI') && text.includes('Intent —');
        },
        { timeout: 45_000, intervals: [500, 500, 1000, 1000, 2000] },
      )
      .toBe(true);

    const text = await logText();

    // The degradation is reported in player-facing wording, attributed to the
    // acting combatant, and never implies a rules change.
    expect(text).toMatch(/Intent — [a-z]/);
    expect(text).toContain('Deterministic AI — agent layer off');

    // The telegraph is one of the authored, bounded intentions — never model
    // prose and never a mechanic invented by the presentation layer.
    expect(text).toMatch(
      /Intent — (preparing an attack on|manoeuvring for position|bracing for the next blow|holding position|ending the turn)/,
    );

    // AC-10 production-path evidence: the surface a player actually sees.
    await page.screenshot({ path: testInfo.outputPath('c526-ai-log.png') });
  });

  test('AC-5: two equally distant hostiles ask one bounded clarification, then confirm', async ({
    page,
  }) => {
    await bootIntoGame(page);
    // ENGINE-placed roster: two hostiles land on adjacent orthogonal cells, so
    // "the nearest enemy" has two equally good readings.
    await startMultiHostileEncounter(page);

    await submitUntilPreview(game, 'attack the nearest enemy');

    const clarification = game.combatIntentClarification;
    await expect(clarification).toBeVisible({ timeout: 15_000 });
    const options = clarification.locator('button');
    expect(await options.count()).toBeGreaterThanOrEqual(2);

    // Choosing a reading produces the preview for THAT reading — still
    // uncommitted.
    await options.first().click();
    await expect(game.combatIntentPreview).toBeVisible();
    await expect(game.combatIntentConfirmButton).toBeVisible();

    // Confirming commits it through the engine, which answers with a real
    // action-economy change: the action is spent, so the Action readout flips
    // from available to spent. (A miss changes no HP, so HP is not a valid
    // signal here — the spent action is.)
    const actionClassBefore = await game.readCombatActionLabelClass();
    await game.combatIntentConfirmButton.click();
    await expect
      .poll(async () => game.readCombatActionLabelClass(), {
        timeout: 20_000,
        intervals: [300, 500, 1000],
      })
      .not.toBe(actionClassBefore);
    expect(await game.readCombatActionLabelClass()).toContain('text-base-content/30');
    await expect(game.combatIntentPreview).toHaveCount(0);
  });
});
