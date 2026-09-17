// packages/shared/utils/src/lib/rules/combat_kernel_turns.ts
//
// The kernel's projection between a `CombatState` and the turn coordinator's
// `CombatTurnState`, plus the deterministic turn advance.
//
// A LEAF module: it reads only the combat wire types and the turn coordinator.
// Extracted from `combat_kernel.ts` so the kernel stays the command pipeline.
// Behaviour is unchanged.
//
// Contract: C-509 AC-1, C-514 AC-4

import type { CombatantTurnStatus, CombatState, CombatTurnState, TurnBudget } from '@aikami/types';
import { stillContestsEncounter } from './combat_morale';
import { endTurn, getActiveTurn } from './combat_turn_coordinator';

type TurnAdvance = { combatantId: string; round: number; turnId: string };

const turnStatusesFromState = (state: CombatState): CombatantTurnStatus[] =>
  Object.values(state.combatants).map((combatant) => ({
    combatantId: combatant.combatantId,
    initiative: combatant.initiative,
    team: combatant.team,
    hp: combatant.hp,
    downed: combatant.downed,
    // `CombatantState` carries no stun flag — stun lives in the engine's
    // `StatusEffects` component and is a driver-level skip rule.
    stunned: false,
    // A surrendered or escaped actor keeps its HP and identity but no longer
    // takes turns, so the coordinator skips it. The projection is read-only —
    // `combatant.defeated` is never rewritten. Contract: C-532 AC-2.
    defeated:
      combatant.defeated ||
      !stillContestsEncounter(state.participation[combatant.combatantId]?.status ?? 'active'),
  }));

export const turnStateFromState = (state: CombatState): CombatTurnState => {
  const budgets: Record<string, TurnBudget> = {};
  for (const combatant of Object.values(state.combatants)) {
    budgets[combatant.combatantId] = { ...combatant.budget };
  }
  return {
    order: [...state.initiative.order],
    activeIndex: state.initiative.activeIndex,
    round: state.round,
    turnId: state.turnId,
    budgets,
  };
};

/**
 * Advances the active index, skipping defeated combatants and wrapping rounds.
 *
 * Delegates the ordering/round/budget reset to the pure coordinator and writes
 * only the resulting fields back onto the kernel's state — the kernel never
 * re-implements turn sequencing.
 */
export const advanceTurn = (state: CombatState): TurnAdvance | null => {
  const transition = endTurn({
    state: turnStateFromState(state),
    status: turnStatusesFromState(state),
    trigger: 'explicit_end_turn',
    policy: 'manual',
  });
  const next = transition.state;
  const advanced = next.turnId === null ? null : getActiveTurn(next);
  if (advanced === null) {
    return null;
  }

  state.initiative.activeIndex = next.activeIndex;
  state.round = next.round;
  state.turnId = next.turnId;
  for (const change of transition.budgetChanges) {
    const combatant = state.combatants[change.combatantId];
    if (combatant !== undefined) {
      combatant.budget = change.budget;
    }
  }

  return { combatantId: advanced.combatantId, round: advanced.round, turnId: advanced.turnId };
};
