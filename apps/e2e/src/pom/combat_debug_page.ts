// apps/e2e/src/pom/combat_debug_page.ts
// Page Object Model — CombatDebugPage
//
// Focused POM for the CONSOLIDATED combat debug workspace at `/dev/combat`.
//
// One route, three modes (`live | replay | fixtures`), selected by the
// `?mode=` query parameter and driven by the workspace ViewModel:
//   - live      → an isolated real engine session rendered through the
//                 production combat sidebar (`/dev/combat?mode=live`).
//   - replay    → import/compare a recorded reproduction bundle (provider-free).
//   - fixtures  → production dice/initiative/log components rendered from typed
//                 fixtures and explicitly labelled as no live simulation.
//
// This POM deliberately does NOT extend `CombatPage` (which owns the production
// `/game` helpers). It targets only the workspace chrome — toolbar, status
// strip, inspector, timeline, fixture/replay surfaces — so a change to one
// surface cannot silently move the other.
//
// DOM reference:
//   apps/frontend/client/src/lib/views/dev/combat/combat_debug_view.svelte
//   apps/frontend/client/src/lib/views/dev/combat/components/combat_debug_toolbar.svelte
//   apps/frontend/client/src/lib/views/dev/combat/components/combat_debug_inspector.svelte
//   apps/frontend/client/src/lib/views/dev/combat/components/combat_debug_timeline.svelte
//
// Contract: combat debug workspace (consolidation)

import type { Page } from '@playwright/test';

/** The three workspace modes, mirrored from `CombatDebugMode`. */
export type CombatDebugMode = 'live' | 'replay' | 'fixtures';

/**
 * Scenario ids the workspace exposes (`COMBAT_DEBUG_SCENARIOS`).
 *
 * Authored-content scenarios (`emberwatch-proof`) also need the real Emberwatch
 * content pack to be resolvable; the synthetic ones never do.
 */
export type CombatDebugScenarioId =
  | 'basic-direct-turn'
  | 'movement-geometry'
  | 'stale-duplicate-input'
  | 'direct-companion'
  | 'suggest-continuation'
  | 'ability-support'
  | 'reaction-only-ability'
  | 'environmental-action'
  | 'reaction-queue'
  | 'objective-boundary'
  | 'morale-nonlethal'
  | 'knowledge-boundary'
  | 'save-reload-retry'
  | 'terminal-recovery'
  | 'emberwatch-proof';

/** Inspector tab ids, mirrored from `COMBAT_DEBUG_INSPECTOR_TABS`. */
export type CombatDebugInspectorTab =
  | 'context'
  | 'actor'
  | 'action'
  | 'objects'
  | 'reactions'
  | 'ai';

/** Provider fault-injection modes, mirrored from `COMBAT_DEBUG_FAULT_MODES`. */
export type CombatDebugFaultMode =
  | 'disabled'
  | 'structured-success'
  | 'unavailable'
  | 'timeout'
  | 'malformed'
  | 'delayed-stale'
  | 'real';

/** Fixture presets UI-selected in fixtures mode (`COMBAT_DEBUG_FIXTURE_PRESETS`). */
export type CombatDebugFixturePreset =
  | 'initial'
  | 'log-filled'
  | 'low-hp'
  | 'victory'
  | 'defeat'
  | 'long-labels'
  | 'dice-queue';

/** Options accepted by {@link CombatDebugPage.goto}. */
export type CombatDebugGotoOptions = {
  scenario?: CombatDebugScenarioId | string;
  mode?: CombatDebugMode;
  tab?: CombatDebugInspectorTab;
  seed?: number;
};

export class CombatDebugPage {
  readonly page: Page;

  /** Origin of the dev server serving this workspace. */
  private readonly origin: string;

  constructor(page: Page, options: { origin?: string } = {}) {
    this.page = page;
    // Contract-scoped runs offset the client port; callers that need the
    // offset pass `origin`, otherwise the Playwright `baseURL` applies.
    this.origin = options.origin ?? (process.env.E2E_CLIENT_ORIGIN as string | undefined) ?? '';
  }

  // ── Navigation ────────────────────────────────────────────

