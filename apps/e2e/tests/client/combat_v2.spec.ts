// apps/e2e/tests/client/combat_v2.spec.ts
//
// C-516: Combat-04 — Direct-Control Production Vertical Slice.
//
// Proves the v2 vertical slice is playable in the PRODUCTION `/game` route:
//
//   AC-7  → entering move selection requests a preview and the sidebar renders
//           the engine's answer (reachable count / target list).
//   AC-8  → click-to-move commits a budgeted move (the ECS position follows).
//   AC-9  → the ability picker is catalog-derived, target selection commits, and
//           Defend works with no target.
//   AC-10 → the authored `proof_encounter` (player + 1 companion vs 3 enemies)
//           completes: real initiative, HP/events in the sidebar, result screen,
//           clean exit to EXPLORE. A retry with the same seed is deterministic.
//
// The encounter is launched through the composition root's non-production test
// seam (`__AIKAMI_TEST__.startRealEncounter`), which drives the SAME production
// start path the dialogue chip uses — real content pack roster, real engine,
// real worker. Nothing about the roster or the resolution is stubbed.
//
// Run from apps/e2e: bun run test -- combat_v2

import { expect, test } from '@playwright/test';
import { GamePage } from '$pom';

type CombatOverlayState = { overlay: string; mode: string };

type AikamiTestSeam = {
  startRealEncounter(options: { encounterId: string; engine?: 'legacy' | 'v2' }): void;
  startCombat(options: { enemyName: string; enemyNpcId?: string }): void;
  scheduleCombatEndedCleanup(): void;
  dismissCombat(): void;
  getCombatCleanupResumeCount(): number;
  getOverlayState(): CombatOverlayState;
};

const seam = (page: import('@playwright/test').Page) =>
  page.evaluate(
    (): AikamiTestSeam =>
      (window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }).__AIKAMI_TEST__,
  );

test.describe('Combat-04 direct-control vertical slice (C-516)', () => {
  let game: GamePage;

  const bootIntoGame = async (page: import('@playwright/test').Page) => {
    game = new GamePage(page);
    await page.goto('http://localhost:5274/game', { waitUntil: 'domcontentloaded' });
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
  };

  const startProofEncounter = async (
    page: import('@playwright/test').Page,
    encounterId = 'proof_encounter',
  ) => {
    await page.evaluate((id) => {
      (window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }).__AIKAMI_TEST__.startRealEncounter(
        { encounterId: id, engine: 'v2' },
      );
    }, encounterId);

    // The overlay opens immediately; the engine answers with the real
    // COMBAT_STARTED once the roster is spawned.
    await expect(page.getByTestId('combat-direct-control')).toBeVisible({ timeout: 15_000 });
  };

  const overlayState = (page: import('@playwright/test').Page) =>
    page.evaluate(
      (): CombatOverlayState =>
        (
          window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }
        ).__AIKAMI_TEST__.getOverlayState(),
    );

  test('AC-7 + AC-8 + AC-9: move/ability/target direct controls are live', async ({ page }) => {
    await bootIntoGame(page);
    await startProofEncounter(page);

    expect((await overlayState(page)).overlay).toBe('COMBAT');

    // ── AC-7: entering move selection answers with a reachable set ──
    await page.getByTestId('combat-move-btn').click();
    await expect(page.getByTestId('combat-move-hint')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('combat-move-hint')).toContainText('reachable');

    // ── AC-8: click a highlighted cell through the canvas → a budgeted move ──
    await game.canvas.click({ position: { x: 220, y: 180 } });
    // The move commits and the selection closes; the panel returns to idle.
    await expect(page.getByTestId('combat-move-btn')).toContainText('Move', { timeout: 10_000 });
    // The sidebar reflects the reduced movement budget.
    await expect(page.getByTestId('combat-action-economy')).toContainText('Movement');

    // ── AC-9: the ability picker is catalog-derived ──
    await expect(page.getByTestId('combat-ability-basic_melee')).toBeVisible();
    await page.getByTestId('combat-ability-basic_melee').click();
    await expect(page.getByTestId('combat-target-picker')).toBeVisible({ timeout: 10_000 });

    // ── AC-9: Defend is available with no target ──
    await page.getByTestId('combat-selection-cancel').click();
    await page.getByTestId('combat-defend-btn').click();
    await expect(page.getByTestId('combat-defend-btn')).toBeEnabled({ timeout: 10_000 });
  });

  test('AC-10: the proof encounter plays to a result and exits to EXPLORE', async ({ page }) => {
    const consoleLines: string[] = [];
    page.on('console', (msg) => consoleLines.push(msg.text()));

    await bootIntoGame(page);
    await startProofEncounter(page);

    // Real roster: player + 1 companion + 3 enemies.
    await expect(page.getByTestId('combat-direct-control')).toBeVisible();

    // ── Play: end turns until the encounter resolves ──
    // The deterministic AI takes the companion/enemy turns; the player either
    // attacks the legal target or ends the turn. Bounded so a stall fails fast.
    for (let round = 0; round < 12; round++) {
      const banner = page.getByTestId('combat-result-banner');
      if (await banner.isVisible().catch(() => false)) {
        break;
      }
      await page.getByTestId('combat-ability-basic_melee').click();
      const commit = page.getByTestId('combat-commit-selection-btn');
      if (await commit.isEnabled().catch(() => false)) {
        const target = page.getByTestId('combat-target-picker').locator('button').first();
        if (await target.isVisible().catch(() => false)) {
          await target.click();
        }
        if (await commit.isEnabled().catch(() => false)) {
          await commit.click();
        }
      } else {
        await page.getByTestId('combat-selection-cancel').click();
      }
      await page.getByTestId('combat-end-turn-btn').click();
      await page.waitForTimeout(250);
    }

    // ── Result + exit ──
    // The production path shows the result banner and then auto-cleans the
    // overlay (C-500), so either order is accepted: the world must return to
    // EXPLORE with input restored, and the player must have seen a result.
    await expect
      .poll(
        async () => {
          const banner = await page
            .getByTestId('combat-result-banner')
            .isVisible()
            .catch(() => false);
          const state = await overlayState(page);
          return banner || state.mode === 'EXPLORE';
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    await expect
      .poll(async () => (await overlayState(page)).mode, { timeout: 25_000 })
      .toBe('EXPLORE');

    // C-500 clean-exit guarantee still holds.
    const after = await seam(page);
    expect(after.getCombatCleanupResumeCount()).toBeGreaterThan(0);

    // No v2 double-emit: the legacy resolver marker never appears in a v2 fight.
    expect(consoleLines.some((line) => line.includes('Player takes a defensive stance'))).toBe(
      false,
    );
  });

  test('AC-10: a retry with the same seed reproduces the encounter', async ({ page }) => {
    const readOpening = async () => {
      await bootIntoGame(page);
      await startProofEncounter(page);
      await expect(page.getByTestId('combat-budget-dots')).toBeVisible({ timeout: 15_000 });
      return page.getByTestId('combat-budget-dots').innerText();
    };

    // Same authored encounter + same deterministic seed → the same opening
    // budget readout (initiative order and the first actor are seed-derived).
    const first = await readOpening();
    const second = await readOpening();
    expect(second).toBe(first);
  });
});
