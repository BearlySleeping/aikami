// apps/frontend/client/src/lib/views/dev/combat/session/combat_debug_session_contract.ts
//
// The structural contract between the workspace ViewModel and a live session.
//
// These types live in the session layer (not the ViewModel) so that the session
// modules — the live session and its observer — never have to import back from
// the ViewModel. The ViewModel is one consumer of this contract; the headless
// tests are another, and they build typed doubles against it.
//
// Contract: combat debug workspace (execution prompt §2, §6, §7)

import type {
  DebugSceneSpec,
  EngineBridge,
  GameWorldViewportDiagnostics,
} from '@aikami/frontend/engine';
import type { CombatCommand, CombatEvent, CombatState, GridPoint } from '@aikami/types';

/** A point-in-time authoritative view the workspace renders from. */
export type CombatDebugSessionSnapshot = {
  readonly state: CombatState;
  readonly revision: number;
  readonly round: number;
  readonly phase: CombatState['phase'];
  readonly activeCombatantId: string | undefined;
};

/** Authoritative selection cells the production UI projected to the engine. */
export type CombatDebugSelectionProjection = {
  readonly legalEndpoints: readonly GridPoint[];
  readonly legalTargetCells: readonly GridPoint[];
};

/** Screen → world → cell projection of the latest canvas pointer position. */
export type CombatDebugPointerProjection = {
  readonly screenX: number;
  readonly screenY: number;
  readonly worldX: number;
  readonly worldY: number;
  readonly cellX: number;
  readonly cellY: number;
};

/** Observer callbacks a live session raises; the ViewModel owns all state. */
export type CombatDebugSessionObserver = {
  onSnapshot(snapshot: CombatDebugSessionSnapshot): void;
  onEvents(events: readonly CombatEvent[]): void;
  /** A committed command the engine accepted, with its resulting revision. */
  onCommandAccepted(accepted: {
    commandId: string;
    stateRevision: number;
    duplicate: boolean;
  }): void;
  /** A refused command, with the precise admission/kernel cause. */
  onCommandRejected(rejected: {
    commandType: string;
    reasonCode: string;
    messageKey: string;
    detail: string | undefined;
  }): void;
  /** A command the controller requested, before the engine answers. */
  onCommandRequested(requested: {
    commandType: string;
    commandId: string | undefined;
    basedOnRevision: number | undefined;
    replayCommand: CombatCommand | undefined;
  }): void;
  onStatus(status: string): void;
  onError(message: string): void;
  /** Latest authoritative selection the production UI projected (optional). */
  onSelection?(selection: CombatDebugSelectionProjection): void;
  /** Latest pointer projection; `undefined` when the pointer left the canvas. */
  onPointer?(pointer: CombatDebugPointerProjection | undefined): void;
  /** Latest viewport/renderer diagnostics after boot and after each resize. */
  onViewport?(diagnostics: GameWorldViewportDiagnostics): void;
};

/** Structural contract the ViewModel needs from a live session. */
export type CombatDebugSession = {
  readonly bridge: EngineBridge | undefined;
  boot(): Promise<void>;
  requestSnapshot(encounterId: string): Promise<CombatState>;
  dispose(): void;
  readonly disposed: boolean;
  /**
   * Holds (pause) or releases (resume) the client → engine command boundary.
   * The engine has no pause primitive, so this is the only boundary the
   * debugger owns — see the session's command gate for the exact limits.
   */
  setCommandGateHeld(held: boolean): void;
  /** Commands waiting at the boundary. */
  readonly queuedCommandCount: number;
  /** Releases exactly one queued command; false when none was waiting. */
  stepCommandGate(): boolean;
  /**
   * Sets (or clears) the synthetic debug-scene projection the engine paints.
   * Read-only presentation; the session never derives mechanics from it.
   */
  applyDebugScene(spec: DebugSceneSpec | undefined): void;
  /** Re-fits the active synthetic board to the current pane size. */
  fitDebugCamera(): void;
  /** Live viewport/renderer diagnostics for the health panel. */
  getViewportDiagnostics(): GameWorldViewportDiagnostics;
};