  /**
   * Navigate to the consolidated workspace.
   *
   * Only the parameters the ViewModel actually reads are emitted
   * (`scenario`, `mode`, `tab`, `seed`) — the retired `?state=` presets and
   * `useRealAi` switch are no longer part of the URL contract. Fault injection
   * defaults to `disabled`, so a live boot never reaches a real provider.
   */
  async goto(options: CombatDebugGotoOptions = {}): Promise<void> {
    const params = new URLSearchParams();
    // Mode is serialized on every navigation even when defaulted: the
    // ViewModel writes it back into the URL on the first sync anyway, and an
    // explicit param keeps assertions on the final URL deterministic.
    params.set('mode', options.mode ?? 'live');
    if (options.scenario !== undefined) {
      params.set('scenario', options.scenario);
    }
    if (options.tab !== undefined) {
      params.set('tab', options.tab);
    }
    if (options.seed !== undefined) {
      params.set('seed', String(options.seed));
    }
    const query = params.toString();
    await this.page.goto(`${this.origin}/dev/combat?${query}`, {
      waitUntil: 'domcontentloaded',
    });
    await this.expectWorkspaceShell();
  }

  /** Navigate to `live` mode (the production-backed default). */
  async gotoLive(options: Omit<CombatDebugGotoOptions, 'mode'> = {}): Promise<void> {
    await this.goto({ ...options, mode: 'live' });
  }

  /** Navigate to the fixtures mode (the retired enhancements sandbox's replacement). */
  async gotoFixtures(options: Omit<CombatDebugGotoOptions, 'mode'> = {}): Promise<void> {
    await this.goto({ ...options, mode: 'fixtures' });
  }

  /** Navigate to replay mode. */
  async gotoReplay(options: Omit<CombatDebugGotoOptions, 'mode'> = {}): Promise<void> {
    await this.goto({ ...options, mode: 'replay' });
  }

  // ── Workspace shell ───────────────────────────────────────

  get workspace() {
    return this.page.getByTestId('combat-debug-view');
  }

  get toolbar() {
    return this.page.getByTestId('combat-debug-toolbar');
  }

  get statusBar() {
    return this.page.getByTestId('combat-debug-status');
  }

  get statusLabel() {
    return this.page.getByTestId('combat-debug-status-label');
  }

  get engineError() {
    return this.page.getByTestId('combat-debug-engine-error');
  }

  get modeFacet() {
    return this.page.getByText('mode', { exact: true }).first();
  }

  /** The `mode <id> · scenario <id>` facet rendered in the shell header. */
  get headerFacet() {
    return this.page.locator('p', { hasText: /mode\s*\S+\s*·\s*scenario/ });
  }

  /** The live-mode canvas host (`live` mode only). */
  get liveCanvas() {
    return this.page.locator('#combat-debug-canvas');
  }

  // ── Toolbar controls ──────────────────────────────────────

  get modeSelect() {
    return this.page.getByTestId('combat-debug-toolbar').locator('#combat-debug-mode');
  }

  get scenarioSelect() {
    return this.page.getByTestId('combat-debug-toolbar').locator('#combat-debug-scenario');
  }

  get seedInput() {
    return this.page.getByTestId('combat-debug-toolbar').locator('#combat-debug-seed');
  }

  get faultSelect() {
    return this.page.getByTestId('combat-debug-toolbar').locator('#combat-debug-fault');
  }

  get fixturePresetSelect() {
    return this.page.getByTestId('combat-debug-toolbar').locator('#combat-debug-fixture');
  }

  get restartButton() {
    return this.page.getByTestId('combat-debug-restart');
  }

  get resetButton() {
    return this.page.getByTestId('combat-debug-reset');
  }

  get pauseButton() {
    return this.page.getByTestId('combat-debug-pause');
  }

  get stepButton() {
    return this.page.getByTestId('combat-debug-step');
  }

  /**
   * The honest pause/step boundary indicator. Rendered only while the gate is
   * held, because the engine has no pause primitive — the workspace reports how
   * many commands it is actually holding instead of implying a frozen engine.
   */
  get gateState() {
    return this.page.getByTestId('combat-debug-gate-state');
  }

