// apps/frontend/client/src/lib/views/dev/combat/types/combat_debug_view_model_types.ts
//
// The combat debug workspace ViewModel's contract: injected capabilities, the
// public interface the view renders against, and its options. Extracted from
// `combat_debug_view_model.svelte.ts` so that module stays focused on
// orchestration rather than carrying its whole type surface inline.
//
// Type-only: this module has no runtime behavior beyond the constants it reads
// for `typeof`, so importing it never pulls the engine or services.
//
// Contract: combat debug workspace (execution prompt §1–§8, §16–§18)

import type {
  DebugSceneOverlayLayers,
  EngineBridge,
  GameWorldViewportDiagnostics,
} from '@aikami/frontend/engine';
import type { BaseViewModelInterface, BaseViewModelOptions } from '@aikami/frontend/services/base';
import type { CombatState } from '@aikami/types';
import type { CombatViewModelInterface } from '$views/combat/combat_view_model.svelte';
import type { CombatDebugBattlefieldDiagnostics } from '../battlefield/combat_debug_battlefield_diagnostics.ts';
import type {
  CombatDebugFixturePresetId,
  CombatDebugPresentationFixture,
} from '../fixtures/combat_debug_fixtures.ts';
import type {
  CombatDebugActionSummary,
  CombatDebugActorSummary,
  CombatDebugAiSummary,
  CombatDebugContextSummary,
  CombatDebugObjectsSummary,
  CombatDebugReactionSummary,
} from '../inspector/combat_debug_inspector.ts';
import type { CombatDebugReplayComparison } from '../replay/combat_debug_replay.ts';
import type {
  CombatDebugPointerProjection,
  CombatDebugSession,
  CombatDebugSessionObserver,
} from '../session/combat_debug_session_contract.ts';
import type { CombatDebugTraceEntry } from '../trace/combat_debug_trace.ts';
import type {
  COMBAT_DEBUG_ASSERTIONS,
  CombatDebugAssertionViolation,
  CombatDebugControlOwner,
  CombatDebugFaultMode,
  CombatDebugInspectorTab,
  CombatDebugMode,
  CombatDebugScenarioDefinition,
  CombatDebugStatus,
} from './combat_debug_types.ts';

/** The runtime capabilities the workspace needs, supplied by composition. */
export type CombatDebugViewModelCapabilities = {
  /** Reads window.location.search (browser) — injected for testability. */
  readUrlSearch(): string;
  /** Writes a query string to history without a reload. */
  replaceUrl(query: string): void;
  /** Reads the complete current URL after synchronization. */
  readCurrentUrl(): string;
  /** Writes text through the platform clipboard capability. */
  writeClipboard(text: string): Promise<void>;
  /** Builds a live session; the composition supplies the heavy dependencies. */
  createLiveSession(options: {
    canvas: HTMLCanvasElement;
    scenario: CombatDebugScenarioDefinition;
    seed: number;
    observer: CombatDebugSessionObserver;
  }): CombatDebugSession;
  /**
   * Builds the PRODUCTION combat ViewModel for the debug session's bridge. The
   * composition supplies it so the workspace renders the real combat UI rather
   * than reimplementing it, and this module never imports the combat feature.
   */
  createProductionCombatViewModel(bridge: EngineBridge): CombatViewModelInterface;
  /** Notifies the UI that a live session status changed (announcements). */
  announce(message: string): void;
};

