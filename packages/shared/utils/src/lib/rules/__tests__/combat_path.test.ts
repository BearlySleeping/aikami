// packages/shared/utils/src/lib/rules/__tests__/combat_path.test.ts
//
// C-516 AC-8 — `findCombatPathToCell`.
//
// The move commit addresses a DESTINATION CELL and the engine reconstructs the
// path from the same reachability projection the preview reported, so "the
// committed path equals the previewed path" is a property of this function.
//
// Contract: C-516 AC-8

import { describe, expect, it } from 'bun:test';
import type { BattlefieldState, CombatState } from '@aikami/types';
import { createCombatState } from '../combat_kernel';
import { pathTraversalCost } from '../combat_spatial';
import { findCombatPathToCell, getLegalActions } from '../combat_tactical';
import { BATTLEFIELD, createInput, GOBLIN_1, PLAYER_ID } from './combat_fixtures';

/**
 * The shared fixture state, with the player standing on a chosen cell and the
 * goblins moved out of the way so the reachable set is the terrain's, not the
 * occupancy's.
 */
const stateWithPlayerAt = (options: {
  at: { x: number; y: number };
  battlefield?: BattlefieldState;
}): CombatState => {
  const state = createCombatState(createInput());
  const player = state.combatants[PLAYER_ID];
  if (player === undefined) {
    throw new Error('fixture is missing the player combatant');
  }
  player.position = { ...options.at };
  player.budget = {
    movementRemaining: 6,
    actionAvailable: true,
    quickActionAvailable: true,
    reactionAvailable: true,
  };
  const goblin = state.combatants[GOBLIN_1];
  if (goblin !== undefined) {
    goblin.position = { x: 7, y: 7 };
  }
  if (options.battlefield !== undefined) {
    state.battlefield = options.battlefield;
  }
  return state;
};

describe('C-516 AC-8: findCombatPathToCell reconstructs the previewed path', () => {
  it('returns a contiguous orthogonal path ending on the clicked cell', () => {
    const state = stateWithPlayerAt({ at: { x: 1, y: 1 } });
    const path = findCombatPathToCell({
      state,
      combatantId: PLAYER_ID,
      to: { x: 3, y: 1 },
    });

    expect(path).not.toBeNull();
    if (path === null) {
      return;
    }
    expect(path[path.length - 1]).toEqual({ x: 3, y: 1 });
    // Starts adjacent to the actor (the kernel's first-step rule).
    expect(Math.abs((path[0]?.x ?? 0) - 1) + Math.abs((path[0]?.y ?? 0) - 1)).toBe(1);
    for (let index = 1; index < path.length; index++) {
      const previous = path[index - 1];
      const current = path[index];
      if (previous === undefined || current === undefined) {
        continue;
      }
      expect(Math.abs(previous.x - current.x) + Math.abs(previous.y - current.y)).toBe(1);
    }
  });

  it('costs exactly what the preview reported for that endpoint', () => {
    const state = stateWithPlayerAt({ at: { x: 1, y: 1 } });
    const destination = { x: 3, y: 2 };
    const actions = getLegalActions({ state, combatantId: PLAYER_ID });
    const previewCost = actions.costTo[`${destination.x},${destination.y}`];
    expect(previewCost).toBeDefined();

    const path = findCombatPathToCell({ state, combatantId: PLAYER_ID, to: destination });
    expect(path).not.toBeNull();
    if (path === null) {
      return;
    }
    expect(pathTraversalCost({ battlefield: state.battlefield, path })).toBe(previewCost);
  });

  it('returns null for an unreachable cell (never a fabricated path)', () => {
    const state = stateWithPlayerAt({
      at: { x: 1, y: 1 },
      // A one-cell battlefield: nothing is reachable.
      battlefield: { width: 1, height: 1, blockedCells: [] },
    });
    expect(findCombatPathToCell({ state, combatantId: PLAYER_ID, to: { x: 5, y: 5 } })).toBeNull();
  });

  it('returns null when the destination is the cell the actor is standing on', () => {
    const state = stateWithPlayerAt({ at: { x: 1, y: 1 } });
    expect(findCombatPathToCell({ state, combatantId: PLAYER_ID, to: { x: 1, y: 1 } })).toBeNull();
  });

  it('returns null for an occupied destination', () => {
    const state = stateWithPlayerAt({ at: { x: 1, y: 1 } });
    const goblin = state.combatants[GOBLIN_1];
    if (goblin === undefined) {
      throw new Error('fixture is missing the goblin combatant');
    }
    expect(
      findCombatPathToCell({ state, combatantId: PLAYER_ID, to: { ...goblin.position } }),
    ).toBeNull();
  });

  it('never mutates the state it was given', () => {
    const state = stateWithPlayerAt({ at: { x: 1, y: 1 } });
    const before = JSON.stringify(state);
    findCombatPathToCell({ state, combatantId: PLAYER_ID, to: { x: 2, y: 1 } });
    expect(JSON.stringify(state)).toBe(before);
  });

  it('the fixture battlefield is the shared 8×8 map', () => {
    expect(BATTLEFIELD.width).toBe(8);
  });
});
