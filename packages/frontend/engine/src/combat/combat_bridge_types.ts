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
  AiCombatDecision,
  CombatAiDegradedReason,
  CombatEngineKind,
  CombatEvent,
  CombatInvalidReason,
  CombatPreviewQuery,
  CombatState,
  CompanionControlMode,
  GridPoint,
  ReactionChoice,
  ReactionChoiceSource,
  ReactionPolicy,
} from '@aikami/types';
import type { EncounterRosterPayload } from './combat_encounter_types.ts';
import type { WorldObjectState } from './combat_world_object_state.ts';

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
  roster?: EncounterRosterPayload;
  /**
   * The pinned `PUBLIC_COMBAT_LLM_AGENTS` value for this encounter (C-526
   * AC-9). Read once on the main thread and pinned here exactly as `engine`
   * is: an encounter never changes AI mode mid-fight. Omitted/`false` keeps
   * the deterministic AI and the authored narration templates as the only
   * paths.
   */
  llmAgentsEnabled?: boolean;
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
/**
 * Uses one authored affordance on one authored battlefield object (C-531).
 *
 * The client names stable authored ids only — never a numeric mechanic, a dice
 * value, an effect or a state patch. The kernel owns eligibility, the check,
 * the dice and every consequence.
 */
export type CombatInteractCommand = {
  type: 'COMBAT_INTERACT';
  objectId: string;
  affordanceId: string;
  /** Optional second object the approach names (e.g. an oil pool). */
  targetObjectId?: string | null;
};

/**
 * Asks the engine for the world-object block that outlives the encounter
 * (C-531 AC-7).
 *
 * Authored battlefield objects are content, not ECS entities, so they do not
 * ride in the ECS snapshot. The save path asks for them separately and stores
 * the answer in the save envelope.
 */
export type WorldObjectsRequestedCommand = {
  type: 'WORLD_OBJECTS_REQUESTED';
  /** Client-minted correlation id — never reused. */
  requestId: string;
};

/** Restores a saved world-object block into the engine (C-531 AC-7). */
export type WorldObjectsRestoredCommand = {
  type: 'WORLD_OBJECTS_RESTORED';
  /** The block read from the save envelope, or `null` to clear it. */
  worldObjects: WorldObjectState | null;
};

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
  /** Command variant that was rejected, for surface-specific correlation. */
  commandType:
    | 'COMBAT_ACTION'
    | 'COMBAT_MOVE'
    | 'COMBAT_END_TURN'
    | 'COMBAT_INTERACT'
    | 'COMBAT_REACTION_SELECTED';
  reasonCode: CombatInvalidReason;
  messageKey: string;
};

/**
 * A bounded, authored intention line for an AI-controlled actor (C-526 AC-7).
 *
 * The line is authored or model-bounded, never private model text: it exists so
 * the player can read what an enemy is about to attempt without the engine
 * revealing hidden state or chain-of-thought.
 */
export type CombatIntentTelegraphedEvent = {
  type: 'COMBAT_INTENT_TELEGRAPHED';
  encounterId: string;
  actorId: string;
  line: string;
};

/**
 * The AI layer degraded to the deterministic path (C-526 AC-7, AC-9).
 *
 * `disabled` fires once per actor at encounter start when the flag is pinned
 * off; the other reasons fire on the first fallback for that actor. The
 * emitter de-duplicates per `(actor, reason)` so the log is not spammed per
 * action.
 */
export type CombatAiDegradedEvent = {
  type: 'COMBAT_AI_DEGRADED';
  encounterId: string;
  actorId: string;
  reason: CombatAiDegradedReason;
};

/**
 * The engine needs a decision for an active AI combatant (C-526 AC-5).
 *
 * Emitted instead of deciding locally when the LLM layer is pinned ON. The
 * engine NEVER blocks on the answer: it defers the turn, starts a hard-deadline
 * timer, and falls back to `chooseV2AiCommand` if no submission arrives. The
 * client answers with `COMBAT_AI_DECISION_SUBMITTED` — from a prefetched
 * decision when one matches the revision, otherwise from a fresh call, or with
 * `decision: null` to request the deterministic fallback explicitly.
 */
