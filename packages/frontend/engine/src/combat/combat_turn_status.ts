// packages/frontend/engine/src/combat/combat_turn_status.ts
//
// Projection: driver state → `CombatantTurnStatus[]` for the UI.
//
// A pure read of the driver's turn order plus the ECS components. Nothing here
// mutates state, so the projection can be asked for as often as a caller likes
// (every emit, every forced-end check) without affecting the fight.
//
// Split out of `combat_turn_driver.ts` so each module stays inside the
// source-file-size limit. `DriverState` is imported as a type only, so this
// module has no runtime dependency on the driver.
//
// Contract: C-516 AC-5

import type { CombatantTurnStatus } from '@aikami/types';
import type { World } from 'bitecs';
import { CombatStats } from '../components/combat_stats.ts';
import { StatusEffects } from '../components/status_effects.ts';
import { TurnOrder } from '../components/turn_order.ts';
import { initiativeOf, teamOf } from './combat_roster.ts';
import type { DriverState } from './combat_turn_driver.ts';

const teamFor = (state: DriverState, eid: number): CombatantTurnStatus['team'] =>
  teamOf(eid, state.playerEntityId);

const isDefeated = (state: DriverState, eid: number, hp: number): boolean => {
  if (TurnOrder.isActive[eid] !== true) {
    return true;
  }
  if (hp > 0) {
    return false;
  }
  // A downed combatant with pending death saves stays in the turn order.
  return !state.deathSaves.has(eid);
};

/** One combatant's status, as the turn tracker renders it. */
export const statusFor = (
  state: DriverState,
  world: World,
  eid: number,
  combatantId: string,
): CombatantTurnStatus => {
  const hp = CombatStats.health[eid] ?? 0;
  return {
    combatantId,
    initiative: initiativeOf(world, eid),
    team: teamFor(state, eid),
    hp,
    downed: hp <= 0,
    stunned: (StatusEffects.isStunned[eid] ?? 0) === 1,
    defeated: isDefeated(state, eid, hp),
  };
};

/** Every combatant in the current turn order, in order. */
export const allStatuses = (state: DriverState, world: World): CombatantTurnStatus[] => {
  const statuses: CombatantTurnStatus[] = [];
  for (const combatantId of state.turnState.order) {
    const eid = state.combatants.get(combatantId);
    if (eid === undefined) {
      continue;
    }
    statuses.push(statusFor(state, world, eid, combatantId));
  }
  return statuses;
};
