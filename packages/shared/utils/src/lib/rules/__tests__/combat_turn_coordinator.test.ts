// packages/shared/utils/src/lib/rules/__tests__/combat_turn_coordinator.test.ts
//
// AC-1: the pure turn coordinator is deterministic and owns turn order, round
//       and budgets.
// AC-3: budgets are real, spendable, and split-movement-aware.
//
// Contract: C-514 AC-1, AC-3

import { describe, expect, it } from 'bun:test';
import type { CombatantTurnStatus, CombatTurnState, TurnBudget } from '@aikami/types';
import { canonicalCombatJson } from '../combat_kernel';
import {
  beginTurn,
  checkBudgetCost,
  createTurnState,
  DEFAULT_MOVEMENT_PER_TURN,
  defaultTurnBudget,
  endTurn,
  getActiveTurn,
  getForcedEndReason,
  isExhausted,
  spendBudget,
} from '../combat_turn_coordinator';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const status = (
  combatantId: string,
  initiative: number,
  overrides: Partial<CombatantTurnStatus> = {},
): CombatantTurnStatus => ({
  combatantId,
  initiative,
  team: 'enemy',
  hp: 10,
  downed: false,
  stunned: false,
  defeated: false,
  ...overrides,
});

const party = (
  combatantId: string,
  initiative: number,
  overrides: Partial<CombatantTurnStatus> = {},
): CombatantTurnStatus => status(combatantId, initiative, { ...overrides, team: 'player' });

const clone = <T>(value: T): T => structuredClone(value);

const budgetOf = (state: CombatTurnState, id: string): TurnBudget => {
  const budget = state.budgets[id];
  if (budget === undefined) {
    throw new Error(`missing budget for ${id}`);
  }
  return budget;
};

/** Spends a cost that is expected to succeed, failing the test otherwise. */
const spend = (
  state: CombatTurnState,
  combatantId: string,
  cost: Parameters<typeof spendBudget>[2],
  amount?: number,
): CombatTurnState => {
  const result = spendBudget(state, combatantId, cost, amount);
  if (!result.ok) {
    throw new Error(`expected spend ${cost} to succeed, got ${result.reason}`);
  }
  return result.state;
};

// ---------------------------------------------------------------------------
// createTurnState
// ---------------------------------------------------------------------------

