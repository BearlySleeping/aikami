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
// Plain state, not runes: the ViewModel mirrors it into render runes, exactly
// like `CombatObjectInspector`. That keeps this controller unit-testable
// without the Svelte compiler.
//
// Contract: C-532 AC-1

import type { EngineBridge } from '@aikami/frontend/engine';
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
};

type PendingRequest = {
  requestId: string;
  timer: ReturnType<typeof setTimeout>;
};

export class CombatObjectivePanel {
  /**
   * The visible objective rows, in stable id order.
   *
   * Plain state, exactly like `CombatObjectInspector`: the ViewModel mirrors it
   * into render runes (`_syncObjectivePanel`), so this class stays testable
   * without the Svelte compiler.
   */
  objectives: ObjectivePanelEntry[] = [];

  /** True once the encounter has a snapshot with authored objectives. */
  hasAuthoredObjectives = false;

  private readonly _deps: CombatObjectivePanelDeps;
  private readonly _deadlineMs: number;
  private _pending: PendingRequest | undefined;
  private _counter = 0;

  constructor(deps: CombatObjectivePanelDeps, deadlineMs = DEFAULT_SNAPSHOT_DEADLINE_MS) {
    this._deps = deps;
    this._deadlineMs = deadlineMs;
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
    });
    return () => {
      removeResolved();
      removeSnapshot();
      removeRejected();
      removeEnded();
      this._cancelPending();
    };
  }

  /** Asks the engine for one snapshot. Superseded requests are cancelled. */
  requestRefresh(): void {
    const bridge = this._deps.bridge();
    const encounterId = this._deps.readEncounterId();
    if (bridge === undefined || encounterId === '') {
      return;
    }
    this._cancelPending();
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
    if (state === undefined) {
      return;
    }
    const labels = this._deps.labelsForObjective?.() ?? {};
    this.objectives = projectObjectivePanel({ state, labels });
    this.hasAuthoredObjectives = this.objectives.length > 0;
    this._deps.debug?.('objectivesProjected', {
      count: this.objectives.length,
      statuses: this.objectives.map((entry) => `${entry.objectiveId}:${entry.status}`),
    });
  }

  private _cancelPending(): void {
    if (this._pending !== undefined) {
      clearTimeout(this._pending.timer);
      this._pending = undefined;
    }
  }
}

export const createCombatObjectivePanel = (deps: CombatObjectivePanelDeps): CombatObjectivePanel =>
  new CombatObjectivePanel(deps);
