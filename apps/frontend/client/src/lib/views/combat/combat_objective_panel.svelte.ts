// apps/frontend/client/src/lib/views/combat/combat_objective_panel.svelte.ts
//
// Objective panel flow (Combat-08 AC-1).
//
// Owns the objective rows the sidebar renders. It answers from the ENGINE's own
// snapshot — never from a locally re-derived status — so the panel and the
// kernel cannot disagree about whether a ritual was stopped.
//
// Refresh is event-driven, not polled:
//   - a committed command (`COMBAT_EVENTS_RESOLVED`) asks for one snapshot, and
//   - an arriving snapshot is projected through the pure module.
//
// The projection itself (hidden objectives omitted, no invented objectives) is
// `utils/objective_panel.ts`; this class only owns the request/response cycle.
//
// Contract: C-532 AC-1

import type { EngineBridge } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { CombatState } from '@aikami/types';
import { type ObjectivePanelEntry, projectObjectivePanel } from './utils/objective_panel.ts';

/** Bounded wait for the engine's answer; a late reply is ignored, never shown. */
const DEFAULT_SNAPSHOT_DEADLINE_MS = 2500;

export type CombatObjectivePanelDeps = {
  bridge(): Pick<EngineBridge, 'send' | 'on'> | undefined;
  readEncounterId(): string;
  /** Authored display label per objective id, when the pack authored one. */
  labelsForObjective?(): Record<string, string>;
  debug?(event: string, data?: Record<string, unknown>): void;
  /** Mirrors changes into the owning combat ViewModel's compatibility surface. */
  onStateChanged?(): void;
};

/** Fully projected row consumed by the logicless objective-panel view. */
export type ObjectivePanelViewEntry = ObjectivePanelEntry & {
  statusClass: string;
  statusIcon: string;
  showProgress: boolean;
  deadlineLabel: string | null;
};

/** View-facing objective-panel state and refresh operation. */
export type CombatObjectivePanelViewModelInterface = BaseViewModelInterface & {
  readonly objectives: ObjectivePanelViewEntry[];
  readonly hasAuthoredObjectives: boolean;
  attach(): () => void;
  requestRefresh(): void;
};

/** Dependencies and lifecycle metadata for the objective-panel ViewModel. */
export type CombatObjectivePanelViewModelOptions = BaseViewModelOptions &
  CombatObjectivePanelDeps & {
    snapshotDeadlineMs?: number;
  };

type PendingRequest = {
  requestId: string;
  timer: ReturnType<typeof setTimeout>;
};

