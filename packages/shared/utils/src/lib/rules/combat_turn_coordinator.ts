// packages/shared/utils/src/lib/rules/combat_turn_coordinator.ts
//
// Pure, deterministic turn coordinator — the single owner of "whose turn",
// the round counter, and the four-budget action economy for Combat 2.0.
//
// Snapshot-in / snapshot-out: every exported function is a pure function of
// its arguments, never mutates the input state, and performs no I/O. There is
// no engine, ECS, client, AI, network or ambient-randomness dependency.
//
// `combat_kernel.ts` delegates its turn advance and budget legality here so
// there is exactly one turn/budget authority in the rules layer.
//
// Contract: C-514 AC-1, AC-2, AC-3

import type {
  ActiveTurnRef,
  AutoEndPolicy,
  CombatantTurnStatus,
  CombatBudgetCost,
  CombatInvalidReason,
  CombatOutcome,
  CombatTurnBudgetChange,
  CombatTurnState,
  SpendBudgetTransition,
  TurnBudget,
  TurnTransition,
  TurnTrigger,
} from '@aikami/types';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/**
 * Movement allowance restored when a combatant's turn starts.
 *
 * Combat-02 had no per-combatant speed field (`CombatStats` carries none), so
 * the turn-start budget reset used this single documented allowance. C-515 adds
 * `movementPerTurnFor` — an optional per-combatant resolver — with this value
 * as the fallback (C-515 AC-6).
 */
export const DEFAULT_MOVEMENT_PER_TURN = 6;

/**
 * Per-combatant movement allowance lookup.
 *
 * Returns `undefined` when the combatant has no explicit allowance, in which
 * case the caller's `movementPerTurn` (or {@link DEFAULT_MOVEMENT_PER_TURN})
 * applies. C-515 reads this from the engine's `CombatMovement` component.
 */
export type MovementAllowanceResolver = (combatantId: string) => number | undefined;

/**
 * Resolves one combatant's movement allowance: explicit per-combatant value
 * first, then the call-level `movementPerTurn`, then the default.
 */
const resolveMovementPerTurn = (options: {
  combatantId: string;
  movementPerTurn?: number;
  movementPerTurnFor?: MovementAllowanceResolver;
}): number =>
  options.movementPerTurnFor?.(options.combatantId) ??
  options.movementPerTurn ??
  DEFAULT_MOVEMENT_PER_TURN;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const cloneValue = <T>(value: T): T => structuredClone(value);

const cloneTurnState = (state: CombatTurnState): CombatTurnState => ({
  order: [...state.order],
  activeIndex: state.activeIndex,
  round: state.round,
  turnId: state.turnId,
  budgets: cloneValue(state.budgets),
});

/**
 * Deterministic, non-random turn id. Reuses the C-509 construction exactly —
 * do not invent a second ordering or id format.
 */
export const turnIdFor = (round: number, combatantId: string): string => `r${round}:${combatantId}`;

/** Total order on combatant ids — the deterministic initiative tiebreak. */
const compareCombatantIds = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};

const normalizeStatus = (
  status: CombatantTurnStatus | CombatantTurnStatus[],
): CombatantTurnStatus[] => (Array.isArray(status) ? status : [status]);

const isIncapacitated = (status: CombatantTurnStatus): boolean =>
  status.defeated || status.downed || status.hp <= 0;

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

/** A full budget for one turn — the only place a turn-start reset is defined. */
export const defaultTurnBudget = (
  movementPerTurn: number = DEFAULT_MOVEMENT_PER_TURN,
): TurnBudget => ({
  movementRemaining: movementPerTurn,
  actionAvailable: true,
  quickActionAvailable: true,
  reactionAvailable: true,
});

/**
 * Budget legality for one cost — the single authority the kernel's
 * `checkActionCost` delegates to.
 *
 * Reactions return `noActionAvailable` until Combat-08: there is no
 * `reactionUnavailable` code in the versioned `CombatInvalidReasonSchema` and
 * this contract adds none.
 */
export const checkBudgetCost = (
  budget: TurnBudget,
  cost: CombatBudgetCost,
): CombatInvalidReason | null => {
  switch (cost) {
    case 'action':
      return budget.actionAvailable ? null : 'noActionAvailable';
    case 'quick':
      return budget.quickActionAvailable ? null : 'noActionAvailable';
    case 'reaction':
      return 'noActionAvailable';
    case 'free':
      return null;
    case 'movement':
      return budget.movementRemaining > 0 ? null : 'movementBudgetExceeded';
    default:
      return 'noActionAvailable';
  }
};

// ---------------------------------------------------------------------------
// createTurnState
// ---------------------------------------------------------------------------

/**
 * Builds a deterministic turn state: initiative desc, then `combatantId` asc.
 * Every combatant starts with a full budget; the input is never mutated.
 */
