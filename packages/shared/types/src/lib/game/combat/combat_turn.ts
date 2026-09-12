// packages/shared/types/src/lib/game/combat/combat_turn.ts
//
// Pure turn-coordinator domain types (Combat-02).
//
// These shapes are coordinator-local: they never cross the engine bridge and
// are never persisted, so — per C-509's placement rule — they are plain `type`
// aliases here rather than TypeBox schemas in `@aikami/schemas`. If one of them
// ever crosses a boundary, it gets a schema there instead of a hand-rolled
// validator here.
//
// `TurnBudget`, `CombatActionCost`, `CombatOutcome`, `CombatTeam` and
// `CombatInvalidReason` are reused as-is — this contract adds no versioned
// schema member.
//
// Contract: C-514 AC-1, AC-2, AC-3

import type { CombatActionCost, CombatOutcome, CombatTeam, TurnBudget } from './combat_state';
import type { CombatInvalidReason } from './combat_validation';

/**
 * Why the active turn is being (re)assigned or ended.
 *
 * - `encounter_start` — the first turn of a fresh encounter.
 * - `explicit_end_turn` — the player (or a command) ended the turn.
 * - `auto_exhausted` — every spendable budget was consumed and the actor's
 *   {@link AutoEndPolicy} permits advancing.
 * - `forced_defeat` — the encounter outcome was decided; no further turns run.
 * - `forced_incapacitated` — the active combatant is stunned/downed and is
 *   auto-skipped.
 */
export type TurnTrigger =
  | 'encounter_start'
  | 'explicit_end_turn'
  | 'auto_exhausted'
  | 'forced_defeat'
  | 'forced_incapacitated';

/**
 * The coordinator's read-only view of one combatant.
 *
 * Deliberately carries more than `{ combatantId, initiative, defeated }`: the
 * skip rule needs `stunned`/`downed`, and `getForcedEndReason` needs `team` and
 * the HP flags to mirror the kernel's `evaluateOutcome` (party = `player` |
 * `ally`).
 */
export type CombatantTurnStatus = {
  combatantId: string;
  initiative: number;
  team: CombatTeam;
  hp: number;
  downed: boolean;
  stunned: boolean;
  defeated: boolean;
};

/**
 * Deterministic turn order + round + the active index + every combatant's
 * budget. Immutable value: every coordinator function returns a new state and
 * never mutates its input.
 */
export type CombatTurnState = {
  /** Deterministic order: initiative desc, then `combatantId` asc. */
  order: string[];
  activeIndex: number;
  round: number;
  /** `r{round}:{combatantId}`, reusing the C-509 construction. `null` = no active turn. */
  turnId: string | null;
  /** Per-combatant budgets keyed by `combatantId`. */
  budgets: Record<string, TurnBudget>;
};

/**
 * Whether an exhausted turn is advanced automatically.
 *
 * Player-controlled combatants default to `manual` (architecture §9: only an
 * explicit end turn, a forced end, or an explicit auto-end policy advances);
 * AI-controlled combatants default to `auto_when_exhausted`.
 */
export type AutoEndPolicy = 'manual' | 'auto_when_exhausted';

/**
 * Superset of C-509's `CombatActionCost` with `'movement'`.
 *
 * The four C-509 members are **not** re-declared and `'movement'` is **not**
 * added to `CombatActionCostSchema` — that would be a versioned schema change.
 */
export type CombatBudgetCost = CombatActionCost | 'movement';

/** A coordinator-local budget-change description — not a versioned `CombatEvent`. */
export type CombatTurnBudgetChange = {
  combatantId: string;
  budget: TurnBudget;
};

/** Result of a turn transition: the next state, the budgets that moved, and an outcome when the encounter ended. */
export type TurnTransition = {
  state: CombatTurnState;
  budgetChanges: CombatTurnBudgetChange[];
  outcome?: CombatOutcome;
};

/** The active turn, as read from a {@link CombatTurnState}. */
export type ActiveTurnRef = {
  combatantId: string;
  turnId: string;
  round: number;
};

/** Result of `spendBudget` — a typed rejection, never a thrown error. */
export type SpendBudgetTransition =
  | { ok: true; state: CombatTurnState }
  | { ok: false; reason: CombatInvalidReason };
