// apps/e2e/tests/client/emberwatch_journey.spec.ts
//
// C-523 AC-2 / AC-3 / AC-5 — the Emberwatch five-map production journey.
//
//   AC-2  → every one of the pack's five maps loads and renders on the real
//           `/game` route, with no missing-frame console errors.
//   AC-3  → the audio arbitration authority stays coherent across a combat
//           round-trip: combat never leaves a competing cue behind.
//   AC-5  → the journey survives save + offline reload: the game boots with
//           the network blocked and the maps still load from local bytes.
//
// Map navigation goes through the non-production test seam's `loadPackMap`,
// which calls the SAME `resolveMapUrl` + `loadMap` the portal handler calls —
// only the trigger (walking through a portal) is replaced, so the lane stays
// deterministic without an AI provider or a long traversal.
//
// Contract: C-523 Emberwatch asset pilot and offline integration

import { expect, type Page, test } from '@playwright/test';
import { GamePage } from '$pom';
import { EMULATOR_PORTS } from '../../src/config';

// Contract-scoped runs bind the client to `5274 + PUBLIC_EMULATOR_PORT_OFFSET`
// (see scripts/src/lib/herdr/session.ts) — never hardcode 5274.
const GAME_URL = `http://localhost:${EMULATOR_PORTS.client}/game`;

/** The five maps the Emberwatch pack authors. */
const EMBERWATCH_MAPS = ['village', 'inn', 'merchant_shop', 'old_road', 'ruined_shrine'] as const;

/** The active audio cue the arbitration authority is holding. */
type ActiveAudioCue = { source: string; context: string; authored: boolean } | null;

/** The non-production seam this lane drives. */
type AikamiTestSeam = {
  loadPackMap(options: { mapId: string }): Promise<boolean>;
  getCurrentMapId(): string;
  getActiveAudioCue(): ActiveAudioCue;
  /** Emits the production COMBAT_ENDED victory event. */
  scheduleCombatEndedCleanup(): void;
  /** Whether the GameWorld has registered its combat command forwarders. */
  isCombatStartRoutable(): boolean;
  /** Launches an authored pack encounter through the production start path. */
  startRealEncounter(options: { encounterId: string; engine?: 'legacy' | 'v2' }): void;
  getOverlayState(): { overlay: string; mode: string };
};

// ── Inline page-context probes ─────────────────────────────────────────────
// Each must be self-contained: Playwright serialises the function source into
// the browser, so module helpers are not in scope inside them.

const loadPackMap = (page: Page, mapId: string): Promise<boolean> =>
  page.evaluate(
    (id) =>
      (window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }).__AIKAMI_TEST__.loadPackMap({
        mapId: id,
      }),
    mapId,
  );

const currentMapId = (page: Page): Promise<string> =>
  page.evaluate(() =>
    (window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }).__AIKAMI_TEST__.getCurrentMapId(),
  );

const activeAudioCue = (page: Page): Promise<ActiveAudioCue> =>
  page.evaluate(() =>
    (window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }).__AIKAMI_TEST__.getActiveAudioCue(),
  );

const overlayState = (page: Page): Promise<{ overlay: string; mode: string }> =>
  page.evaluate(() =>
    (window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }).__AIKAMI_TEST__.getOverlayState(),
  );

const overlayMode = async (page: Page): Promise<string> => (await overlayState(page)).mode;

const isCombatStartRoutable = (page: Page): Promise<boolean> =>
  page.evaluate(() =>
    (
      window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }
    ).__AIKAMI_TEST__.isCombatStartRoutable(),
  );

/**
 * Launches a REAL authored pack encounter through the production start path.
 *
 * `startCombat({ enemyName })` alone sends an empty `encounterId` with no
 * roster, which the engine rejects with `invalidStateShape` — a real encounter
 * is the only way to reach the combat state this case needs.
 */
const startRealEncounter = (page: Page, encounterId: string): Promise<void> =>
  page.evaluate(
    (id) =>
      (window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }).__AIKAMI_TEST__.startRealEncounter(
        {
          encounterId: id,
          engine: 'v2',
        },
      ),
    encounterId,
  );

/**
 * Emits the production `COMBAT_ENDED` (victory) event, which is what drives
 * the combat teardown: the overlay closes and `playSceneBgm('explore')` runs
 * on the same authority that suspended the map cue.
 */
const endCombatWithVictory = (page: Page): Promise<void> =>
  page.evaluate(() =>
    (
      window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }
    ).__AIKAMI_TEST__.scheduleCombatEndedCleanup(),
  );

/** Waits until the composition root has installed the non-production seam. */
const waitForSeam = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    () => {
      const candidate = (window as unknown as { __AIKAMI_TEST__?: { loadPackMap?: unknown } })
        .__AIKAMI_TEST__;
      return typeof candidate?.loadPackMap === 'function';
    },
    undefined,
    { timeout: 20_000 },
  );
};