  get exportButton() {
    return this.page.getByTestId('combat-debug-export');
  }

  get downloadButton() {
    return this.page.getByTestId('combat-debug-download');
  }

  get copyLinkButton() {
    return this.page.getByTestId('combat-debug-copy-url');
  }

  /** Read-only textarea the export action fills (absent until exported). */
  get exportText() {
    return this.page.getByTestId('combat-debug-export-text');
  }

  // ── Actions: toolbar ──────────────────────────────────────

  async setMode(mode: CombatDebugMode): Promise<void> {
    await this.modeSelect.selectOption(mode);
  }

  async selectScenario(scenario: CombatDebugScenarioId | string): Promise<void> {
    await this.scenarioSelect.selectOption(scenario);
  }

  async setSeed(seed: number): Promise<void> {
    await this.seedInput.fill(String(seed));
    await this.seedInput.blur();
  }

  async setFaultMode(mode: CombatDebugFaultMode): Promise<void> {
    await this.faultSelect.selectOption(mode);
  }

  async setFixturePreset(preset: CombatDebugFixturePreset): Promise<void> {
    await this.fixturePresetSelect.selectOption(preset);
  }

  async clickRestart(): Promise<void> {
    await this.restartButton.click();
  }

  async clickReset(): Promise<void> {
    await this.resetButton.click();
  }

  async togglePause(): Promise<void> {
    await this.pauseButton.click();
  }

  async clickStep(): Promise<void> {
    await this.stepButton.click();
  }

  async clickExport(): Promise<void> {
    await this.exportButton.click();
  }

  async clickDownload(): Promise<void> {
    await this.downloadButton.click();
  }

  async clickCopyLink(): Promise<void> {
    await this.copyLinkButton.click();
  }

  // ── Inspector ─────────────────────────────────────────────

  get inspector() {
    return this.page.getByTestId('combat-debug-inspector');
  }

  get tablist() {
    return this.page.getByRole('tablist', { name: 'Combat debug inspectors' });
  }

  tab(tab: CombatDebugInspectorTab) {
    return this.page.getByTestId(`combat-debug-tab-${tab}`);
  }

  panel(tab: CombatDebugInspectorTab) {
    return this.page.getByTestId(`combat-debug-panel-${tab}`);
  }

  get assertions() {
    return this.page.getByTestId('combat-debug-assertions');
  }

  async selectTab(tab: CombatDebugInspectorTab): Promise<void> {
    await this.tab(tab).click();
  }

  /** Activate a tab through the keyboard, as a keyboard-only user would. */
  async selectTabViaKeyboard(
    tab: CombatDebugInspectorTab,
    from: CombatDebugInspectorTab = 'context',
  ): Promise<void> {
    // Roving focus is not implemented, so each tab must be focused directly
    // before Enter is pressed — this mirrors real Tab-to-focus behaviour.
    await this.tab(from).focus();
    await this.tab(tab).focus();
    await this.tab(tab).press('Enter');
  }

  // ── Timeline ──────────────────────────────────────────────

  get timeline() {
    return this.page.getByTestId('combat-debug-timeline');
  }

  get timelineEntries() {
    return this.page.getByTestId('combat-debug-trace-list').locator('li');
  }

  get traceIncompleteBadge() {
    return this.page.getByTestId('combat-debug-trace-incomplete');
  }

  // ── Fixtures deck ─────────────────────────────────────────

  get fixtureNotice() {
    return this.page.getByTestId('combat-debug-fixture-notice');
  }

  /** The fixtures deck's initiative section heading. */
  get fixtureInitiativeHeading() {
    return this.page.getByRole('heading', {
      name: 'Initiative tracker (read-only fixture projection)',
    });
  }

  get fixtureLogHeading() {
    return this.page.getByRole('heading', { name: 'Enriched combat log' });
  }

  get fixtureDiceHeading() {
    return this.page.getByRole('heading', {
      name: 'Queued dice (read-only fixture projection)',
    });
  }

  get fixtureStatusHeading() {
    return this.page.getByRole('heading', { name: 'Status effects' });
  }

