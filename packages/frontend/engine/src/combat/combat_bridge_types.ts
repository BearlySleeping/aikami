// packages/frontend/engine/src/combat/combat_bridge_types.ts
//
// Combat bridge payload types extracted from `../types.ts`.
//
// `types.ts` is on the source-file-size guard's grandfathered baseline, so the
// C-514 additions live here and are composed into the `GameCommand` /
// `GameEvent` unions by reference. Behaviour is identical — only the
// declaration site moved.
//
// Contract: C-514 AC-4, C-515 AC-5

import type {
  ActionForecast,
  CombatEngineKind,
  CombatEvent,
  CombatInvalidReason,
  CombatPreviewQuery,
  CombatState,
  GridPoint,
} from '@aikami/types';
import type { CombatEncounterParticipant } from './combat_encounter_start.ts';

/**
 * Ends the active combatant's turn. Sent by the combat ViewModel when the
 * player clicks "End Turn"; the engine validates turn ownership before
 * advancing (a client cannot end a turn that is not active).
 */
export type CombatEndTurnCommand = {
  type: 'COMBAT_END_TURN';
};

/**
 * Commits a budgeted tactical move to a destination cell (C-516 AC-8).
 *
 * The client sends the CELL, never a path: the engine reconstructs the path
 * from the same reachability projection the preview reported, so the committed
 * path always equals the previewed one for the same revision.
 */
export type CombatMoveCommand = {
  type: 'COMBAT_MOVE';
  cellX: number;
  cellY: number;
};

/**
 * Asks the engine to re-emit the CURRENT combat state (C-516 AC-5).
 *
 * A ViewModel that mounts while a fight is already running (the overlay is
 * opened optimistically before the engine answers, or a client remounts
 * mid-fight) missed `COMBAT_STARTED`/`TURN_CHANGED`. Replaying the live
 * snapshot is the only way for that surface to render the fight it is showing —
 * the alternative is a permanently blank turn tracker.
 */
export type CombatSyncRequestCommand = {
  type: 'COMBAT_SYNC_REQUEST';
};

/**
 * Tells the MAIN THREAD that a combat move selection is open (C-516 AC-8).
 *
 * Handled by `GameWorld` (never forwarded to the worker): while active, a
 * canvas click resolves to a budgeted combat move instead of explore
 * locomotion. Combat entry pauses the engine and locks explore movement, so a
 * plain `MOVE_TO_CELL` would be both wrong and ignored.
 */
export type CombatMoveModeCommand = {
  type: 'COMBAT_MOVE_MODE';
  active: boolean;
};

/**
 * Hands the main-thread canvas the current selection's highlight cells
 * (C-525 R-2).
 *
 * Handled by `GameWorld` (never forwarded to the worker) and drawn as a Pixi
 * overlay above the tactical battlefield: `legalEndpoints` are the reachable
 * move cells, `legalTargetCells` are the cells of the engine-declared legal
 * targets. An empty pair clears the overlay. The ViewModel owns the selection;
 * the engine only paints what the UI projected.
 */
export type CombatSelectionHighlightsCommand = {
  type: 'COMBAT_SELECTION_HIGHLIGHTS';
  legalEndpoints: GridPoint[];
  legalTargetCells: GridPoint[];
};

/**
 * Starts a production encounter from authored content (C-516 AC-2).
 *
 * Both entry funnels (the dialogue chip and the world-collision trigger) send
 * this command; the worker spawns the roster and starts the turn driver exactly
 * once. `engine` defaults to the resolved `combatEngine` flag.
 */
export type CombatStartEncounterCommand = {
  type: 'COMBAT_START_ENCOUNTER';
  encounterId: string;
  seed: number;
  engine?: CombatEngineKind;
  /**
   * Authored roster resolved on the main thread (which owns the content-pack
   * loader). Omitted by the collision funnel, which derives its roster from the
   * entities the map already spawned. Carries authored ids, cells and stats —
   * never free text and never model output.
   */
  roster?: CombatEncounterParticipant[];
};

