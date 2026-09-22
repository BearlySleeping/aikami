// apps/frontend/client/src/lib/views/dev/combat/combat_debug_view_model.svelte.ts
//
// Focused workspace ViewModel for the consolidated combat debug workspace. One
// ViewModel and one route serve three explicit modes:
//
//   live      — a real, isolated GameWorld/worker/kernel session driven by the
//               production combat controls. Engine facts are authoritative.
//   replay    — import or select a recorded run and replay it with the shared
//               pure kernel; read-only, provider-free.
//   fixtures  — production dice/initiative/log components rendered from typed
//               fixture projections, clearly labelled as no live simulation.
//
// The ViewModel owns every resource a mode allocates (worker, listeners,
// timers, provider requests, textures) and disposes each exactly once. Startup
// is guarded by a generation counter so a scenario switch or navigation-away
// cannot finish booting an obsolete session.
//
// Production singletons reach this ViewModel only through typed capabilities,
// wired in ./combat_debug_composition.ts — this module never imports
// `$services`.
//
// Contract: combat debug workspace (execution prompt §1–§8)

import type {
  DebugSceneOverlayLayers,
  GameWorldViewportDiagnostics,
} from '@aikami/frontend/engine';
import { BaseViewModel } from '@aikami/frontend/services/base';
import type { CombatReproduction, CombatState } from '@aikami/types';
import { untrack } from 'svelte';
import type { CombatViewModelInterface } from '$views/combat/combat_view_model.svelte';
import {
  buildCombatDebugBattlefieldDiagnostics,
  type CombatDebugBattlefieldDiagnostics,
} from './battlefield/combat_debug_battlefield_diagnostics.ts';
import {
  buildCombatDebugSceneSpec,
  countCombatDebugCombatants,
  DEFAULT_COMBAT_DEBUG_OVERLAY_LAYERS,
} from './battlefield/combat_debug_battlefield_projection.ts';
import {
  buildCombatDebugReproduction,
  buildCombatDebugSnapshotTrace,
  buildCombatDebugStepTrace,
  COMBAT_DEBUG_STATUS_LABELS,
} from './combat_debug_projection.ts';
import { createCombatDebugRecording } from './combat_debug_recording.ts';
import {
  buildCombatDebugPresentationFixture,
  COMBAT_DEBUG_FIXTURE_NOTICE,
  COMBAT_DEBUG_FIXTURE_PRESETS,
  type CombatDebugFixturePresetId,
  type CombatDebugPresentationFixture,
} from './fixtures/combat_debug_fixtures.ts';
import {
  buildCombatDebugActionSummary,
  buildCombatDebugActorSummary,
  buildCombatDebugAiSummary,
  buildCombatDebugContext,
  buildCombatDebugObjectsSummary,
  buildCombatDebugReactionSummary,
  type CombatDebugActorSummary,
  type CombatDebugAiSummary,
  type CombatDebugContextSummary,
  type CombatDebugObjectsSummary,
  type CombatDebugReactionSummary,
  evaluateCombatDebugAssertions,
} from './inspector/combat_debug_inspector.ts';
import {
  type CombatDebugReplayComparison,
  compareReproduction,
  describeDivergence,
  downloadReproduction,
  exportReproductionToJson,
  importReproductionFromText,
  replayImportedReproduction,
} from './replay/combat_debug_replay.ts';
import {
  COMBAT_DEBUG_SCENARIOS,
  resolveCombatDebugScenario,
} from './scenarios/combat_debug_scenarios.ts';
import {
  parseCombatDebugUrlConfig,
  serializeCombatDebugUrlConfig,
} from './scenarios/combat_debug_url_config.ts';
import type {
  CombatDebugPointerProjection,
  CombatDebugSelectionProjection,
  CombatDebugSession,
  CombatDebugSessionSnapshot,
} from './session/combat_debug_session_contract.ts';
import { createCombatDebugSessionObserver } from './session/combat_debug_session_observer.ts';
import { CombatDebugTraceBuffer, type CombatDebugTraceEntry } from './trace/combat_debug_trace.ts';
import type {
  CombatDebugControllerRecord,
  CombatDebugScenarioDefinition,
} from './types/combat_debug_types.ts';
import {
  COMBAT_DEBUG_ASSERTIONS,
  type CombatDebugAssertionViolation,
  type CombatDebugControlOwner,
  type CombatDebugFaultMode,
  type CombatDebugInspectorTab,
  type CombatDebugMode,
  type CombatDebugStatus,
} from './types/combat_debug_types.ts';