  get fixtureTitle() {
    return this.page.getByRole('heading', { name: /^Fixture: / });
  }

  /** Production `TurnTrackerHeader` rendered from the fixture projection. */
  get fixtureTurnTracker() {
    return this.page.locator('.turn-tracker-header');
  }

  /** Production `InitiativeTracker` rendered from the fixture projection. */
  get fixtureInitiativeTracker() {
    return this.page.locator('.initiative-tracker');
  }

  /** Production `EnrichedLogEntry` rows rendered from the fixture projection. */
  get fixtureEnrichedLogEntries() {
    return this.page.locator('.enriched-log-entry');
  }

  /** Queued dice badges inside the fixtures deck. */
  get fixtureDiceBadges() {
    return this.page
      .getByRole('heading', { name: 'Queued dice (read-only fixture projection)' })
      .locator('xpath=following-sibling::ul[1]/li');
  }

  // ── Replay deck ───────────────────────────────────────────

  get importTextarea() {
    return this.page.getByTestId('combat-debug-import-text');
  }

  get importButton() {
    return this.page.getByTestId('combat-debug-import');
  }

  get replayResult() {
    return this.page.getByTestId('combat-debug-replay-result');
  }

  get replayDivergence() {
    return this.page.getByTestId('combat-debug-replay-divergence');
  }

  async importBundle(text: string): Promise<void> {
    await this.importTextarea.fill(text);
    await this.importButton.click();
  }

  // ── Assertions (lazy import keeps this POM framework-agnostic) ──

  /** Waits for the workspace shell to mount. */
  async expectWorkspaceShell(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.workspace).toBeVisible();
    await expect(this.toolbar).toBeVisible();
  }

  /** Waits for the live engine session to report ready (live mode only). */
  async expectEngineReady(timeout = 30_000): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.statusBar).toBeVisible();
    await expect
      .poll(async () => (await this.statusLabel.innerText()).trim(), { timeout })
      .not.toMatch(/Booting engine/i);
  }

  /** The workspace reached a live, interactive engine state. */
  async expectLiveSessionInteractive(timeout = 45_000): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.statusBar).toBeVisible();
    await expect(this.liveCanvas).toBeAttached({ timeout });
    await expect(this.statusBar).toContainText('Ready', { timeout });
  }

  /** The status badge reads exactly the given label. */
  async expectStatusLabel(label: string | RegExp): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.statusLabel).toHaveText(label);
  }

  /** No engine error is surfaced in the status strip. */
  async expectNoEngineError(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.engineError).toHaveCount(0);
  }

  /** The persistent "this is not a real fight" fixture banner. */
  async expectFixtureNotice(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.fixtureNotice).toBeVisible();
    await expect(this.fixtureNotice).toContainText('Presentation fixture — no live simulation');
  }

  async expectFixtureDeck(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.fixtureTurnTracker).toBeVisible();
    await expect(this.fixtureInitiativeTracker).toBeVisible();
    await expect(this.fixtureEnrichedLogEntries.first()).toBeVisible();
  }

  async expectFixturePreset(preset: CombatDebugFixturePreset): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.fixturePresetSelect).toHaveValue(preset);
  }

  /** Fixtures mode never boots an engine; no session canvas is attached. */
  async expectNoLiveCanvas(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.liveCanvas).toHaveCount(0);
  }

  async expectInspectorTabActive(tab: CombatDebugInspectorTab): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.tab(tab)).toHaveAttribute('aria-selected', 'true');
    await expect(this.panel(tab)).toBeVisible();
  }

  async expectTimelineVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.timeline).toBeVisible();
  }

  async expectReplayResult(pattern: string | RegExp): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.replayResult).toBeVisible();
    await expect(this.replayResult).toContainText(pattern);
  }

  /** The URL's query string reflects the workspace configuration. */
  async expectUrlQuery(expected: Record<string, string>): Promise<void> {
    const { expect } = await import('@playwright/test');
    const url = new URL(this.page.url());
    for (const [key, value] of Object.entries(expected)) {
      expect(url.searchParams.get(key)).toBe(value);
    }
  }
}
