// apps/frontend/client/src/lib/views/dev/combat/types/combat_debug_types.ts
//
// Local (layout + workspace) types for the consolidated combat debug workspace.
// Domain types that cross a package boundary live in `@aikami/types`; these are
// dev-tool presentation and orchestration shapes only.
//
// Contract: combat debug workspace (execution prompt §2, §3, §5)

import type { CombatReproduction } from '@aikami/types';

/** The three workspace modes. One ViewModel, one route, three explicit modes. */
export const COMBAT_DEBUG_MODES = ['live', 'replay', 'fixtures'] as const;

export type CombatDebugMode = (typeof COMBAT_DEBUG_MODES)[number];

/** Inspector tabs. Expensive inspectors mount lazily per active tab. */
export const COMBAT_DEBUG_INSPECTOR_TABS = [
  'context',
  'actor',
  'action',
  'objects',
  'reactions',
  'ai',
] as const;

export type CombatDebugInspectorTab = (typeof COMBAT_DEBUG_INSPECTOR_TABS)[number];

/**
 * Lifecycle status shown in the toolbar. Distinct states so the UI never shows
 * one indefinite spinner for "waiting for approval", "provider pending" and
 * "settling".
 */
export const COMBAT_DEBUG_STATUSES = [
  'idle',
  'booting',
  'ready',
  'waiting-companion',
  'waiting-reaction',
  'provider-pending',
  'paused',
  'settling',
  'ended',
  'error',
] as const;

export type CombatDebugStatus = (typeof COMBAT_DEBUG_STATUSES)[number];

/** How the current run is being driven. */
export const COMBAT_DEBUG_CONTROL_OWNERS = [
  'player',
  'companion',
  'npc',
  'ai',
  'debugger',
  'none',
] as const;

export type CombatDebugControlOwner = (typeof COMBAT_DEBUG_CONTROL_OWNERS)[number];

/** A named checkpoint a scenario declares it must reach. */
export type CombatDebugExpectedCheckpoint = {
  readonly name: string;
  readonly description: string;
};

/**
 * Deterministic provider fault mode for the injected gateway adapter. These
 * exercise real controller fallback/cancellation; they never commit a
 * substitute outcome directly.
 */
export const COMBAT_DEBUG_FAULT_MODES = [
  'disabled',
  'structured-success',
  'unavailable',
  'timeout',
  'malformed',
  'delayed-stale',
  'real',
] as const;

export type CombatDebugFaultMode = (typeof COMBAT_DEBUG_FAULT_MODES)[number];

/** Declarative controller policy for a scenario. */
export type CombatDebugControllerPolicies = {
  /** Player actor control: direct input. */
  readonly player: 'direct';
  /** Companion control mode the scenario starts in. */
  readonly companion: 'direct' | 'suggest' | 'auto' | null;
  /** Enemies are always engine-policy driven; never a debug shortcut. */
  readonly enemies: 'engine-policy';
};

/** Kind of battlefield the scenario needs. */
export type CombatDebugBattlefieldSource =
  | { readonly kind: 'authored'; readonly mapId: string; readonly encounterId: string }
  | {
      readonly kind: 'synthetic';
      readonly width: number;
      readonly height: number;
      readonly blockedCells: ReadonlyArray<{ readonly x: number; readonly y: number }>;
    };

/**
 * A versioned, typed, deterministic scenario definition. Bounded declarative
 * data only — no executable content or expressions.
 */
export type CombatDebugScenarioDefinition = {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly purpose: string;
  /** What the scenario is intended to prove; shown in the UI. */
  readonly proves: string;
  readonly seed: number;
  readonly defaultEngine: 'v2';
  /** Requires the real Emberwatch content pack (vs. a synthetic fixture). */
  readonly requiresContentPack: boolean;
  /** Always true for the tiny synthetic scenarios, false for authored content. */
  readonly synthetic: boolean;
  readonly battlefield: CombatDebugBattlefieldSource;
  readonly controllerPolicies: CombatDebugControllerPolicies;
  readonly expectedCheckpoints: ReadonlyArray<CombatDebugExpectedCheckpoint>;
  /** Fault mode the scenario starts with. */
  readonly defaultFaultMode: CombatDebugFaultMode;
};

/** Serialized URL configuration — small, validated, never carries secrets. */
export type CombatDebugUrlConfig = {
  readonly scenarioId: string;
  readonly mode: CombatDebugMode;
  readonly tab: CombatDebugInspectorTab;
  readonly seed: number | undefined;
};

/** Result of parsing a URL config; invalid params fall back safely. */
export type CombatDebugUrlConfigResult = {
  readonly config: CombatDebugUrlConfig;
  readonly error: string | undefined;
};

/** Diagnostic-only controller/decision record kept in the trace. */
export type CombatDebugControllerRecord = {
  readonly commandId: string | undefined;
  readonly controlOwner: CombatDebugControlOwner;
  readonly failureCode: string | undefined;
  readonly providerUsed: boolean;
  readonly rationale: string | undefined;
};

/** Development assertion identifiers surfaced when a violation is detected. */
export const COMBAT_DEBUG_ASSERTIONS = [
  'ownership',
  'monotonic-revision',
  'budget-bounds',
  'snapshot-purity',
  'projection-agreement',
  'single-settlement',
  'no-ordinary-command-during-reaction',
] as const;

export type CombatDebugAssertionId = (typeof COMBAT_DEBUG_ASSERTIONS)[number];

/** A detected assertion violation — surfaced, never auto-repaired. */
export type CombatDebugAssertionViolation = {
  readonly assertion: CombatDebugAssertionId;
  readonly detail: string;
  readonly revision: number | undefined;
  readonly commandId: string | undefined;
};

/** The trace export envelope, so a bounded trace never fakes completeness. */
export type CombatDebugTraceExport = {
  readonly reproduction: CombatReproduction;
  readonly droppedTraceEntries: number;
  readonly incomplete: boolean;
};