export type CombatAiDecisionRequestedEvent = {
  type: 'COMBAT_AI_DECISION_REQUESTED';
  requestId: string;
  encounterId: string;
  combatantId: string;
  /** The revision the decision must be grounded against. */
  stateRevision: number;
};

/**
 * Why a submission carries no decision (C-526 AC-5/AC-6, lifecycle repair).
 *
 * Before this type existed `decision: null` meant exactly one thing — "run the
 * deterministic fallback" — so declining a proposal, abandoning a stale plan and
 * losing the provider all authorised a mechanical action the player never asked
 * for. The explicit resolution separates cancellation from fallback authority:
 *
 *   - `fallback`  the deterministic planner may act (provider failure/timeout).
 *   - `decline`   the player refused the plan: end the turn WITHOUT acting.
 *   - `stale`     the plan no longer matches the live revision: re-request, do
 *                 not act.
 *   - `end_turn`  the player explicitly ends the actor's turn without acting.
 */
export type CombatAiDecisionResolution = 'fallback' | 'decline' | 'stale' | 'end_turn';

/**
 * The client's answer to {@link CombatAiDecisionRequestedEvent} (C-526 AC-5).
 *
 * A submission with a `decision` commits through the step-wise pipeline. A
 * `decision: null` submission MUST carry a {@link CombatAiDecisionResolution}
 * saying WHY it is empty; an absent resolution preserves the legacy "use the
 * deterministic fallback" meaning. A submission for an unknown, superseded or
 * stale request is ignored by the engine.
 */
export type CombatAiDecisionSubmittedCommand = {
  type: 'COMBAT_AI_DECISION_SUBMITTED';
  requestId: string;
  encounterId: string;
  combatantId: string;
  stateRevision: number;
  decision: AiCombatDecision | null;
  /** Required intent of a `decision: null` submission (see the resolution type). */
  resolution?: CombatAiDecisionResolution;
  /**
   * Keep the actor's turn open after this step (C-526 AC-6 multi-step approval).
   *
   * A step-wise submission commits exactly one approved step; the engine then
   * re-requests the next decision at the new revision instead of force-ending
   * the turn, so a move → attack plan executes across two approvals without the
   * first step consuming the whole turn.
   */
  stepwise?: boolean;
};

/**
 * The player changed a companion's control mode (C-526 AC-6).
 *
 * Mode is a player PREFERENCE, not a rules path: the engine only uses it to
 * decide who owns the companion's turn (`direct` = the player; every other mode
 * = the coordinator defers and waits for the player's confirmation). `intent`
 * carries the standing goal for Intent mode, bounded at the boundary.
 */
