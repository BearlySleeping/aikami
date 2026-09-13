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
  CombatInvalidReason,
  CombatPreviewQuery,
  GridPoint,
} from '@aikami/types';

/**
 * Ends the active combatant's turn. Sent by the combat ViewModel when the
 * player clicks "End Turn"; the engine validates turn ownership before
 * advancing (a client cannot end a turn that is not active).
 */
export type CombatEndTurnCommand = {
  type: 'COMBAT_END_TURN';
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
  movementCostTo?: Record<string, number>;
};

/** A preview the engine refused to answer, with a stable typed reason. */
export type CombatPlanRejectedEvent = {
  type: 'COMBAT_PLAN_REJECTED';
  requestId: string;
  reasonCode: CombatInvalidReason;
  messageKey: string;
};

/** Every `GameCommand` the combat dispatcher owns. */
export type CombatBridgeCommand = CombatEndTurnCommand | CombatPreviewRequestedCommand;

/** Every combat-related `GameEvent` composed into the `GameEvent` union. */
export type CombatBridgeEvent =
  | ActionEconomyChangedEvent
  | CombatPreviewReadyEvent
  | CombatPlanRejectedEvent;
