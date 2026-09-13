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

import type {
  ActionForecast,
  CombatAbilityDefinition,
  CompiledPlan,
  GridPoint,
} from '@aikami/types';

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

// ---------------------------------------------------------------------------
// Natural-language decision state (C-525 AC-4, AC-5)
// ---------------------------------------------------------------------------

/** Lifecycle of one natural-language decision. */
export type CombatIntentStatus =
  | 'idle'
  | 'interpreting'
  | 'compiling'
  | 'awaiting_confirmation'
  | 'clarifying'
  | 'rejected';

/** One concrete reading the player can pick from a clarification (AC-5). */
export type CombatIntentClarificationOption = {
  optionId: string;
  /** i18n key — the compiler never authors prose. */
  labelKey: string;
  /** The plan that reading already compiled to. */
  plan: CompiledPlan;
};

/** A bounded clarification round: at most one, capped by COMBAT_INTENT_BOUNDS. */
export type CombatIntentClarification = {
  questionKey: string;
  options: CombatIntentClarificationOption[];
};

/**
 * Everything the language surface renders.
 *
 * `plan` is a compiled PROPOSAL: it is committed only by an explicit
 * confirmation (AC-4), and it is dropped whenever the engine reports a newer
 * revision.
 */
export type CombatIntentDecisionState = {
  status: CombatIntentStatus;
  /** The correlation id of the outstanding decision, if any. */
  requestId: string | null;
  /** The revision the instruction was authored against. */
  basedOnRevision: number;
  /** Verbatim (bounded) player text, echoed for correction. */
  text: string;
  plan: CompiledPlan | null;
  clarification: CombatIntentClarification | null;
  rejection: { messageKey: string } | null;
};

/** The idle decision — nothing submitted, nothing committed. */
export const IDLE_COMBAT_INTENT_DECISION: CombatIntentDecisionState = {
  status: 'idle',
  requestId: null,
  basedOnRevision: 0,
  text: '',
  plan: null,
  clarification: null,
  rejection: null,
};

/**
 * The editable preview of a compiled plan (AC-4).
 *
 * A projection of the plan's own numbers — the View renders this and never
 * recomputes a cost, a path or a forecast.
 */
export type CombatIntentPreview = {
  planId: string;
  commandKind: CompiledPlan['command']['kind'];
  /** Resolved destination cell (move plans only). */
  destination: GridPoint | null;
  movementCost: number | null;
  hitPercentage: number | null;
  damageMinimum: number | null;
  damageMaximum: number | null;
  /** Path cells in order (move plans only). */
  path: GridPoint[];
  warnings: string[];
  assumptions: string[];
  /** Always true in this release: there is no auto-commit path (AC-4). */
  requiresConfirmation: true;
};