// The contract lives in ./types/combat_debug_view_model_types.ts so this module
// stays inside its source-size budget. It is re-exported as a local alias so
// importers keep one import site and the MVVM guard still sees the names.
import type {
  CombatDebugViewModelCapabilities,
  CombatDebugViewModelInterface as CombatDebugViewModelInterfaceContract,
  CombatDebugViewModelOptions as CombatDebugViewModelOptionsContract,
} from './types/combat_debug_view_model_types.ts';

export type CombatDebugViewModelInterface = CombatDebugViewModelInterfaceContract;
export type CombatDebugViewModelOptions = CombatDebugViewModelOptionsContract;

const MODE_OPTIONS: readonly CombatDebugMode[] = ['live', 'replay', 'fixtures'];
const FAULT_OPTIONS: readonly CombatDebugFaultMode[] = [
  'disabled',
  'structured-success',
  'unavailable',
  'timeout',
  'malformed',
  'delayed-stale',
  'real',
];
const TAB_OPTIONS: readonly CombatDebugInspectorTab[] = [
  'context',
  'actor',
  'action',
  'objects',
  'reactions',
  'ai',
];

/** Human labels for statuses are defined beside the projection builders. */

class CombatDebugViewModel
  extends BaseViewModel<CombatDebugViewModelOptions>
  implements CombatDebugViewModelInterface
{
  mode = $state<CombatDebugMode>('live');
  readonly modeOptions = MODE_OPTIONS;
  readonly scenarios = COMBAT_DEBUG_SCENARIOS;
  scenario = $state<CombatDebugScenarioDefinition>(resolveCombatDebugScenario(undefined));
  status = $state<CombatDebugStatus>('idle');
  controlOwner = $state<CombatDebugControlOwner>('none');
  faultMode = $state<CombatDebugFaultMode>('disabled');
  readonly faultModeOptions = FAULT_OPTIONS;
  seed = $state<number>(resolveCombatDebugScenario(undefined).seed);
  urlError = $state<string | undefined>(undefined);
  urlSnapshot = $state<string>('');

  engineReady = $state(false);
  engineError = $state<string | undefined>(undefined);
  combatViewModel = $state<CombatViewModelInterface | undefined>(undefined);
  state = $state<CombatState | undefined>(undefined);
  revision = $state(0);
  round = $state(0);
  encounterRunId = $state<string | undefined>(undefined);

  traceEntries = $state<readonly CombatDebugTraceEntry[]>([]);
  traceDroppedCount = $state(0);

  activeTab = $state<CombatDebugInspectorTab>('context');
  readonly tabOptions = TAB_OPTIONS;
  assertions = $state<readonly CombatDebugAssertionViolation[]>([]);
  readonly assertionIds = COMBAT_DEBUG_ASSERTIONS;

  fixturePreset = $state<CombatDebugFixturePresetId>('initial');
  readonly fixturePresetOptions = COMBAT_DEBUG_FIXTURE_PRESETS;
  presentationFixture = $state<CombatDebugPresentationFixture>(
    buildCombatDebugPresentationFixture('initial'),
  );
  readonly fixtureNotice = COMBAT_DEBUG_FIXTURE_NOTICE;

  replayResultText = $state<string | undefined>(undefined);
  replayComparison = $state<CombatDebugReplayComparison | undefined>(undefined);
  replayImportText = $state('');

  isPaused = $state(false);
  canStep = $state(false);
  sessionEpoch = $state(0);
  exportText = $state<string | undefined>(undefined);

  battlefieldLayers = $state<DebugSceneOverlayLayers>({ ...DEFAULT_COMBAT_DEBUG_OVERLAY_LAYERS });
  viewportDiagnostics = $state<GameWorldViewportDiagnostics | undefined>(undefined);
  pointerProjection = $state<CombatDebugPointerProjection | undefined>(undefined);
  stateCombatantCount = $state(0);
  projectedActorCount = $state(0);
  selectionProjection = $state<CombatDebugSelectionProjection | undefined>(undefined);

  private _session: CombatDebugSession | undefined;
  private _generation = 0;
  private _urlConfigApplied = false;
  private _controllerRecords: CombatDebugControllerRecord[] = [];
  private readonly _recording = createCombatDebugRecording();
  private _lastActionOptions:
    | import('./inspector/combat_debug_inspector.ts').BuildCombatDebugActionSummaryOptions
    | undefined;

  private readonly _capabilities: CombatDebugViewModelCapabilities;

  constructor(options: CombatDebugViewModelOptions) {
    super(options);
    this._capabilities = options;
  }

  /** Applies the initial URL configuration, then boots the default mode. */
  async initialize(): Promise<void> {
    this._ensureUrlConfigApplied();
    this.presentationFixture = buildCombatDebugPresentationFixture(this.fixturePreset);
    await super.initialize();
  }

  /** Binds the live canvas and boots (or reboots) the live session. */
  async initializeLiveCanvas(canvas: HTMLCanvasElement): Promise<void> {
    // The attachment can run before `initialize()`; apply the URL config first
    // so the boot uses the deep-linked scenario/mode, not the defaults.
    this._ensureUrlConfigApplied();
    if (this.mode !== 'live') {
      return;
    }
    await this._bootLiveSession(canvas);
  }

  /** Boots an attached canvas without making the attachment effect track ViewModel reads. */
  attachLiveCanvas(canvas: HTMLCanvasElement): void {
    untrack(() => {
      void this.initializeLiveCanvas(canvas);
    });
  }

  setMode(mode: CombatDebugMode): void {
    if (mode === this.mode) {
      return;
    }
    this._disposeSession();
    this.mode = mode;
    this.status = 'idle';
    this._resetTrace();
    this._invalidateSession();
    this._syncUrl();
  }

  selectScenario(scenarioId: string): void {
    const next = resolveCombatDebugScenario(scenarioId);
    if (next.id === this.scenario.id) {
      return;
    }
    this._disposeSession();
    this.scenario = next;
    this.seed = next.seed;
    this.faultMode = next.defaultFaultMode;
    this.state = undefined;
    this._resetTrace();
    this._invalidateSession();
    this._syncUrl();
  }

  setSeed(seed: number): void {
    const liveSeedChanged = this.mode === 'live' && seed !== this.seed;
    if (liveSeedChanged) {
      this._disposeSession();
      this._resetTrace();
      this.state = undefined;
    }
    this.seed = seed;
    if (liveSeedChanged) {
      this._invalidateSession();
    }
    this._syncUrl();
  }

  setTab(tab: CombatDebugInspectorTab): void {
    this.activeTab = tab;
    this._syncUrl();
  }

  setFaultMode(mode: CombatDebugFaultMode): void {
    this.faultMode = mode;
    this._syncUrl();
  }

  setFixturePreset(preset: CombatDebugFixturePresetId): void {
    this.fixturePreset = preset;
    this.presentationFixture = buildCombatDebugPresentationFixture(preset);
  }

  /** Flips one synthetic-battlefield overlay layer and repaints the scene. */
  toggleBattlefieldLayer(layer: keyof DebugSceneOverlayLayers): void {
    this.battlefieldLayers = {
      ...this.battlefieldLayers,
      [layer]: !this.battlefieldLayers[layer],
    };
    this._applyDebugScene();
  }

  /** Re-fits the synthetic board into the available pane. */
  fitBattlefieldCamera(): void {
    this._session?.fitDebugCamera();
  }

  /**
   * Discards the current run and boots a fresh isolated session with the same
   * scenario identity and the scenario's declared seed. The boot itself is
   * driven by the view's keyed canvas (see {@link sessionEpoch}) so exactly one
   * session is created against a fresh element.
   *
   * Not implemented here: restoring a recorded engine checkpoint. The engine
   * exposes session-checkpoint commands, but wiring them into a dedicated debug
   * namespace is still open (reported in the workspace guide, not faked).
   */
  async restart(): Promise<void> {
    this._disposeSession();
    this._resetTrace();
    this.seed = this.scenario.seed;
    this.status = 'idle';
    this._invalidateSession();
    this._syncUrl();
  }

  /**
   * Full reset: drop the run identity and every captured projection, then boot
   * a fresh isolated session at the declared scenario start.
   *
   * This is a fresh encounter, NOT a checkpoint restore — see {@link restart}.
   */
  async resetDebug(): Promise<void> {
    this._disposeSession();
    this._resetTrace();
    this.state = undefined;
    this.revision = 0;
    this.round = 0;
    this.encounterRunId = undefined;
    this.assertions = [];
    this.isPaused = false;
    this.canStep = false;
    this.status = 'idle';
    this.seed = this.scenario.seed;
    this._invalidateSession();
    this._syncUrl();
  }

  togglePause(): void {
    this.isPaused = !this.isPaused;
    this._session?.setCommandGateHeld(this.isPaused);
    if (this.isPaused) {
      this.status = 'paused';
      this.canStep = true;
      this._capabilities.announce(
        'Debugger paused — client commands are held at the engine boundary',
      );
      return;
    }
    this.canStep = false;
    this.status = this.engineReady ? 'ready' : 'idle';
    this._capabilities.announce('Debugger resumed — held commands released');
  }

  step(): void {
    if (!this.isPaused) {
      return;
    }
    // The engine has no pause primitive; the debugger holds the client →
    // engine command boundary and a step releases exactly ONE queued command.
    // When nothing is waiting we say so rather than recording a transition
    // that did not happen.
    const released = this._session?.stepCommandGate() ?? false;
    this._appendTrace(
      buildCombatDebugStepTrace({
        revision: this.revision,
        round: this.round,
        actorId: this.contextSummary?.activeCombatantId,
        released,
      }),
    );
    this._capabilities.announce(
      released
        ? 'Stepped one command transition'
        : 'Step requested — no command was waiting at the engine boundary',
    );
  }

  exportReproduction(): string {
    const reproduction = this._buildReproduction();
    if (reproduction === undefined) {
      this.exportText = 'No captured state to export yet — start a live scenario first.';
      return '';
    }
    const text = exportReproductionToJson(reproduction);
    this.exportText = text;
    return text;
  }

  downloadReproductionBundle(): void {
    const reproduction = this._buildReproduction();
    if (reproduction === undefined) {
      this.exportText = 'No captured state to export yet — start a live scenario first.';
      return;
    }
    downloadReproduction({ reproduction });
  }

  importReproduction(text: string): void {
    const parsed = importReproductionFromText(text);
    if (!parsed.ok) {
      this.replayResultText = `Import failed: ${parsed.error}`;
      return;
    }
    const result = replayImportedReproduction(parsed.reproduction);
    const expected = {
      replayVersion: result.replay.replayVersion,
      rulesVersion: result.replay.rulesVersion,
      initialState: result.replay.initialState,
      commands: result.replay.commands,
      events: parsed.reproduction.expectedEvents,
      finalState: result.finalState,
    };
    this.replayComparison = compareReproduction({
      expected,
      actual: result.replay,
      matchedExpected: result.matchedExpected,
    });
    const divergence = this.replayComparison.firstDivergence;
    if (this.replayComparison.matched) {
      this.replayResultText = `Replay matched — ${result.replay.events.length} events, ${parsed.reproduction.commands.length} commands.`;
      return;
    }
    if (divergence === undefined) {
      this.replayResultText = 'Replay diverged (no divergence location reported).';
      return;
    }
    this.replayResultText = describeDivergence(divergence);
  }

  submitReplayImport(): void {
    this.importReproduction(this.replayImportText);
  }

  async copyUrl(): Promise<void> {
    this._syncUrl();
    try {
      await this._capabilities.writeClipboard(this._capabilities.readCurrentUrl());
      this._capabilities.announce('Combat debug URL copied to clipboard');
    } catch (error: unknown) {
      this.warn('copyUrl:failed', { error: String(error) });
      this._capabilities.announce('Unable to copy the combat debug URL');
    }
  }

  // ── Derived inspector projections ──────────────────────────

  get statusLabel(): string {
    return COMBAT_DEBUG_STATUS_LABELS[this.status];
  }

  get traceIncomplete(): boolean {
    return this.traceDroppedCount > 0;
  }

  /** Commands waiting at the debugger's client → engine command boundary. */
  get queuedCommandCount(): number {
    return this._session?.queuedCommandCount ?? 0;
  }

  get contextSummary(): CombatDebugContextSummary | undefined {
    return this.state === undefined ? undefined : buildCombatDebugContext(this.state);
  }

  get actorSummary(): CombatDebugActorSummary | undefined {
    const state = this.state;
    const combatantId = this.contextSummary?.activeCombatantId;
    if (state === undefined || combatantId === undefined) {
      return undefined;
    }
    return buildCombatDebugActorSummary({ state, combatantId });
  }

  get actionSummary():
    | import('./inspector/combat_debug_inspector.ts').CombatDebugActionSummary
    | undefined {
    if (this._lastActionOptions === undefined) {
      return undefined;
    }
    return buildCombatDebugActionSummary(this._lastActionOptions);
  }

  get objectsSummary(): CombatDebugObjectsSummary | undefined {
    return this.state === undefined ? undefined : buildCombatDebugObjectsSummary(this.state);
  }

  get reactionSummary(): CombatDebugReactionSummary | undefined {
    return this.state === undefined ? undefined : buildCombatDebugReactionSummary(this.state);
  }

  get aiSummary(): CombatDebugAiSummary {
    return buildCombatDebugAiSummary(this._controllerRecords);
  }

  get battlefieldDiagnostics(): CombatDebugBattlefieldDiagnostics {
    return buildCombatDebugBattlefieldDiagnostics({
      mode: this.mode,
      status: this.status,
      engineReady: this.engineReady,
      engineError: this.engineError,
      scenario: this.scenario,
      state: this.state,
      viewport: this.viewportDiagnostics,
      pointer: this.pointerProjection,
      layers: this.battlefieldLayers,
      activeCombatantId: this.contextSummary?.activeCombatantId,
      revision: this.revision,
      round: this.round,
      stateCombatants: this.stateCombatantCount,
      projectedActors: this.projectedActorCount,
      selectionCells:
        (this.selectionProjection?.legalEndpoints.length ?? 0) +
        (this.selectionProjection?.legalTargetCells.length ?? 0),
    });
  }

  // ── Internals ──────────────────────────────────────────────

  /** Applies the URL configuration once, whichever lifecycle callback runs first. */
  private _ensureUrlConfigApplied(): void {
    if (this._urlConfigApplied) {
      return;
    }
    this._urlConfigApplied = true;
    this._applyUrlConfig();
  }

  private _applyUrlConfig(): void {
    const parsed = parseCombatDebugUrlConfig(
      new URLSearchParams(this._capabilities.readUrlSearch()),
    );
    this.urlError = parsed.error;
    this.mode = parsed.config.mode;
    this.activeTab = parsed.config.tab;
    this.scenario = resolveCombatDebugScenario(parsed.config.scenarioId);
    this.seed = parsed.config.seed ?? this.scenario.seed;
    this.faultMode = parsed.config.fault;
    this.urlSnapshot = serializeCombatDebugUrlConfig({
      scenarioId: this.scenario.id,
      mode: this.mode,
      tab: this.activeTab,
      seed: this.seed,
      fault: this.faultMode,
    });
  }

  private _syncUrl(): void {
    const query = serializeCombatDebugUrlConfig({
      scenarioId: this.scenario.id,
      mode: this.mode,
      tab: this.activeTab,
      seed: this.seed,
      fault: this.faultMode,
    });
    this.urlSnapshot = query;
    this._capabilities.replaceUrl(query);
  }

  private async _bootLiveSession(canvas: HTMLCanvasElement): Promise<void> {
    this._disposeSession();
    const generation = ++this._generation;
    this.status = 'booting';
    this.engineReady = false;
    this.engineError = undefined;

    const session = this._capabilities.createLiveSession({
      canvas,
      scenario: this.scenario,
      seed: this.seed,
      observer: createCombatDebugSessionObserver(generation, {
        isCurrent: (expected) => expected === this._generation,
        applySnapshot: (snapshot) => this._applySnapshot(snapshot),
        appendTrace: (entry) => this._appendTrace(entry),
        appendCommittedEvents: (events) => this._recording.appendEvents(events),
        recordAcceptedCommand: (record) => this._recording.recordAcceptedCommand(record),
        markReplayHistoryUnavailable: () => this._recording.markHistoryUnavailable(),
        setLastActionOptions: (options) => {
          this._lastActionOptions = options;
        },
        appendControllerRecord: (record) => {
          this._controllerRecords = [...this._controllerRecords, record];
        },
        traceContext: () => ({
          revision: this.revision,
          round: this.round,
          activeCombatantId: this.contextSummary?.activeCombatantId,
          controlOwner: this.controlOwner,
          faultMode: this.faultMode,
        }),
        applySessionStatus: (status) => this._applySessionStatus(status),
        reportError: (message) => {
          this.engineError = message;
          this.status = 'error';
        },
        applySelection: (selection) => {
          this.selectionProjection = selection;
          this._applyDebugScene();
        },
        applyPointer: (pointer) => {
          this.pointerProjection = pointer;
        },
        applyViewport: (diagnostics) => {
          this.viewportDiagnostics = diagnostics;
        },
      }),
    });
    this._session = session;

    await session.boot();
    if (generation !== this._generation) {
      session.dispose();
      return;
    }
    this.engineReady = !session.disposed;
    // Paint the scenario's board immediately (actors arrive with snapshots).
    this._applyDebugScene();
    this.viewportDiagnostics = session.getViewportDiagnostics();

    // Render the PRODUCTION combat UI against the isolated session bridge.
    const bridge = session.bridge;
    if (bridge !== undefined) {
      const combatViewModel = this._capabilities.createProductionCombatViewModel(bridge);
      this.combatViewModel = combatViewModel;
      await combatViewModel.initialize();
      if (generation !== this._generation) {
        await combatViewModel.dispose();
        return;
      }
    }
  }

  private _applySnapshot(snapshot: CombatDebugSessionSnapshot): void {
    const previousRevision = this.revision;
    this._recording.captureInitialState(snapshot.state);
    this.state = snapshot.state;
    this.revision = snapshot.revision;
    this.round = snapshot.round;
    this.encounterRunId = snapshot.state.encounterRunId;
    this.controlOwner = snapshot.activeCombatantId === 'player' ? 'player' : 'npc';

    this.assertions = evaluateCombatDebugAssertions({
      state: snapshot.state,
      previousRevision,
      events: this._recording.events,
      acceptedCommands: this._recording.acceptedCommands,
    });

    this._appendTrace(
      buildCombatDebugSnapshotTrace({
        stateRevision: snapshot.revision,
        round: snapshot.round,
        actorId: snapshot.activeCombatantId,
      }),
    );

    this.stateCombatantCount = countCombatDebugCombatants(snapshot.state);
    this._applyDebugScene();

    if (this.isPaused) {
      this.status = 'paused';
    }
  }

  /**
   * Projects authoritative `CombatState` + scenario battlefield into the
   * engine's debug scene. Authored scenarios render their real map instead.
   * This is presentation only — the engine owns the mechanics.
   */
  private _applyDebugScene(): void {
    const session = this._session;
    if (session === undefined) {
      return;
    }
    if (this.scenario.battlefield.kind !== 'synthetic') {
      session.applyDebugScene(undefined);
      this.projectedActorCount = 0;
      return;
    }
    const spec = buildCombatDebugSceneSpec({
      state: this.state,
      syntheticBattlefield: this.scenario.battlefield,
      layers: this.battlefieldLayers,
      activeCombatantId: this.contextSummary?.activeCombatantId,
      selectedCombatantId: undefined,
      targetedCombatantId: undefined,
      reachableCells: this.selectionProjection?.legalEndpoints ?? [],
      targetCells: this.selectionProjection?.legalTargetCells ?? [],
    });
    if (spec === undefined) {
      return;
    }
    session.applyDebugScene(spec);
    this.projectedActorCount = spec.actors?.length ?? 0;
  }

  private _applySessionStatus(status: string): void {
    if (this.isPaused) {
      return;
    }
    if (status === 'ready') {
      this.status = 'ready';
      this.engineReady = true;
      return;
    }
    if (status === 'ended') {
      this.status = 'ended';
      return;
    }
    if (status === 'error') {
      this.status = 'error';
      return;
    }
    this.status = 'booting';
  }

  private _appendTrace(
    entry: Omit<CombatDebugTraceEntry, 'sequence' | 'recordedAt' | 'payloadTruncated'>,
  ): void {
    // The buffer is plain; copy its snapshot into reactive state after append.
    this._traceBufferInstance.append(entry);
    const snapshot = this._traceBufferInstance.snapshot();
    this.traceEntries = snapshot.entries;
    this.traceDroppedCount = snapshot.droppedCount;
  }

  private readonly _traceBufferInstance = new CombatDebugTraceBuffer();

  private _resetTrace(): void {
    this._traceBufferInstance.clear();
    this.traceEntries = [];
    this.traceDroppedCount = 0;
    this._controllerRecords = [];
    this._lastActionOptions = undefined;
    this._recording.reset();
  }

  private _disposeSession(): void {
    void this.combatViewModel?.dispose();
    this.combatViewModel = undefined;
    this._session?.dispose();
    this._session = undefined;
    this.engineReady = false;
    this.status = 'idle';
    // A disposed session's gate is gone; the debugger must not stay "paused"
    // against a boundary that no longer exists.
    this.isPaused = false;
    this.canStep = false;
    // Drop projections derived from the disposed world so the next session
    // never renders a stale battlefield, pointer cell or renderer health.
    this.selectionProjection = undefined;
    this.pointerProjection = undefined;
    this.viewportDiagnostics = undefined;
    this.stateCombatantCount = 0;
    this.projectedActorCount = 0;
  }

  /**
   * Signals that the live session's identity changed, so the view must
   * re-create the canvas and boot exactly one fresh session against it.
   */
  private _invalidateSession(): void {
    this.sessionEpoch += 1;
  }

  private _buildReproduction(): CombatReproduction | undefined {
    const state = this.state;
    const recording = this._recording.snapshot();
    if (state === undefined || recording === undefined) {
      return undefined;
    }
    return buildCombatDebugReproduction({
      state,
      ...recording,
      scenarioId: this.scenario.id,
      scenarioVersion: this.scenario.version,
      requiresContentPack: this.scenario.requiresContentPack,
      encounterRunId: this.encounterRunId,
      seed: this.seed,
      controllerRecords: this._controllerRecords,
      traceIncomplete: this.traceIncomplete,
      traceDroppedCount: this.traceDroppedCount,
    });
  }

  /** Disposes the session, its production ViewModel and every listener once. */
  override async dispose(): Promise<void> {
    this._generation += 1;
    this._disposeSession();
    await super.dispose();
  }
}

/**
 * Testable factory — no production imports. Tests build this with typed
 * doubles. Production wiring lives in ./combat_debug_composition.ts.
 */
export const createCombatDebugViewModel = (
  options: CombatDebugViewModelOptions,
): CombatDebugViewModelInterface => CombatDebugViewModel.create(options);