export const createTurnState = (
  entries: CombatantTurnStatus[],
  movementPerTurn: number = DEFAULT_MOVEMENT_PER_TURN,
  movementPerTurnFor?: MovementAllowanceResolver,
): CombatTurnState => {
  const sorted = [...entries].sort(
    (a, b) => b.initiative - a.initiative || compareCombatantIds(a.combatantId, b.combatantId),
  );
  const order = sorted.map((entry) => entry.combatantId);
  const budgets: Record<string, TurnBudget> = {};
  for (const combatantId of order) {
    budgets[combatantId] = defaultTurnBudget(
      resolveMovementPerTurn({ combatantId, movementPerTurn, movementPerTurnFor }),
    );
  }
  const first = order[0];
  return {
    order,
    activeIndex: 0,
    round: 1,
    turnId: first === undefined ? null : turnIdFor(1, first),
    budgets,
  };
};

// ---------------------------------------------------------------------------
// getActiveTurn / isExhausted
// ---------------------------------------------------------------------------

/** The active turn, or `null` when no combatant can act. */
export const getActiveTurn = (state: CombatTurnState): ActiveTurnRef | null => {
  const combatantId = state.order[state.activeIndex];
  if (combatantId === undefined || state.turnId === null) {
    return null;
  }
  return { combatantId, turnId: state.turnId, round: state.round };
};

/**
 * Whether the combatant has nothing left to spend.
 *
 * The reaction budget is deliberately excluded: reactions are disabled in
 * Combat-02 (Combat-08 owns the reaction window), so `reactionAvailable` stays
 * `true` forever and including it would make exhaustion unreachable.
 */
export const isExhausted = (state: CombatTurnState, combatantId: string): boolean => {
  const budget = state.budgets[combatantId];
  if (budget === undefined) {
    return true;
  }
  return budget.movementRemaining <= 0 && !budget.actionAvailable && !budget.quickActionAvailable;
};

// ---------------------------------------------------------------------------
// getForcedEndReason
// ---------------------------------------------------------------------------

/**
 * Mirrors the kernel's `evaluateOutcome`: `party_defeated` takes precedence
 * when both sides are wiped on the same transition (a mutual wipe is a loss).
 *
 * Accepts one status or the whole roster; the roster form is what callers with
 * a live turn state pass.
 */
export const getForcedEndReason = (
  status: CombatantTurnStatus | CombatantTurnStatus[],
): CombatOutcome | null => {
  const all = normalizeStatus(status);
  const party = all.filter((entry) => entry.team === 'player' || entry.team === 'ally');
  const enemies = all.filter((entry) => entry.team === 'enemy');
  if (party.length > 0 && party.every((entry) => isIncapacitated(entry))) {
    return { victory: false, reason: 'party_defeated' };
  }
  if (enemies.length > 0 && enemies.every((entry) => isIncapacitated(entry))) {
    return { victory: true, reason: 'all_enemies_defeated' };
  }
  return null;
};

// ---------------------------------------------------------------------------
// beginTurn
// ---------------------------------------------------------------------------

export type BeginTurnInput = {
  state: CombatTurnState;
  status: CombatantTurnStatus | CombatantTurnStatus[];
  trigger: TurnTrigger;
  /** Turn movement allowance; defaults to {@link DEFAULT_MOVEMENT_PER_TURN}. */
  movementPerTurn?: number;
  /** Per-combatant allowance override (C-515 AC-6). */
  movementPerTurnFor?: MovementAllowanceResolver;
};

/**
 * Starts the active combatant's turn: resets their budget, stamps `turnId`.
 *
 * A defeated combatant never begins a turn — the state is returned unchanged
 * so the caller can end/skip it instead.
 */
export const beginTurn = (input: BeginTurnInput): TurnTransition => {
  const { state, trigger } = input;
  const movementPerTurn = input.movementPerTurn ?? DEFAULT_MOVEMENT_PER_TURN;
  const statuses = normalizeStatus(input.status);
  const combatantId = state.order[state.activeIndex];

  if (combatantId === undefined) {
    return { state: cloneTurnState(state), budgetChanges: [] };
  }

  const status = statuses.find((entry) => entry.combatantId === combatantId);
  if (status?.defeated) {
    return { state: cloneTurnState(state), budgetChanges: [] };
  }

  const budget = defaultTurnBudget(
    resolveMovementPerTurn({
      combatantId,
      movementPerTurn,
      movementPerTurnFor: input.movementPerTurnFor,
    }),
  );
  const next: CombatTurnState = {
    ...cloneTurnState(state),
    turnId: turnIdFor(state.round, combatantId),
    budgets: { ...cloneValue(state.budgets), [combatantId]: budget },
  };

  void trigger;
  return { state: next, budgetChanges: [{ combatantId, budget }] };
};

// ---------------------------------------------------------------------------
// endTurn
// ---------------------------------------------------------------------------

