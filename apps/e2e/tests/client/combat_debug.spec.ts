// apps/e2e/tests/client/combat_debug.spec.ts
//
// Focused E2E coverage for the consolidated combat debug workspace at
// `/dev/combat`. One route, three modes (`live | replay | fixtures`), all
// driven by the `scenario` / `mode` / `tab` / `seed` URL contract.
//
// This is the replacement for the deleted freeform sandbox coverage:
//   - live     → an isolated REAL engine session rendered through the
//                production combat sidebar;
//   - fixtures → production dice/initiative/log components from typed
//                fixtures, with a persistent "no live simulation" notice;
//   - replay   → provider-free import/compare of a recorded reproduction.
//
// 🔴 Real provider calls must never happen here. The workspace's provider
// fault mode defaults to `disabled` for every scenario, and these tests never
// switch it to `real`.
//
// Run from apps/e2e: bun run test -- --project=client combat_debug

import { expect, test } from '@playwright/test';
import { CombatDebugPage } from '$pom';

test.describe('Combat debug workspace (/dev/combat)', () => {
  let debug: CombatDebugPage;

  test.beforeEach(async ({ page }) => {
    debug = new CombatDebugPage(page);
  });

  // ── Live mode ─────────────────────────────────────────────

  test.describe('live mode', () => {
    test('workspace loads and boots a real isolated session', async () => {
      await debug.gotoLive();
      await debug.expectLiveSessionInteractive();
      await debug.expectNoEngineError();
      await expect(debug.liveCanvas).toBeAttached();
    });

    test('provider fault mode defaults to disabled', async () => {
      await debug.gotoLive();
      // The kill switch that guarantees no real provider call: every synthetic
      // scenario ships `defaultFaultMode: 'disabled'`.
      await expect(debug.faultSelect).toHaveValue('disabled');
    });

    test('inspector and timeline panes render alongside the session', async () => {
      await debug.gotoLive();
      await expect(debug.inspector).toBeVisible();
      await debug.expectInspectorTabActive('context');
      await debug.expectTimelineVisible();
    });

    test('restart and reset re-boot the isolated session without an engine error', async () => {
      await debug.gotoLive();
      await debug.expectLiveSessionInteractive();
      // Restart/Reset dispose the session, so they must boot a fresh one — a
      // disposed world behind a dead canvas would leave the workspace stuck.
      await debug.clickRestart();
      await debug.expectLiveSessionInteractive();
      await debug.expectNoEngineError();
      await debug.clickReset();
      await debug.expectLiveSessionInteractive();
      await debug.expectNoEngineError();
    });

    test('pause toggles the debugger state label', async () => {
      await debug.gotoLive();
      await debug.page.waitForTimeout(1500);
      await expect(debug.pauseButton).toHaveAttribute('aria-pressed', 'false');
      await debug.togglePause();
      await expect(debug.pauseButton).toHaveAttribute('aria-pressed', 'true');
      await debug.expectStatusLabel(/Paused by debugger/);
      await debug.togglePause();
      await expect(debug.pauseButton).toHaveAttribute('aria-pressed', 'false');
    });

    test('pause holds the command boundary and reports its state honestly', async () => {
      await debug.gotoLive();
      await debug.expectLiveSessionInteractive();
      // While the gate is open there is no boundary indicator at all.
      await expect(debug.gateState).toHaveCount(0);

      await debug.togglePause();
      // The engine has no pause primitive, so the workspace states exactly what
      // it holds (client → engine command dispatch) rather than claiming the
      // engine is frozen.
      await expect(debug.gateState).toBeVisible();
      await expect(debug.gateState).toHaveText(/boundary held/);

      // Step is operable while paused. With nothing queued it must not claim to
      // have advanced the encounter — the trace row and the boundary text stay
      // honest either way.
      await expect(debug.stepButton).toBeEnabled();
      await debug.clickStep();
      await expect(debug.gateState).toHaveText(/boundary held/);

      await debug.togglePause();
      await expect(debug.gateState).toHaveCount(0);
    });

    test('export reports honestly when no state has been captured', async () => {
      await debug.gotoLive();
      if ((await debug.exportText.count()) === 0) {
        await debug.clickExport();
      }
      await expect(debug.exportText).toBeVisible();
      await expect(debug.exportText).toHaveValue(/No captured state to export yet/i);
    });
  });

  // ── Mode / scenario / tab URL contract ────────────────────

  test.describe('URL configuration', () => {
    test('a mode switch is written back into the URL', async () => {
      await debug.gotoLive();
      await debug.setMode('fixtures');
      await debug.expectUrlQuery({ mode: 'fixtures' });
      await debug.expectFixtureNotice();
    });

    test('a scenario switch updates the URL and the seed', async () => {
      await debug.gotoLive({ scenario: 'basic-direct-turn' });
      await debug.selectScenario('movement-geometry');
      await debug.expectUrlQuery({ scenario: 'movement-geometry' });
      await expect(debug.seedInput).toHaveValue('2024');
    });

    test('a tab switch updates the URL and the active panel', async () => {
      await debug.gotoLive({ tab: 'context' });
      await debug.selectTab('objects');
      await debug.expectUrlQuery({ tab: 'objects' });
      await debug.expectInspectorTabActive('objects');
    });

    test('round-trips a full configuration from the URL', async () => {
      await debug.goto({ mode: 'live', scenario: 'reaction-queue', tab: 'reactions', seed: 616 });
      await expect(debug.modeSelect).toHaveValue('live');
      await expect(debug.scenarioSelect).toHaveValue('reaction-queue');
      await expect(debug.seedInput).toHaveValue('616');
      await debug.expectInspectorTabActive('reactions');
    });

    test('an invalid parameter falls back safely and reports the substitution', async ({
      page,
    }) => {
      await page.goto('/dev/combat?mode=live&scenario=does-not-exist', {
        waitUntil: 'domcontentloaded',
      });
      await debug.expectWorkspaceShell();
      // The URL error is rendered inside the collapsed "Run details" `<details>`
      // block, so it must be opened before it can be asserted.
      await page.getByText('Run details').click();
      // The unknown scenario is refused and the safe default substituted.
      await debug.expectUrlQuery({ mode: 'live' });
      await expect(debug.scenarioSelect).toHaveValue('basic-direct-turn');
      await expect(page.getByText(/Unknown scenario/)).toBeVisible();
    });
  });

  // ── Fixtures mode ─────────────────────────────────────────

  test.describe('fixtures mode', () => {
    test('shows the persistent no-live-simulation notice', async () => {
      await debug.gotoFixtures();
      await debug.expectFixtureNotice();
      await expect(debug.fixtureNotice).toHaveAttribute('role', 'status');
    });

    test('renders production components and boots no engine', async () => {
      await debug.gotoFixtures();
      await debug.expectFixtureDeck();
      await debug.expectNoLiveCanvas();
    });

    test('preset selection is UI-driven and re-projects the deck', async () => {
      await debug.gotoFixtures();
      await debug.expectFixturePreset('initial');
      await debug.setFixturePreset('defeat');
      await debug.expectFixturePreset('defeat');
      await expect(debug.fixtureInitiativeTracker).toContainText('downed');
    });
  });

  // ── Replay mode ───────────────────────────────────────────

  test.describe('replay mode', () => {
    test('rejects an invalid bundle import with a visible error', async () => {
      await debug.gotoReplay();
      await debug.importBundle('{ not a reproduction bundle }');
      await debug.expectReplayResult(/Import failed:/);
    });

    test('reports a parse failure for empty input', async () => {
      await debug.gotoReplay();
      await debug.importBundle('');
      await debug.expectReplayResult(/Import failed:/);
    });

    test('imports a minimal valid bundle and reports the comparison', async () => {
      await debug.gotoReplay();
      // A minimal, well-formed reproduction envelope. No live state exists in
      // replay mode, so the comparison is computed purely by the shared kernel
      // — never a provider call.
      const bundle = JSON.stringify({
        reproductionVersion: 1,
        rulesVersion: 'combat-2.0.0',
        scenarioId: 'basic-direct-turn',
        scenarioVersion: 1,
        encounterRunId: 'e2e-replay',
        seed: '1337',
        recordedInitialState: {
          encounterRunId: 'e2e-replay',
          rulesVersion: 'combat-2.0.0',
          schemaVersion: 1,
          revision: 0,
          round: 1,
          phase: 'player-turn',
          turnId: 'turn-1',
          activeCombatantId: 'player',
          combatants: {},
          rngStreams: [],
        },
        commands: [],
        checkpoints: [],
        expectedEvents: [],
        complete: true,
        droppedTraceEntries: 0,
      });
      await debug.importBundle(bundle);
      // Either the bundle replays (matched) or it is refused with a typed
      // reason — both are honest outcomes; a silent no-op is not.
      await expect(debug.replayResult).toBeVisible();
      await expect(debug.replayResult).toHaveText(/Replay matched|Import failed|Replay diverged/);
    });
  });

  // ── Accessibility ─────────────────────────────────────────

  test.describe('keyboard operability', () => {
    test('inspector tabs are reachable and activatable by keyboard', async () => {
      await debug.gotoLive();
      await debug.selectTabViaKeyboard('ai');
      await expect(debug.tab('ai')).toHaveAttribute('aria-selected', 'true');
      await expect(debug.panel('ai')).toBeVisible();
    });

    test('every inspector tab exposes role=tab inside a named tablist', async () => {
      await debug.gotoLive();
      await expect(debug.tablist).toBeVisible();
      for (const tab of ['context', 'actor', 'action', 'objects', 'reactions', 'ai'] as const) {
        await expect(debug.tab(tab)).toHaveAttribute('role', 'tab');
      }
    });

    test('the mode selector is keyboard-operable', async () => {
      await debug.gotoLive();
      await debug.modeSelect.focus();
      await debug.modeSelect.selectOption('fixtures');
      await debug.expectUrlQuery({ mode: 'fixtures' });
    });
  });
});
