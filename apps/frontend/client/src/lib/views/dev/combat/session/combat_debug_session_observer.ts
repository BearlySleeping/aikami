// apps/frontend/client/src/lib/views/dev/combat/session/combat_debug_session_observer.ts
//
// Translates the live session's raw callbacks into the workspace's reactive
// projections: trace rows, action-summary inputs, AI controller records and
// status. Extracted from the ViewModel so the ViewModel keeps to mode/action
// orchestration and stays inside the source-file budget.
//
// The host owns all reactive state; this module is pure wiring. Every callback
// is guarded by the owning session's generation so a superseded session (a
// scenario switch or a navigation-away) can never write into the workspace.
//
// Contract: combat debug workspace (execution prompt §2, §7, §8)

import type { CombatEvent } from '@aikami/types';
import {
  buildCombatDebugAcceptedTrace,
  buildCombatDebugEventTrace,
  buildCombatDebugRejectedTrace,
  buildCombatDebugRequestedTrace,
} from '../combat_debug_projection.ts';
import type { BuildCombatDebugActionSummaryOptions } from '../inspector/combat_debug_inspector.ts';
import type { CombatDebugTraceAppend } from '../trace/combat_debug_trace.ts';
import type {
  CombatDebugAcceptedCommandRecord,
  CombatDebugControllerRecord,
  CombatDebugControlOwner,
  CombatDebugFaultMode,
} from '../types/combat_debug_types.ts';
import type {
  CombatDebugSessionObserver,
  CombatDebugSessionSnapshot,
} from './combat_debug_session_contract.ts';

/** Trace-relevant facts read from the host at callback time. */
export type CombatDebugObserverTraceContext = {
  readonly revision: number;
  readonly round: number;
  readonly activeCombatantId: string | undefined;
  readonly controlOwner: CombatDebugControlOwner;
  readonly faultMode: CombatDebugFaultMode;
};

/**
 * The workspace state a session observer writes through. Implemented by the
 * ViewModel; kept narrow so the observer cannot reach into unrelated state.
 */
export type CombatDebugObserverHost = {
  /** False once the session that raised this callback has been superseded. */
  isCurrent(generation: number): boolean;
  /** Replaces the authoritative snapshot and re-derives assertions. */
  applySnapshot(snapshot: CombatDebugSessionSnapshot): void;
  /** Appends one trace row through the bounded buffer. */
  appendTrace(entry: CombatDebugTraceAppend): void;
  /** Retains committed events for temporal assertions and reproduction export. */
  appendCommittedEvents(events: readonly CombatEvent[]): void;
  /** Retains one accepted command with its request-time replay projection. */
  recordAcceptedCommand(record: CombatDebugAcceptedCommandRecord): void;
  /** Marks the run incomplete when an accepted request cannot be reconstructed. */
  markReplayHistoryUnavailable(): void;
  /** Records the inputs for the action inspector's latest projection. */
  setLastActionOptions(options: BuildCombatDebugActionSummaryOptions | undefined): void;
  /** Appends one AI/controller decision record. */
  appendControllerRecord(record: CombatDebugControllerRecord): void;
  /** Reads the trace-relevant facts (revision, round, actor, owner, faults). */
  traceContext(): CombatDebugObserverTraceContext;
  /** Maps a session lifecycle status onto the workspace status. */
  applySessionStatus(status: string): void;
  /** Reports a session error; the host sets its error state. */
  reportError(message: string): void;
};

/**
 * Builds the observer for one live session. `generation` is the session's own
 * generation counter: a callback from a stale session is dropped.
 */
export const createCombatDebugSessionObserver = (
  generation: number,
  host: CombatDebugObserverHost,
): CombatDebugSessionObserver => {
  const current = (): boolean => host.isCurrent(generation);
  const requestedCommands = new Map<
    string,
    { commandType: string; replayCommand: CombatDebugAcceptedCommandRecord['replayCommand'] }
  >();

  return {
    onSnapshot: (snapshot) => {
      if (!current()) {
        return;
      }
      host.applySnapshot(snapshot);
    },

    onEvents: (events) => {
      if (!current()) {
        return;
      }
      host.appendCommittedEvents(events);
      for (const event of events) {
        const context = host.traceContext();
        host.appendTrace(
          buildCombatDebugEventTrace({
            eventKind: event.kind,
            stateRevision: event.stateRevision,
            round: context.round,
          }),
        );
      }
    },

    onCommandAccepted: (accepted) => {
      if (!current()) {
        return;
      }
      const requested = requestedCommands.get(accepted.commandId);
      requestedCommands.delete(accepted.commandId);
      if (requested === undefined || requested.replayCommand === undefined) {
        host.markReplayHistoryUnavailable();
      }
      host.recordAcceptedCommand({
        commandId: accepted.commandId,
        commandType: requested?.commandType,
        stateRevision: accepted.stateRevision,
        duplicate: accepted.duplicate,
        replayCommand: requested?.replayCommand,
      });
      host.setLastActionOptions({
        commandId: accepted.commandId,
        acknowledgement: 'accepted',
        resultingRevision: accepted.stateRevision,
        warnings: accepted.duplicate ? ['Engine re-acknowledged a duplicate command id.'] : [],
      });
      const context = host.traceContext();
      host.appendTrace(
        buildCombatDebugAcceptedTrace({
          commandId: accepted.commandId,
          stateRevision: accepted.stateRevision,
          duplicate: accepted.duplicate,
          round: context.round,
          actorId: context.activeCombatantId,
        }),
      );
    },

    onCommandRejected: (rejected) => {
      if (!current()) {
        return;
      }
      host.setLastActionOptions({
        acknowledgement: 'rejected',
        rejectionCode: rejected.reasonCode,
        groundedKind: rejected.commandType,
        warnings: rejected.detail === undefined ? [] : [rejected.detail],
      });
      const context = host.traceContext();
      host.appendControllerRecord({
        commandId: undefined,
        controlOwner: context.controlOwner,
        failureCode: rejected.reasonCode,
        providerUsed: context.faultMode === 'real',
        rationale: undefined,
      });
      host.appendTrace(
        buildCombatDebugRejectedTrace({
          commandType: rejected.commandType,
          messageKey: rejected.messageKey,
          detail: rejected.detail,
          revision: context.revision,
          round: context.round,
          actorId: context.activeCombatantId,
        }),
      );
    },

    onCommandRequested: (requested) => {
      if (!current()) {
        return;
      }
      if (requested.commandId === undefined) {
        host.markReplayHistoryUnavailable();
      } else {
        requestedCommands.set(requested.commandId, {
          commandType: requested.commandType,
          replayCommand: requested.replayCommand,
        });
      }
      host.setLastActionOptions({
        ...(requested.commandId === undefined ? {} : { commandId: requested.commandId }),
        ...(requested.basedOnRevision === undefined ? {} : { revision: requested.basedOnRevision }),
        groundedKind: requested.commandType,
      });
      const context = host.traceContext();
      host.appendTrace(
        buildCombatDebugRequestedTrace({
          commandType: requested.commandType,
          commandId: requested.commandId,
          basedOnRevision: requested.basedOnRevision,
          fallbackRevision: context.revision,
          round: context.round,
          actorId: context.activeCombatantId,
        }),
      );
    },

    onStatus: (status) => {
      if (!current()) {
        return;
      }
      host.applySessionStatus(status);
    },

    onError: (message) => {
      if (!current()) {
        return;
      }
      host.reportError(message);
    },
  };
};