export type EndTurnInput = {
  state: CombatTurnState;
  status: CombatantTurnStatus | CombatantTurnStatus[];
  trigger: TurnTrigger;
  policy: AutoEndPolicy;
  /** Turn movement allowance; defaults to {@link DEFAULT_MOVEMENT_PER_TURN}. */
  movementPerTurn?: number;
  /** Per-combatant allowance override (C-515 AC-6). */
  movementPerTurnFor?: MovementAllowanceResolver;
};

/**
 * Ends the active turn and advances to the next eligible combatant.
 *
 * Advancement happens only for `explicit_end_turn`, `forced_defeat`,
 * `forced_incapacitated`, or `auto_exhausted` **under an `auto_when_exhausted`
 * policy**. Under `manual`, an `auto_exhausted` call is a no-op — an exhausted
 * player turn is never force-advanced.
 *
 * Wrapping past the last eligible combatant increments `round`; defeated
 * combatants are skipped without double-counting rounds.
 */
export const endTurn = (input: EndTurnInput): TurnTransition => {
  const { state, trigger, policy } = input;
  const movementPerTurn = input.movementPerTurn ?? DEFAULT_MOVEMENT_PER_TURN;
  const statuses = normalizeStatus(input.status);

  if (trigger === 'auto_exhausted' && policy === 'manual') {
    return { state: cloneTurnState(state), budgetChanges: [] };
  }

  if (trigger === 'forced_defeat' || trigger === 'forced_incapacitated') {
    const outcome =
      getForcedEndReason(statuses) ??
      ({
        victory: false,
        reason: trigger === 'forced_defeat' ? 'party_defeated' : 'combatant_incapacitated',
      } satisfies CombatOutcome);
    return {
      state: { ...cloneTurnState(state), turnId: null },
      budgetChanges: [],
      outcome,
    };
  }

  const order = state.order;
  if (order.length === 0) {
    return { state: cloneTurnState(state), budgetChanges: [] };
  }

  let index = state.activeIndex;
  let round = state.round;
  let advancedId: string | null = null;

  for (let step = 0; step < order.length; step++) {
    index += 1;
    if (index >= order.length) {
      index = 0;
      round += 1;
    }
    const candidateId = order[index];
    if (candidateId === undefined) {
      continue;
    }
    const status = statuses.find((entry) => entry.combatantId === candidateId);
    if (status?.defeated) {
      continue;
    }
    advancedId = candidateId;
    break;
  }

  if (advancedId === null) {
    return {
      state: { ...cloneTurnState(state), turnId: null },
      budgetChanges: [],
      outcome: getForcedEndReason(statuses) ?? undefined,
    };
  }

  const budget = defaultTurnBudget(
    resolveMovementPerTurn({
      combatantId: advancedId,
      movementPerTurn,
      movementPerTurnFor: input.movementPerTurnFor,
    }),
  );
  const budgetChanges: CombatTurnBudgetChange[] = [{ combatantId: advancedId, budget }];
  return {
    state: {
      ...cloneTurnState(state),
      activeIndex: index,
      round,
      turnId: turnIdFor(round, advancedId),
      budgets: { ...cloneValue(state.budgets), [advancedId]: budget },
    },
    budgetChanges,
  };
};

// ---------------------------------------------------------------------------
// spendBudget
// ---------------------------------------------------------------------------

/**
 * Spends part of one combatant's turn budget.
 *
 * Rejections are typed, never thrown, and never partially applied: a rejected
 * spend leaves the caller's state untouched. Movement may be spent before or
 * after the action in the same turn — nothing here orders the costs.
 */
export const spendBudget = (
  state: CombatTurnState,
  combatantId: string,
  cost: CombatBudgetCost,
  amount?: number,
): SpendBudgetTransition => {
  const budget = state.budgets[combatantId];
  if (budget === undefined) {
    return { ok: false, reason: 'actorUnknown' };
  }

  if (cost === 'movement') {
    const step = amount ?? 1;
    if (!Number.isInteger(step) || step < 0) {
      return { ok: false, reason: 'pathInvalid' };
    }
    if (step > budget.movementRemaining) {
      return { ok: false, reason: 'movementBudgetExceeded' };
    }
    if (step === 0) {
      return { ok: true, state: cloneTurnState(state) };
    }
    return {
      ok: true,
      state: {
        ...cloneTurnState(state),
        budgets: {
          ...cloneValue(state.budgets),
          [combatantId]: { ...budget, movementRemaining: budget.movementRemaining - step },
        },
      },
    };
  }

  const reason = checkBudgetCost(budget, cost);
  if (reason !== null) {
    return { ok: false, reason };
  }

  const nextBudget: TurnBudget = { ...budget };
  if (cost === 'action') {
    nextBudget.actionAvailable = false;
  } else if (cost === 'quick') {
    nextBudget.quickActionAvailable = false;
  } else if (cost === 'reaction') {
    nextBudget.reactionAvailable = false;
  }

  return {
    ok: true,
    state: {
      ...cloneTurnState(state),
      budgets: { ...cloneValue(state.budgets), [combatantId]: nextBudget },
    },
  };
};