export class CombatObjectivePanel
  extends BaseViewModel<CombatObjectivePanelViewModelOptions>
  implements CombatObjectivePanelViewModelInterface
{
  /**
   * The visible objective rows, in stable id order.
   */
  objectives: ObjectivePanelViewEntry[] = $state([]);

  /** True once the encounter has a snapshot with authored objectives. */
  hasAuthoredObjectives = $state(false);

  private readonly _deps: CombatObjectivePanelDeps;
  private readonly _deadlineMs: number;
  private _pending: PendingRequest | undefined;
  private _counter = 0;
  /** A refresh requested while one was already in flight. */
  private _refreshQueued = false;

  constructor(options: CombatObjectivePanelViewModelOptions) {
    super(options);
    this._deps = options;
    this._deadlineMs = options.snapshotDeadlineMs ?? DEFAULT_SNAPSHOT_DEADLINE_MS;
  }

  /** Registers the bridge listeners this flow needs; returns a cleanup. */
  attach(): () => void {
    const bridge = this._deps.bridge();
    if (bridge === undefined) {
      return () => {};
    }
    const removeResolved = bridge.on('COMBAT_EVENTS_RESOLVED', () => {
      this.requestRefresh();
    });
    const removeSnapshot = bridge.on('COMBAT_STATE_SNAPSHOT', (event) => {
      this._acceptSnapshot(event.requestId, event.state);
    });
    const removeRejected = bridge.on('COMBAT_STATE_SNAPSHOT_REJECTED', (event) => {
      this._acceptSnapshot(event.requestId, undefined);
    });
    const removeEnded = bridge.on('COMBAT_ENDED', () => {
      // The panel is a live-encounter surface: a finished fight's objectives
      // must not linger behind the result banner.
      this.objectives = [];
      this.hasAuthoredObjectives = false;
      this._cancelPending();
      this._deps.onStateChanged?.();
    });
    return () => {
      removeResolved();
      removeSnapshot();
      removeRejected();
      removeEnded();
      this._cancelPending();
    };
  }

  /** Asks the engine for one snapshot; concurrent refreshes are coalesced. */
  requestRefresh(): void {
    const bridge = this._deps.bridge();
    const encounterId = this._deps.readEncounterId();
    if (bridge === undefined || encounterId === '') {
      return;
    }
    // Coalesce: a refresh that arrives while one is already in flight is
    // serviced when the outstanding answer lands. Cancelling the in-flight
    // request on every event (turn change AND committed batch) starved the
    // panel — each answer arrived for a request that had already been dropped.
    if (this._pending !== undefined) {
      this._refreshQueued = true;
      return;
    }
    this._send(encounterId);
  }

  /** Issues one snapshot request and arms its bounded deadline. */
  private _send(encounterId: string): void {
    const bridge = this._deps.bridge();
    if (bridge === undefined) {
      return;
    }
    this._counter += 1;
    const requestId = `objectives:${encounterId}:${this._counter}`;
    this._pending = {
      requestId,
      timer: setTimeout(() => {
        this._pending = undefined;
      }, this._deadlineMs),
    };
    bridge.send({
      type: 'COMBAT_STATE_SNAPSHOT_REQUESTED',
      requestId,
      encounterId,
    });
  }

  /** Projects a snapshot into the visible rows. */
  private _acceptSnapshot(requestId: string, state: CombatState | undefined): void {
    const pending = this._pending;
    // A late or superseded reply is dropped: the panel only ever shows the
    // answer to the request it is currently waiting for.
    if (pending === undefined || pending.requestId !== requestId) {
      return;
    }
    clearTimeout(pending.timer);
    this._pending = undefined;
    if (state !== undefined) {
      const labels = this._deps.labelsForObjective?.() ?? {};
      this.objectives = projectObjectivePanel({ state, labels }).map((entry) => ({
        ...entry,
        statusClass: this._statusClass(entry.status),
        statusIcon: this._statusIcon(entry.status),
        showProgress: entry.target !== null && entry.target > 1,
        deadlineLabel:
          entry.deadlineRound === null
            ? null
            : `${entry.status === 'pending' ? 'Deadline' : 'Deadline was'}: round ${entry.deadlineRound}`,
      }));
      this.hasAuthoredObjectives = this.objectives.length > 0;
      this._deps.debug?.('objectivesProjected', {
        count: this.objectives.length,
        statuses: this.objectives.map((entry) => `${entry.objectiveId}:${entry.status}`),
      });
      this._deps.onStateChanged?.();
    }
    if (this._refreshQueued) {
      this._refreshQueued = false;
      const encounterId = this._deps.readEncounterId();
      if (encounterId !== '') {
        this._send(encounterId);
      }
    }
  }

  private _statusClass(status: ObjectivePanelEntry['status']): string {
    if (status === 'complete') {
      return 'text-success';
    }
    if (status === 'failed') {
      return 'text-error';
    }
    return 'text-base-content';
  }

  private _statusIcon(status: ObjectivePanelEntry['status']): string {
    if (status === 'complete') {
      return '✓';
    }
    if (status === 'failed') {
      return '✕';
    }
    return '•';
  }

  private _cancelPending(): void {
    if (this._pending !== undefined) {
      clearTimeout(this._pending.timer);
      this._pending = undefined;
    }
    this._refreshQueued = false;
  }
}

/** Creates the objective-panel ViewModel through the instrumented class factory. */
export const getCombatObjectivePanelViewModel = (
  options: CombatObjectivePanelViewModelOptions,
): CombatObjectivePanelViewModelInterface => CombatObjectivePanel.create(options);