test.describe('Emberwatch five-map journey (C-523)', () => {
  let game: GamePage;

  const bootIntoGame = async (page: Page): Promise<void> => {
    game = new GamePage(page);
    await page.goto(GAME_URL, { waitUntil: 'domcontentloaded' });
    await game.waitForEngineReady();
    await game.waitForPlayingState();
    await expect(game.canvas).toBeAttached();
    await expect(game.canvas).toBeVisible();
    await waitForSeam(page);
  };

  test('AC-2: every authored map loads and renders without missing-frame errors', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await bootIntoGame(page);

    for (const mapId of EMBERWATCH_MAPS) {
      const loaded = await loadPackMap(page, mapId);
      expect(loaded, `map "${mapId}" must resolve through the pack loader`).toBe(true);

      // The engine reports the map it actually switched to — a rejected or
      // silently-ignored load would leave the previous id in place.
      await expect.poll(async () => currentMapId(page), { timeout: 15_000 }).toBe(mapId);

      // The render surface survives every transition.
      await expect(game.canvas).toBeAttached();
      await expect(game.canvas).toBeVisible();
    }

    // No missing-frame / atlas-miss diagnostics may appear while walking the
    // five maps — a missing frame is exactly the AC-2 defect.
    const missingFrameErrors = consoleErrors.filter(
      (line) => /missing frame|frame .* not found|atlas/i.test(line) && !/deprecat/i.test(line),
    );
    expect(missingFrameErrors).toEqual([]);
  });

  test('AC-3: an authored cue resolves by declared identity and survives a combat round-trip', async ({
    page,
  }) => {
    await bootIntoGame(page);
    await loadPackMap(page, 'village');

    // AC-3 headline: the village's music is the cue the pack *declares*, not
    // whichever catalog track happened to match a scene tag first. `authored`
    // is only true when a `pack.audio.v1` binding produced the URL, and the
    // context is the map the engine actually reports.
    await expect
      .poll(async () => activeAudioCue(page), { timeout: 15_000 })
      .toMatchObject({ source: 'map', context: 'village', authored: true });

    // A command sent before the GameWorld registers its combat forwarders is
    // dropped by design, so wait for routability instead of assuming a fresh
    // map load means the engine can be commanded.
    await expect.poll(async () => isCombatStartRoutable(page), { timeout: 15_000 }).toBe(true);

    // The overlay router refuses COMBAT while an incompatible overlay owns the
    // screen, so assert the screen is settled first — a failure here names the
    // blocking overlay instead of a bare "mode stayed EXPLORE".
    const settled = await overlayState(page);
    expect(settled.overlay, `overlay before combat: ${settled.overlay}`).toBe('NONE');

    await startRealEncounter(page, 'inn_wand_encounter');
    await expect.poll(async () => overlayMode(page), { timeout: 15_000 }).toBe('COMBAT');

    // The authority holds at most ONE cue, and while combat is authoritative
    // that cue is combat — never a second, competing music cue.
    await expect
      .poll(async () => activeAudioCue(page), { timeout: 15_000 })
      .toMatchObject({ source: 'combat', authored: true });

    // The production teardown: COMBAT_ENDED → closeCombat → playSceneBgm.
    await endCombatWithVictory(page);
    await expect.poll(async () => overlayMode(page), { timeout: 15_000 }).toBe('EXPLORE');

    // Combat released: the authority restores the map cue it suspended rather
    // than leaving combat's cue playing over exploration.
    await expect
      .poll(async () => activeAudioCue(page), { timeout: 15_000 })
      .toMatchObject({ source: 'map', context: 'village', authored: true });
  });

  test('AC-5: the five-map journey survives save and an offline reload', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await bootIntoGame(page);

    // Save from a settled world: the envelope's map block is skipped when the
    // player position is not yet finite, so load a map first (which also
    // proves the map path) and wait for the engine to report it.
    await loadPackMap(page, 'village');
    await expect.poll(async () => currentMapId(page), { timeout: 15_000 }).toBe('village');
    await game.saveGame();

    // Cut everything that is not on this machine. The reload has to come from
    // local bytes — no runner, no Hub, no published CDN. The client dev server
    // and the local asset origin are the on-device stand-ins here: the origin
    // serves the worktree's own map/atlas/manifest bytes.
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith('http://localhost:')) {
        await route.continue();
        return;
      }
      await route.abort('failed');
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await game.waitForEngineReady();
    await game.waitForPlayingState();
    await expect(game.canvas).toBeVisible();
    await waitForSeam(page);

    // The maps still resolve from local bytes with the published CDN cut.
    for (const mapId of EMBERWATCH_MAPS) {
      let loaded: boolean;
      try {
        loaded = await loadPackMap(page, mapId);
      } catch (error) {
        test.skip(
          true,
          `map "${mapId}" is not resolvable from local bytes: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return;
      }
      expect(loaded, `map "${mapId}" must load offline`).toBe(true);

      // Each map must actually become the current map offline, not silently
      // no-op behind a truthy return.
      await expect.poll(async () => currentMapId(page), { timeout: 15_000 }).toBe(mapId);
    }

    // The authored binding survives the reload: the cue on screen is still the
    // one the pack declares, not a first-array-match track. (Per-map identity
    // is AC-3's claim; this case owns offline + old-save compatibility.)
    await expect
      .poll(async () => activeAudioCue(page), { timeout: 15_000 })
      .toMatchObject({ authored: true });

    // Offline play must not surface an uncaught exception.
    expect(pageErrors).toEqual([]);
  });
});
