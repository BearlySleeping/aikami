// apps/frontend/client/src/lib/views/combat/types/combat_direct_control.ts
//
// Direct-control selection state for the combat View (Combat-04).
//
// A PROJECTION of what the player has selected, never a second source of
// mechanical truth: HP, budgets and positions live in the engine, and the
// forecast here is whatever the engine last answered. Kept beside
// `combat_enhancements.ts` because it is view-local (the client ViewModel and
// its View are the only consumers).
//
// Contract: C-516 AC-7, AC-9

import type { ActionForecast, CombatAbilityDefinition, GridPoint } from '@aikami/types';

/** What the player is currently picking. */
export type CombatSelectionMode = 'idle' | 'move' | 'ability' | 'target';

/** Lifecycle of the current preview round trip. */
export type CombatSelectionStatus = 'idle' | 'loading' | 'ready' | 'rejected';

/** A typed rejection surfaced by the engine (`COMBAT_PLAN_REJECTED`). */
export type CombatSelectionRejection = {
  reasonCode: string;
  messageKey: string;
};

/**
 * Everything the tactical sidebar needs to render the current selection.
 *
 * `requestId` correlates exactly one preview reply; a reply whose id or
 * revision no longer matches is discarded rather than rendered.
 */
export type CombatSelectionState = {
  mode: CombatSelectionMode;
  status: CombatSelectionStatus;
  requestId: string | null;
  /** The revision the outstanding request was bound to. */
  basedOnRevision: number;
  selectedAbilityId: string | null;
  selectedTargetId: string | null;
  legalEndpoints: GridPoint[];
  legalTargetIds: string[];
  /** The cell of each id in `legalTargetIds`, in the same order. */
  legalTargetCells: GridPoint[];
  movementCostTo: Record<string, number>;
  forecast: ActionForecast | null;
  rejection: CombatSelectionRejection | null;
};

/** An ability the player can pick, resolved from the production catalog. */
export type CombatAbilityOption = Pick<
  CombatAbilityDefinition,
  'abilityId' | 'name' | 'kind' | 'actionCost' | 'rangeCells'
>;

/** The empty selection — the state every cancel/commit returns to. */
export const IDLE_COMBAT_SELECTION: CombatSelectionState = {
  mode: 'idle',
  status: 'idle',
  requestId: null,
  basedOnRevision: 0,
  selectedAbilityId: null,
  selectedTargetId: null,
  legalEndpoints: [],
  legalTargetIds: [],
  legalTargetCells: [],
  movementCostTo: {},
  forecast: null,
  rejection: null,
};
