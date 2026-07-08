// apps/frontend/client/src/lib/views/combat/tests/turn_tracker.test.ts
// C-234 Turn Tracker — unit tests for TurnState machine and ActionEconomy
//
// Tests:
// - TurnState structure and transitions
// - ActionEconomy dot state
// - Turn number increment

import { describe, expect, test } from 'bun:test';
import type { ActionEconomy, TurnState } from '../types/combat_enhancements.ts';

// ── Helpers ───────────────────────────────────────────────────────────────

const createTurnState = (overrides?: Partial<TurnState>): TurnState => ({
  currentEntityId: 1,
  currentEntityName: 'Player',
  isPlayerTurn: true,
  actionEconomy: { action: false, bonusAction: false, reaction: false },
  turnNumber: 1,
  ...overrides,
});

const createActionEconomy = (overrides?: Partial<ActionEconomy>): ActionEconomy => ({
  action: false,
  bonusAction: false,
  reaction: false,
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('TurnState', () => {
  test('should start with default state', () => {
    const state = createTurnState();

    expect(state.currentEntityId).toBe(1);
    expect(state.currentEntityName).toBe('Player');
    expect(state.isPlayerTurn).toBe(true);
    expect(state.turnNumber).toBe(1);
    expect(state.actionEconomy.action).toBe(false);
    expect(state.actionEconomy.bonusAction).toBe(false);
    expect(state.actionEconomy.reaction).toBe(false);
  });

  test('should represent enemy turn', () => {
    const state = createTurnState({
      currentEntityId: 2,
      currentEntityName: 'Goblin',
      isPlayerTurn: false,
    });

    expect(state.isPlayerTurn).toBe(false);
    expect(state.currentEntityName).toBe('Goblin');
    expect(state.currentEntityId).toBe(2);
  });

  test('should increment turn number', () => {
    const state1 = createTurnState({ turnNumber: 1 });
    const state2 = { ...state1, turnNumber: state1.turnNumber + 1 };

    expect(state2.turnNumber).toBe(2);
  });

  test('should be immutable-style (new objects on transition)', () => {
    const state1 = createTurnState();
    const state2: TurnState = {
      ...state1,
      isPlayerTurn: false,
      actionEconomy: { action: true, bonusAction: true, reaction: false },
      turnNumber: 2,
    };

    // Original unchanged
    expect(state1.isPlayerTurn).toBe(true);
    expect(state1.actionEconomy.action).toBe(false);
    expect(state1.turnNumber).toBe(1);

    // New has updates
    expect(state2.isPlayerTurn).toBe(false);
    expect(state2.actionEconomy.action).toBe(true);
    expect(state2.turnNumber).toBe(2);
  });

  test('should update action economy dots independently', () => {
    const state = createTurnState();

    // Use action
    const afterAction: TurnState = {
      ...state,
      actionEconomy: { ...state.actionEconomy, action: true },
    };
    expect(afterAction.actionEconomy.action).toBe(true);
    expect(afterAction.actionEconomy.bonusAction).toBe(false);
    expect(afterAction.actionEconomy.reaction).toBe(false);

    // Use bonus action
    const afterBonus: TurnState = {
      ...afterAction,
      actionEconomy: { ...afterAction.actionEconomy, bonusAction: true },
    };
    expect(afterBonus.actionEconomy.action).toBe(true);
    expect(afterBonus.actionEconomy.bonusAction).toBe(true);
    expect(afterBonus.actionEconomy.reaction).toBe(false);
  });
});

describe('ActionEconomy', () => {
  test('should start with all actions available', () => {
    const economy = createActionEconomy();

    expect(economy.action).toBe(false); // available
    expect(economy.bonusAction).toBe(false);
    expect(economy.reaction).toBe(false);
  });

  test('should track consumed actions', () => {
    const economy = createActionEconomy({ action: true, bonusAction: false, reaction: false });

    expect(economy.action).toBe(true); // consumed
    expect(economy.bonusAction).toBe(false);
    expect(economy.reaction).toBe(false);
  });

  test('should track all actions consumed', () => {
    const economy = createActionEconomy({ action: true, bonusAction: true, reaction: true });

    expect(economy.action).toBe(true);
    expect(economy.bonusAction).toBe(true);
    expect(economy.reaction).toBe(true);
  });

  test('should be reset on new turn', () => {
    // New turn — all actions reset to available
    const newTurn = createActionEconomy({ action: false, bonusAction: false, reaction: false });

    expect(newTurn.action).toBe(false);
    expect(newTurn.bonusAction).toBe(false);
    expect(newTurn.reaction).toBe(false);
  });
});

describe('TurnState — player/enemy detection', () => {
  test('should detect player turn by entity id', () => {
    const isPlayerTurn = (state: TurnState): boolean => state.currentEntityId === 1;

    expect(isPlayerTurn(createTurnState({ currentEntityId: 1 }))).toBe(true);
    expect(isPlayerTurn(createTurnState({ currentEntityId: 2 }))).toBe(false);
    expect(isPlayerTurn(createTurnState({ currentEntityId: 99 }))).toBe(false);
  });

  test('should handle multiple turns', () => {
    const states: TurnState[] = [
      createTurnState({ turnNumber: 1, currentEntityId: 1, isPlayerTurn: true }),
      createTurnState({ turnNumber: 2, currentEntityId: 2, isPlayerTurn: false }),
      createTurnState({ turnNumber: 3, currentEntityId: 1, isPlayerTurn: true }),
    ];

    expect(states[0].turnNumber).toBe(1);
    expect(states[1].turnNumber).toBe(2);
    expect(states[2].turnNumber).toBe(3);

    // Toggle pattern: Player → Enemy → Player
    expect(states[0].isPlayerTurn).toBe(true);
    expect(states[1].isPlayerTurn).toBe(false);
    expect(states[2].isPlayerTurn).toBe(true);
  });
});