/**
 * Emitted when the action economy changes for an entity (C-338 AC-1).
 *
 * C-514 widened this with the movement budget and split the former bonus action
 * into a quick action; `bonusActionAvailable` is kept as a deprecated alias for
 * one release.
 */
export type ActionEconomyChangedEvent = {
  type: 'ACTION_ECONOMY_CHANGED';
  entityId: number;
  /** Movement cells left this turn (C-514). */
  movementRemaining: number;
  actionAvailable: boolean;
  /** Quick action still available (C-514). */
  quickActionAvailable: boolean;
  /** @deprecated alias of `quickActionAvailable` — removed after one release. */
  bonusActionAvailable: boolean;
  reactionAvailable: boolean;
  /**
   * The combat state revision this budget belongs to (C-516); see
   * `TURN_CHANGED.stateRevision`.
   */
  stateRevision?: number;
};

/**
 * Asks the engine to answer a tactical query without committing to it.
 *
 * `requestId` is client-minted and correlates exactly one reply; the engine
 * validates the encounter, the active combatant and `basedOnRevision` before
 * answering, and never mutates state (C-515 AC-5).
 */
export type CombatPreviewRequestedCommand = {
  type: 'COMBAT_PREVIEW_REQUESTED';
  /** Client-minted correlation id — never reused across revisions. */
  requestId: string;
  encounterId: string;
  /** The C-509 `stateRevision` the query is bound to. */
  basedOnRevision: number;
  query: CombatPreviewQuery;
};

/**
 * The engine's answer to one preview request (C-515 AC-5).
 *
 * `legalEndpoints`/`legalTargetIds`/`movementCostTo` are present for the query
 * kind that produced them.
 */
export type CombatPreviewReadyEvent = {
  type: 'COMBAT_PREVIEW_READY';
  requestId: string;
  forecast: ActionForecast;
  legalEndpoints?: GridPoint[];
  legalTargetIds?: string[];
  /** The cell of each id in `legalTargetIds`, in the same order (C-525 R-2). */
  legalTargetCells?: GridPoint[];
  movementCostTo?: Record<string, number>;
};

/**
 * The engine could not start the requested encounter, with a stable typed
 * reason (C-516 Edge Cases / Migration & Rollback).
 *
 * Emitted only when NO engine could start the encounter — after a failed v2
 * attempt the engine first falls back to the legacy resolver, and a successful
 * fallback emits `COMBAT_STARTED` instead. The UI uses this to leave the combat
 * overlay it optimistically opened instead of showing a dead, unplayable fight.
 */
export type CombatStartRejectedEvent = {
  type: 'COMBAT_START_REJECTED';
  encounterId: string;
  reasonCode: CombatInvalidReason;
  messageKey: string;
};

/** A preview the engine refused to answer, with a stable typed reason. */
export type CombatPlanRejectedEvent = {
  type: 'COMBAT_PLAN_REJECTED';
  requestId: string;
  reasonCode: CombatInvalidReason;
  messageKey: string;
};

/** A committed combat command the engine refused without mutating state. */
export type CombatCommandRejectedEvent = {
  type: 'COMBAT_COMMAND_REJECTED';
  reasonCode: CombatInvalidReason;
  messageKey: string;
};

/** Main-thread canvas intent routed to the UI-owned move selection. */
export type CombatMoveRequestedEvent = {
  type: 'COMBAT_MOVE_REQUESTED';
  cellX: number;
  cellY: number;
};

/**
 * The player submitted a natural-language combat instruction (C-525 AC-4).
 *
 * `text` is verbatim, bounded, untrusted player input: it is forwarded so the
 * engine can acknowledge the decision and so a mid-flight request can be
 * correlated/cancelled by `requestId`. Interpretation and compilation happen on
 * the client — the engine never calls a model while resolving a turn.
 */
