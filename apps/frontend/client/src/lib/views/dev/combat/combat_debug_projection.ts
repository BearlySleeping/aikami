// apps/frontend/client/src/lib/views/dev/combat/combat_debug_projection.ts
//
// Pure builders the workspace ViewModel delegates to. Kept separate so the
// ViewModel stays under the source-file budget and so each projection is
// directly unit-testable without a live session. Everything here is a pure
// function of its inputs — no state, no DOM, no services.
//
// Contract: combat debug workspace (execution prompt §4, §7, §8)

import type { CombatReproduction, CombatState } from '@aikami/types';
import type { CombatDebugTraceAppend } from './trace/combat_debug_trace.ts';
import type { CombatDebugControllerRecord, CombatDebugStatus } from './types/combat_debug_types.ts';

/** Human labels for statuses — status must never depend on color alone. */
export const COMBAT_DEBUG_STATUS_LABELS: Record<CombatDebugStatus, string> = {
  idle: 'Idle',
  booting: 'Booting engine…',
  ready: 'Ready',
  'waiting-companion': 'Waiting for companion approval',
  'waiting-reaction': 'Waiting for your reaction',
  'provider-pending': 'Provider pending',
  paused: 'Paused by debugger',
  settling: 'Settling',
  ended: 'Ended',
  error: 'Error',
};

/** Inputs for {@link buildCombatDebugReproduction}. */
export type BuildCombatDebugReproductionOptions = {
  readonly state: CombatState;
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly requiresContentPack: boolean;
  readonly encounterRunId: string | undefined;
  readonly seed: number;
  readonly controllerRecords: readonly CombatDebugControllerRecord[];
  readonly traceIncomplete: boolean;
  readonly traceDroppedCount: number;
};

/**
 * Builds the portable reproduction bundle for the current run. `complete` is
 * false whenever the bounded trace dropped entries, so a truncated trace can
 * never produce a bundle that looks replayable.
 */
export const buildCombatDebugReproduction = (
  options: BuildCombatDebugReproductionOptions,
): CombatReproduction => ({
  reproductionVersion: 1,
  rulesVersion: options.state.rulesVersion,
  scenarioId: options.scenarioId,
  scenarioVersion: options.scenarioVersion,
  ...(options.requiresContentPack ? { contentPackId: 'emberwatch' } : {}),
  encounterRunId: options.encounterRunId ?? 'debug-run',
  seed: String(options.seed),
  recordedInitialState: options.state,
  commands: [],
  checkpoints: [],
  expectedEvents: [],
  controllerRecords: options.controllerRecords.map((record) => ({
    ...(record.commandId === undefined ? {} : { commandId: record.commandId }),
    controlOwner: record.controlOwner,
    ...(record.failureCode === undefined ? {} : { failureCode: record.failureCode }),
    providerUsed: record.providerUsed,
    ...(record.rationale === undefined ? {} : { rationale: record.rationale }),
  })),
  complete: !options.traceIncomplete,
  droppedTraceEntries: options.traceDroppedCount,
});

/** Builds the trace row for an accepted command acknowledgement. */
export const buildCombatDebugAcceptedTrace = (options: {
  readonly commandId: string;
  readonly stateRevision: number;
  readonly duplicate: boolean;
  readonly round: number;
  readonly actorId: string | undefined;
}): CombatDebugTraceAppend => ({
  kind: 'accepted',
  revision: options.stateRevision,
  turnLabel: `R${options.round}`,
  actorId: options.actorId,
  commandId: options.commandId,
  summary: options.duplicate
    ? `Duplicate command ${options.commandId} re-acknowledged`
    : `Command ${options.commandId} accepted`,
  payload: undefined,
});

/** Builds the trace row for a refused command. */
export const buildCombatDebugRejectedTrace = (options: {
  readonly commandType: string;
  readonly messageKey: string;
  readonly detail: string | undefined;
  readonly revision: number;
  readonly round: number;
  readonly actorId: string | undefined;
}): CombatDebugTraceAppend => ({
  kind: 'rejected',
  revision: options.revision,
  turnLabel: `R${options.round}`,
  actorId: options.actorId,
  commandId: undefined,
  summary: `${options.commandType} rejected — ${options.messageKey}${options.detail === undefined ? '' : ` (${options.detail})`}`,
  payload: undefined,
});

/** Builds the trace row for an outgoing controller request. */
export const buildCombatDebugRequestedTrace = (options: {
  readonly commandType: string;
  readonly commandId: string | undefined;
  readonly basedOnRevision: number | undefined;
  readonly fallbackRevision: number;
  readonly round: number;
  readonly actorId: string | undefined;
}): CombatDebugTraceAppend => ({
  kind: 'request',
  revision: options.basedOnRevision ?? options.fallbackRevision,
  turnLabel: `R${options.round}`,
  actorId: options.actorId,
  commandId: options.commandId,
  summary: `Requested ${options.commandType}`,
  payload: undefined,
});

/** Builds the trace row for one committed mechanical event. */
export const buildCombatDebugEventTrace = (options: {
  readonly eventKind: string;
  readonly stateRevision: number;
  readonly round: number;
}): CombatDebugTraceAppend => ({
  kind: 'event',
  revision: options.stateRevision,
  turnLabel: `R${options.round}`,
  actorId: undefined,
  commandId: undefined,
  summary: options.eventKind,
  payload: undefined,
});

/** Builds the trace row for a captured authoritative snapshot. */
export const buildCombatDebugSnapshotTrace = (options: {
  readonly stateRevision: number;
  readonly round: number;
  readonly actorId: string | undefined;
}): CombatDebugTraceAppend => ({
  kind: 'state',
  revision: options.stateRevision,
  turnLabel: `R${options.round}`,
  actorId: options.actorId,
  commandId: undefined,
  summary: `Snapshot revision ${options.stateRevision}`,
  payload: undefined,
});

/** Builds the trace row for a debugger step at the command boundary. */
export const buildCombatDebugStepTrace = (options: {
  readonly revision: number;
  readonly round: number;
  readonly actorId: string | undefined;
  /** False when nothing was queued, so the row never claims a transition. */
  readonly released: boolean;
}): CombatDebugTraceAppend => ({
  kind: 'request',
  revision: options.revision,
  turnLabel: `R${options.round}`,
  actorId: options.actorId,
  commandId: undefined,
  summary: options.released
    ? 'Debugger step — released one queued command at the engine boundary'
    : 'Debugger step — nothing queued at the engine boundary',
  payload: undefined,
});