describe('createTurnState (AC-1)', () => {
  it('orders by initiative desc then combatantId asc', () => {
    const state = createTurnState([
      status('goblin', 10),
      status('ogre', 15),
      status('bat', 10),
      status('kobold', 5),
    ]);

    expect(state.order).toEqual(['ogre', 'bat', 'goblin', 'kobold']);
    expect(state.round).toBe(1);
    expect(state.activeIndex).toBe(0);
  });

  it('stamps turnId as r{round}:{combatantId} and gives every combatant a full budget', () => {
    const state = createTurnState([status('a', 20), status('b', 10)]);

    expect(state.turnId).toBe('r1:a');
    expect(state.budgets.a).toEqual(defaultTurnBudget());
    expect(state.budgets.b).toEqual(defaultTurnBudget());
  });

  it('honours a custom movement allowance', () => {
    const state = createTurnState([status('a', 20)], 3);
    expect(state.budgets.a?.movementRemaining).toBe(3);
  });

  it('returns an empty state with a null turnId for no combatants', () => {
    const state = createTurnState([]);
    expect(state.order).toEqual([]);
    expect(state.turnId).toBeNull();
    expect(getActiveTurn(state)).toBeNull();
  });

  it('does not mutate its input', () => {
    const entries = [status('b', 10), status('a', 20)];
    const before = clone(entries);
    createTurnState(entries);
    expect(entries).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// beginTurn
// ---------------------------------------------------------------------------

describe('beginTurn (AC-1)', () => {
  it('resets the active combatant budget and returns a budget change', () => {
    const state = createTurnState([status('a', 20), status('b', 10)]);
    const spent = spend(state, 'a', 'action');
    expect(budgetOf(spent, 'a').actionAvailable).toBe(false);

    const transition = beginTurn({
      state: spent,
      status: status('a', 20),
      trigger: 'encounter_start',
    });

    expect(transition.state.budgets.a).toEqual(defaultTurnBudget());
    expect(transition.budgetChanges).toEqual([{ combatantId: 'a', budget: defaultTurnBudget() }]);
    expect(transition.state.turnId).toBe('r1:a');
  });

  it('never mutates the input state', () => {
    const state = createTurnState([status('a', 20)]);
    const before = canonicalCombatJson(state);
    beginTurn({ state, status: status('a', 20), trigger: 'encounter_start' });
    expect(canonicalCombatJson(state)).toBe(before);
  });

  it('refuses to begin a defeated combatant turn', () => {
    const state = createTurnState([status('a', 20), status('b', 10)]);
    const transition = beginTurn({
      state,
      status: status('a', 20, { defeated: true }),
      trigger: 'encounter_start',
    });
    expect(transition.budgetChanges).toEqual([]);
    expect(transition.state.budgets.a).toEqual(state.budgets.a);
  });
});

// ---------------------------------------------------------------------------
// endTurn — advancement rules
// ---------------------------------------------------------------------------

describe('endTurn (AC-2)', () => {
  const roster = [party('hero', 20), status('goblin', 15), status('bat', 5)];

  const advance = (
    state: CombatTurnState,
    statuses: CombatantTurnStatus[] = roster,
    trigger: Parameters<typeof endTurn>[0]['trigger'] = 'explicit_end_turn',
    policy: Parameters<typeof endTurn>[0]['policy'] = 'manual',
  ): CombatTurnState => endTurn({ state, status: statuses, trigger, policy }).state;

  it('advances to the next combatant on explicit end turn', () => {
    const state = createTurnState(roster);
    const transition = endTurn({
      state,
      status: roster,
      trigger: 'explicit_end_turn',
      policy: 'manual',
    });

    expect(transition.state.activeIndex).toBe(1);
    expect(transition.state.turnId).toBe('r1:goblin');
    expect(transition.state.round).toBe(1);
    expect(transition.budgetChanges).toEqual([
      { combatantId: 'goblin', budget: defaultTurnBudget() },
    ]);
  });

  it('increments round only when wrapping past the last eligible combatant', () => {
    let state = createTurnState(roster);
    state = advance(state);
    state = advance(state);
    expect(state.round).toBe(1);
    expect(state.turnId).toBe('r1:bat');

    state = advance(state);
    expect(state.round).toBe(2);
    expect(state.activeIndex).toBe(0);
    expect(state.turnId).toBe('r2:hero');
  });

  it('skips defeated combatants without double-counting rounds', () => {
    const withDeadBat = roster.map((entry) =>
      entry.combatantId === 'bat' ? { ...entry, defeated: true, hp: 0 } : entry,
    );

    let state = createTurnState(roster);
    state = advance(state, withDeadBat);
    expect(state.turnId).toBe('r1:goblin');

    state = advance(state, withDeadBat);
    expect(state.turnId).toBe('r2:hero');
    expect(state.round).toBe(2);
  });

  it('clears turnId and reports the outcome when nobody can act', () => {
    const allDead = roster.map((entry) => ({ ...entry, defeated: true, hp: 0 }));
    const state = createTurnState(roster);
    const transition = endTurn({
      state,
      status: allDead,
      trigger: 'explicit_end_turn',
      policy: 'manual',
    });

    expect(transition.state.turnId).toBeNull();
    expect(transition.outcome).toEqual({ victory: false, reason: 'party_defeated' });
  });

  it('ignores auto_exhausted under the manual policy', () => {
    const state = createTurnState(roster);
    const transition = endTurn({
      state,
      status: roster,
      trigger: 'auto_exhausted',
      policy: 'manual',
    });

    expect(transition.state.activeIndex).toBe(state.activeIndex);
    expect(transition.state.turnId).toBe(state.turnId);
  });

  it('advances on auto_exhausted under the auto_when_exhausted policy', () => {
    const state = createTurnState(roster);
    expect(advance(state, roster, 'auto_exhausted', 'auto_when_exhausted').turnId).toBe(
      'r1:goblin',
    );
  });

  it('stops the loop on a forced end and reports the outcome', () => {
    const state = createTurnState(roster);
    const defeated = roster.map((entry) =>
      entry.team === 'enemy' ? { ...entry, defeated: true, hp: 0 } : entry,
    );
    const transition = endTurn({
      state,
      status: defeated,
      trigger: 'forced_defeat',
      policy: 'manual',
    });

    expect(transition.state.turnId).toBeNull();
    expect(transition.outcome).toEqual({ victory: true, reason: 'all_enemies_defeated' });
  });

  it('is byte-identical for identical inputs (canonical JSON)', () => {
    const first = endTurn({
      state: createTurnState(roster),
      status: roster,
      trigger: 'explicit_end_turn',
      policy: 'manual',
    });
    const second = endTurn({
      state: createTurnState(roster),
      status: roster,
      trigger: 'explicit_end_turn',
      policy: 'manual',
    });
    expect(canonicalCombatJson(first.state)).toBe(canonicalCombatJson(second.state));
  });

  it('never mutates the input state', () => {
    const state = createTurnState(roster);
    const before = canonicalCombatJson(state);
    advance(state);
    expect(canonicalCombatJson(state)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// getForcedEndReason
// ---------------------------------------------------------------------------

describe('getForcedEndReason (AC-2)', () => {
  it('returns null while both sides have a standing combatant', () => {
    expect(getForcedEndReason([party('hero', 20), status('goblin', 10)])).toBeNull();
  });

  it('prefers party_defeated on a mutual wipe', () => {
    expect(
      getForcedEndReason([
        party('hero', 20, { defeated: true, hp: 0 }),
        status('goblin', 10, { defeated: true, hp: 0 }),
      ]),
    ).toEqual({ victory: false, reason: 'party_defeated' });
  });

  it('reports all_enemies_defeated when only enemies are down', () => {
    expect(
      getForcedEndReason([party('hero', 20), status('goblin', 10, { downed: true, hp: 0 })]),
    ).toEqual({ victory: true, reason: 'all_enemies_defeated' });
  });

  it('accepts a single status', () => {
    expect(getForcedEndReason(status('goblin', 10, { defeated: true, hp: 0 }))).toEqual({
      victory: true,
      reason: 'all_enemies_defeated',
    });
  });
});

// ---------------------------------------------------------------------------
// spendBudget (AC-3)
// ---------------------------------------------------------------------------

describe('spendBudget (AC-3)', () => {
  const fresh = (): CombatTurnState => createTurnState([party('hero', 20), status('goblin', 10)]);

  it('rejects a second action with noActionAvailable and does not partially apply', () => {
    const state = fresh();
    const first = spendBudget(state, 'hero', 'action');
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }

    const second = spendBudget(first.state, 'hero', 'action');
    expect(second.ok).toBe(false);
    if (second.ok) {
      return;
    }
    expect(second.reason).toBe('noActionAvailable');
    // The rejected spend left the state exactly as the successful one did.
    expect(canonicalCombatJson(first.state)).toBe(
      canonicalCombatJson({
        ...clone(state),
        budgets: {
          ...clone(state.budgets),
          hero: { ...budgetOf(state, 'hero'), actionAvailable: false },
        },
      }),
    );
  });

  it('rejects a reaction with noActionAvailable (reactions are Combat-08)', () => {
    const result = spendBudget(fresh(), 'hero', 'reaction');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('noActionAvailable');
    }
    expect(checkBudgetCost(defaultTurnBudget(), 'reaction')).toBe('noActionAvailable');
  });

  it('rejects a quick action that was already spent', () => {
    const state = spend(fresh(), 'hero', 'quick');
    const result = spendBudget(state, 'hero', 'quick');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('noActionAvailable');
    }
  });

  it('rejects over-spending movement with movementBudgetExceeded', () => {
    const result = spendBudget(fresh(), 'hero', 'movement', DEFAULT_MOVEMENT_PER_TURN + 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('movementBudgetExceeded');
    }
  });

  it('allows movement before and after the action in the same turn', () => {
    const before = spend(fresh(), 'hero', 'movement', 2);
    expect(budgetOf(before, 'hero').movementRemaining).toBe(DEFAULT_MOVEMENT_PER_TURN - 2);

    const after = spend(spend(before, 'hero', 'action'), 'hero', 'movement', 4);
    expect(budgetOf(after, 'hero').movementRemaining).toBe(0);
    expect(budgetOf(after, 'hero').actionAvailable).toBe(false);
  });

  it('rejects an unknown combatant with actorUnknown', () => {
    const result = spendBudget(fresh(), 'nobody', 'action');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('actorUnknown');
    }
  });

  it('never mutates the input state', () => {
    const state = fresh();
    const before = canonicalCombatJson(state);
    spendBudget(state, 'hero', 'action');
    spendBudget(state, 'hero', 'movement', 3);
    expect(canonicalCombatJson(state)).toBe(before);
  });

  it('treats free costs as spendable without consuming anything', () => {
    const state = fresh();
    const result = spendBudget(state, 'hero', 'free');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(canonicalCombatJson(result.state)).toBe(canonicalCombatJson(state));
    }
  });
});

// ---------------------------------------------------------------------------
// isExhausted
// ---------------------------------------------------------------------------

describe('isExhausted (AC-2)', () => {
  it('is false for a fresh budget', () => {
    expect(isExhausted(createTurnState([party('hero', 20)]), 'hero')).toBe(false);
  });

  it('is true once movement, action and quick are gone — the disabled reaction does not block it', () => {
    let state = createTurnState([party('hero', 20)]);
    state = spend(state, 'hero', 'movement', DEFAULT_MOVEMENT_PER_TURN);
    state = spend(state, 'hero', 'action');
    state = spend(state, 'hero', 'quick');

    expect(state.budgets.hero?.reactionAvailable).toBe(true);
    expect(isExhausted(state, 'hero')).toBe(true);
  });

  it('is false while movement remains', () => {
    let state = createTurnState([party('hero', 20)]);
    state = spend(state, 'hero', 'movement', DEFAULT_MOVEMENT_PER_TURN - 1);
    state = spend(state, 'hero', 'action');
    state = spend(state, 'hero', 'quick');
    expect(isExhausted(state, 'hero')).toBe(false);
  });

  it('is true for an unknown combatant', () => {
    expect(isExhausted(createTurnState([party('hero', 20)]), 'ghost')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getActiveTurn
// ---------------------------------------------------------------------------

describe('getActiveTurn (AC-1)', () => {
  it('reports the active combatant, turnId and round', () => {
    const state = createTurnState([party('hero', 20), status('goblin', 10)]);
    expect(getActiveTurn(state)).toEqual({ combatantId: 'hero', turnId: 'r1:hero', round: 1 });
  });

  it('returns null when the turn id was cleared', () => {
    const state = createTurnState([party('hero', 20)]);
    expect(getActiveTurn({ ...state, turnId: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Per-combatant movement allowance (C-515 AC-6)
// ---------------------------------------------------------------------------

describe('per-combatant movement allowance (C-515 AC-6)', () => {
  /** Only `fast` has an explicit allowance; everyone else takes the default. */
  const allowanceFor = (combatantId: string): number | undefined =>
    combatantId === 'fast' ? 9 : undefined;

  it('createTurnState seeds each combatant with its own allowance', () => {
    const state = createTurnState(
      [party('hero', 20), status('fast', 10)],
      DEFAULT_MOVEMENT_PER_TURN,
      allowanceFor,
    );
    expect(budgetOf(state, 'hero').movementRemaining).toBe(DEFAULT_MOVEMENT_PER_TURN);
    expect(budgetOf(state, 'fast').movementRemaining).toBe(9);
  });

  it('endTurn restores the ADVANCED combatant allowance, not a global constant', () => {
    const state = createTurnState(
      [party('hero', 20), status('fast', 10)],
      DEFAULT_MOVEMENT_PER_TURN,
      allowanceFor,
    );
    // Spend the hero's whole allowance, then hand the turn over.
    const spent = spendBudget(state, 'hero', 'movement', DEFAULT_MOVEMENT_PER_TURN);
    expect(spent.ok).toBe(true);
    if (!spent.ok) {
      return;
    }

    const transition = endTurn({
      state: spent.state,
      status: [party('hero', 20), status('fast', 10)],
      trigger: 'explicit_end_turn',
      policy: 'manual',
      movementPerTurn: DEFAULT_MOVEMENT_PER_TURN,
      movementPerTurnFor: allowanceFor,
    });

    expect(getActiveTurn(transition.state)?.combatantId).toBe('fast');
    expect(budgetOf(transition.state, 'fast').movementRemaining).toBe(9);
    expect(transition.budgetChanges).toEqual([
      { combatantId: 'fast', budget: defaultTurnBudget(9) },
    ]);
  });

  it('beginTurn honours the per-combatant allowance', () => {
    const state = createTurnState([status('fast', 20), party('hero', 10)]);
    const transition = beginTurn({
      state,
      status: [status('fast', 20), party('hero', 10)],
      trigger: 'encounter_start',
      movementPerTurn: DEFAULT_MOVEMENT_PER_TURN,
      movementPerTurnFor: allowanceFor,
    });
    expect(budgetOf(transition.state, 'fast').movementRemaining).toBe(9);
  });

  it('falls back to the call-level value when no resolver is supplied', () => {
    const state = createTurnState([party('hero', 20), status('fast', 10)], 4);
    expect(budgetOf(state, 'hero').movementRemaining).toBe(4);
    expect(budgetOf(state, 'fast').movementRemaining).toBe(4);
  });

  it('spendBudget rejects an over-spend of a per-combatant allowance', () => {
    const state = createTurnState([status('fast', 20)], DEFAULT_MOVEMENT_PER_TURN, allowanceFor);
    const overSpend = spendBudget(state, 'fast', 'movement', 10);
    expect(overSpend.ok).toBe(false);
    if (!overSpend.ok) {
      expect(overSpend.reason).toBe('movementBudgetExceeded');
    }
  });
});