export type CombatLanguageIntentSubmittedCommand = {
  type: 'COMBAT_LANGUAGE_INTENT_SUBMITTED';
  /** Client-minted correlation id; cancellation and staleness key on it. */
  requestId: string;
  encounterId: string;
  /** The revision the instruction was authored against. */
  basedOnRevision: number;
  /** Capped, untrusted player text (never engine instructions). */
  text: string;
  /** Trusted UI selections that narrow the instruction. */
  context?: {
    selectedCombatantId?: string;
    selectedObjectId?: string;
  };
};

/**
 * Asks the engine for the live v2 `CombatState` (C-525 AC-4).
 *
 * The intent compiler is a PURE function of a state snapshot, and the client
 * holds only a projection of the fight. Rather than duplicating mechanics, the
 * client asks for the kernel state the resolver itself validates against, then
 * grounds the selectors locally — no frame ever waits on the model, and the
 * compiled command is still re-validated by the engine before it commits.
 *
 * Answered with `COMBAT_STATE_SNAPSHOT` when a v2 encounter is running, and with
 * `COMBAT_STATE_SNAPSHOT_REJECTED` otherwise.
 */
export type CombatStateSnapshotRequestCommand = {
  type: 'COMBAT_STATE_SNAPSHOT_REQUESTED';
  requestId: string;
};

/** The live v2 kernel state, keyed to the request that asked for it. */
export type CombatStateSnapshotEvent = {
  type: 'COMBAT_STATE_SNAPSHOT';
  requestId: string;
  state: CombatState;
};

/** No v2 state to snapshot (legacy encounter, ended fight, no world). */
export type CombatStateSnapshotRejectedEvent = {
  type: 'COMBAT_STATE_SNAPSHOT_REJECTED';
  requestId: string;
  reasonCode: CombatInvalidReason;
  messageKey: string;
};

/**
 * The kernel events one committed v2 command resolved (C-525 AC-7).
 *
 * Emitted alongside the per-event sidebar mapping so the client can narrate the
 * OUTCOME from `CombatEvent[]` — the only input outcome narration accepts —
 * instead of re-deriving mechanics from the mapped messages. `names` is the
 * authored display name of every combatant in the resolved state, so narration
 * never has to know the kernel's identity scheme.
 */
export type CombatEventsResolvedEvent = {
  type: 'COMBAT_EVENTS_RESOLVED';
  events: CombatEvent[];
  /** authored combatant id → display name, for narration only. */
  names: Record<string, string>;
};

/**
 * The client is deciding what a language instruction means (C-525 AC-4).
 *
 * Emitted by the engine as a deterministic acknowledgement of
 * `COMBAT_LANGUAGE_INTENT_SUBMITTED`; `awaiting_confirmation` is owned by the
 * client surface that renders the preview.
 */
export type CombatDecisionPendingEvent = {
  type: 'COMBAT_DECISION_PENDING';
  requestId: string;
  state: 'interpreting' | 'compiling' | 'awaiting_confirmation';
};

/** Every `GameCommand` the combat dispatcher owns. */
export type CombatBridgeCommand =
  | CombatEndTurnCommand
  | CombatLanguageIntentSubmittedCommand
  | CombatMoveCommand
  | CombatMoveModeCommand
  | CombatPreviewRequestedCommand
  | CombatSelectionHighlightsCommand
  | CombatStartEncounterCommand
  | CombatStateSnapshotRequestCommand
  | CombatSyncRequestCommand;

/** Every combat-related `GameEvent` composed into the `GameEvent` union. */
export type CombatBridgeEvent =
  | ActionEconomyChangedEvent
  | CombatCommandRejectedEvent
  | CombatDecisionPendingEvent
  | CombatEventsResolvedEvent
  | CombatMoveRequestedEvent
  | CombatPreviewReadyEvent
  | CombatPlanRejectedEvent
  | CombatStartRejectedEvent
  | CombatStateSnapshotEvent
  | CombatStateSnapshotRejectedEvent;