/** The workspace ViewModel contract. */
export type CombatDebugViewModelInterface = BaseViewModelInterface & {
  // Mode + scenario
  readonly mode: CombatDebugMode;
  readonly modeOptions: readonly CombatDebugMode[];
  readonly scenarios: readonly CombatDebugScenarioDefinition[];
  readonly scenario: CombatDebugScenarioDefinition;
  readonly status: CombatDebugStatus;
  readonly statusLabel: string;
  readonly controlOwner: CombatDebugControlOwner;
  readonly faultMode: CombatDebugFaultMode;
  readonly faultModeOptions: readonly CombatDebugFaultMode[];
  readonly seed: number;
  readonly urlError: string | undefined;
  readonly urlSnapshot: string;
  // Live/session state
  readonly engineReady: boolean;
  readonly engineError: string | undefined;
  readonly combatViewModel: CombatViewModelInterface | undefined;
  readonly state: CombatState | undefined;
  readonly revision: number;
  readonly round: number;
  readonly encounterRunId: string | undefined;
  // Trace
  readonly traceEntries: readonly CombatDebugTraceEntry[];
  readonly traceDroppedCount: number;
  readonly traceIncomplete: boolean;
  // Inspectors
  readonly activeTab: CombatDebugInspectorTab;
  readonly tabOptions: readonly CombatDebugInspectorTab[];
  readonly contextSummary: CombatDebugContextSummary | undefined;
  readonly actorSummary: CombatDebugActorSummary | undefined;
  readonly actionSummary: CombatDebugActionSummary | undefined;
  readonly objectsSummary: CombatDebugObjectsSummary | undefined;
  readonly reactionSummary: CombatDebugReactionSummary | undefined;
  readonly aiSummary: CombatDebugAiSummary;
  readonly assertions: readonly CombatDebugAssertionViolation[];
  readonly assertionIds: typeof COMBAT_DEBUG_ASSERTIONS;
  // Fixtures
  readonly fixturePreset: CombatDebugFixturePresetId;
  readonly fixturePresetOptions: readonly CombatDebugFixturePresetId[];
  readonly presentationFixture: CombatDebugPresentationFixture;
  readonly fixtureNotice: string;
  // Replay
  readonly replayResultText: string | undefined;
  readonly replayComparison: CombatDebugReplayComparison | undefined;
  replayImportText: string;
  // Scheduler controls
  readonly isPaused: boolean;
  readonly canStep: boolean;
  /** Commands held at the client → engine boundary; 0 when the gate is open. */
  readonly queuedCommandCount: number;
  /**
   * Bumped whenever the live session's identity changes (scenario switch,
   * mode switch, restart, reset). The view keys the canvas on it so the
   * session is re-booted exactly once against a fresh element instead of
   * leaving a disposed world behind a dead canvas.
   */
  readonly sessionEpoch: number;
  // Battlefield / diagnostics
  readonly battlefieldLayers: DebugSceneOverlayLayers;
  readonly viewportDiagnostics: GameWorldViewportDiagnostics | undefined;
  readonly pointerProjection: CombatDebugPointerProjection | undefined;
  readonly stateCombatantCount: number;
  readonly projectedActorCount: number;
  /** Preformatted header strings, overlay toggles and renderer health rows. */
  readonly battlefieldDiagnostics: CombatDebugBattlefieldDiagnostics;
  // Actions
  initialize(): Promise<void>;
  initializeLiveCanvas(canvas: HTMLCanvasElement): Promise<void>;
  setMode(mode: CombatDebugMode): void;
  selectScenario(scenarioId: string): void;
  setSeed(seed: number): void;
  setTab(tab: CombatDebugInspectorTab): void;
  setFaultMode(mode: CombatDebugFaultMode): void;
  setFixturePreset(preset: CombatDebugFixturePresetId): void;
  restart(): Promise<void>;
  resetDebug(): Promise<void>;
  step(): void;
  togglePause(): void;
  toggleBattlefieldLayer(layer: keyof DebugSceneOverlayLayers): void;
  fitBattlefieldCamera(): void;
  exportReproduction(): string;
  downloadReproductionBundle(): void;
  importReproduction(text: string): void;
  submitReplayImport(): void;
  copyUrl(): Promise<void>;
  readonly exportText: string | undefined;
};

/** Public options accepted by route callers; capabilities are wired by composition. */
export type CombatDebugViewModelPublicOptions = BaseViewModelOptions;

/** Full options including injected capabilities. */
export type CombatDebugViewModelOptions = BaseViewModelOptions & CombatDebugViewModelCapabilities;