export type CombatCompanionModeSetCommand = {
  type: 'COMBAT_COMPANION_MODE_SET';
  encounterId: string;
  combatantId: string;
  mode: CompanionControlMode;
  /** Standing goal for `intent` mode; cleared for the other modes. */
  intent?: string;
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
  encounterId: string;
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
 * The engine no longer needs this actor's decision (C-526 AC-6).
 *
 * Emitted when a companion's control mode changes to `direct` while its turn was
 * awaiting player approval: the player now owns the turn, so any proposal the
 * client is showing for this request is obsolete and must be discarded without
 * committing.
 */
export type CombatAiDecisionWithdrawnEvent = {
  type: 'COMBAT_AI_DECISION_WITHDRAWN';
  requestId: string;
  encounterId: string;
  combatantId: string;
};

/**
 * One approved step finished activating (C-526 AC-6 multi-step continuation).
 *
 * Emitted after `produceAiCombatDecision` resolves for a client submission so
 * the approval surface can report the ACTUAL partial outcome and decide whether
 * a continuation request follows. `continues` is true only when the submission
 * was step-wise, the actor still holds the turn, and the encounter is live — in
 * which case the engine has already re-requested the next decision.
 */
export type CombatAiStepResolvedEvent = {
  type: 'COMBAT_AI_STEP_RESOLVED';
  requestId: string;
  encounterId: string;
  actorId: string;
  /** The revision AFTER the step committed (or the unchanged revision on failure). */
  revision: number;
  /** Whether at least one command committed. */
  committed: boolean;
  /** Commands committed by this step. */
  stepsExecuted: number;
  /** True when the intent could not be executed in full. */
  partial: boolean;
  /** Whether the actor's turn is still open and a continuation was requested. */
  continues: boolean;
  degradedReason?: CombatAiDegradedReason;
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

/**
 * The player/AI decision for one open reaction window (C-532 AC-3, AC-4).
 *
 * Carries window identity AND version plus the encounter-run identity, so the
 * worker can reject a duplicate or stale choice before any reaction resource or
 * RNG is spent. `source` records how the choice came to exist: a player
 * decision, a pinned AI policy, or an optional player-enabled timer whose
 * expiry defaults to Decline.
 */
export type CombatReactionSelectedCommand = {
  type: 'COMBAT_REACTION_SELECTED';
  encounterId: string;
  encounterRunId: string;
  windowId: string;
  windowVersion: number;
  reactorId: string;
  choice: ReactionChoice;
  source: ReactionChoiceSource;
  /** The C-509 `stateRevision` the choice was made against. */
  basedOnRevision: number;
};

/**
 * A reaction window opened and the encounter is suspended on it (C-532 AC-3).
 *
 * `reactorQueue` is the eligible-reactor order (initiative desc, then stable id
 * asc). The UI uses it to show whose decision is pending without re-deriving
 * eligibility. Known opportunity risk is shown in movement previews; an unseen
 * reactor is never revealed here before it becomes observable.
 */
export type CombatReactionOpenedEvent = {
  type: 'COMBAT_REACTION_OPENED';
  encounterId: string;
  encounterRunId: string;
  windowId: string;
  windowVersion: number;
  initiatingCommandId: string;
  moverId: string;
  reactionId: string;
  currentReactorId: string | null;
  reactorQueue: string[];
  triggerCell: GridPoint;
  /** The reactor's policy, so the surface knows whether to ask or auto-resolve. */
  reactionPolicy: ReactionPolicy;
  /** Ability the reactor would use, and its cost, for the decision surface. */
  abilityId: string;
  /** Movement cells already committed before the trigger cell. */
  committedCells: GridPoint[];
};

/** Every `GameCommand` the combat dispatcher owns. */
export type CombatBridgeCommand =
  | CombatAiDecisionSubmittedCommand
  | CombatCompanionModeSetCommand
  | CombatEndTurnCommand
  | CombatInteractCommand
  | CombatLanguageIntentSubmittedCommand
  | CombatMoveCommand
  | CombatMoveModeCommand
  | CombatPreviewRequestedCommand
  | CombatReactionSelectedCommand
  | WorldObjectsRequestedCommand
  | WorldObjectsRestoredCommand
  | CombatSelectionHighlightsCommand
  | CombatStartEncounterCommand
  | CombatStateSnapshotRequestCommand
  | CombatSyncRequestCommand;

/**
 * The engine's answer to {@link WorldObjectsRequestedCommand} (C-531 AC-7).
 *
 * `worldObjects: null` means "this world has no persisted object state" —
 * a fight with no environmental mechanics, or a fresh campaign.
 */
export type WorldObjectsReadyEvent = {
  type: 'WORLD_OBJECTS_READY';
  requestId: string;
  worldObjects: WorldObjectState | null;
};

/** Every combat-related `GameEvent` composed into the `GameEvent` union. */
export type CombatBridgeEvent =
  | ActionEconomyChangedEvent
  | CombatAiDecisionRequestedEvent
  | CombatAiDecisionWithdrawnEvent
  | CombatAiStepResolvedEvent
  | CombatAiDegradedEvent
  | CombatCommandRejectedEvent
  | CombatDecisionPendingEvent
  | CombatEventsResolvedEvent
  | CombatIntentTelegraphedEvent
  | CombatMoveRequestedEvent
  | CombatPreviewReadyEvent
  | CombatPlanRejectedEvent
  | CombatReactionOpenedEvent
  | WorldObjectsReadyEvent
  | CombatStartRejectedEvent
  | CombatStateSnapshotEvent
  | CombatStateSnapshotRejectedEvent;
