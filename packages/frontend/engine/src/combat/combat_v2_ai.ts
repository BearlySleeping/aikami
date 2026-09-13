// packages/frontend/engine/src/combat/combat_v2_ai.ts
//
// Deterministic AI turns for the v2 resolver (Combat-04).
//
// The v2 kernel owns turn order and resolution; the legacy `runAiTurn` hook
// belongs to the legacy resolver and must never run inside a v2 encounter (it
// would mutate the same ECS state and double-emit). This module is the v2
// replacement: it picks a KERNEL command for the active AI combatant and
// commits it through the same single commit path the player uses, so companion
// and enemy turns resolve under the deterministic engine.
//
// The policy is small and fully deterministic — no RNG of its own, no
// pathfinding library, no invented mechanics:
//   1. Attack the legal hostile target with the lowest HP (tie-break: id).
//   2. Otherwise step toward the nearest hostile using the SAME reachability
//      projection the preview reports, so the committed path is legal.
//   3. Otherwise defend (spending the action), then end the turn.
//
// Contract: C-516 AC-5, AC-10

import type { CombatAbilityDefinition, CombatCommand, CombatState, GridPoint } from '@aikami/types';
import { findCombatPathToCell, getLegalActions } from '@aikami/utils';
import type { World } from 'bitecs';
import { logger } from '$logger';
import type { EngineBridge } from '../engine_bridge.ts';
import { getActiveTurn } from './combat_turn_driver.ts';
import {
  buildV2CombatState,
  commitV2KernelCommand,
  DEFAULT_BASIC_ATTACK_ABILITY_ID,
} from './combat_v2_resolver.ts';

/** How many actions one AI combatant may take before it must end its turn. */
const AI_ACTIONS_PER_TURN = 4;

/** Outer guard: an encounter can never need more AI turns than this. */
const AI_TURN_GUARD = 64;

const manhattan = (a: GridPoint, b: GridPoint): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

const isHostileTo = (actorTeam: string, targetTeam: string): boolean =>
  actorTeam === 'player' || actorTeam === 'ally'
    ? targetTeam === 'enemy'
    : targetTeam === 'player' || targetTeam === 'ally';

const isAttackAbility = (ability: CombatAbilityDefinition | undefined): boolean =>
  ability !== undefined && (ability.kind === 'melee_attack' || ability.kind === 'ranged_attack');

/**
 * The attack abilities a combatant may use, in a deterministic order.
 *
 * The basic attack always leads so an AI without a mapped class ability still
 * acts; the rest follow in catalog-id order.
 */
export const aiAttackAbilityIds = (options: {
  state: CombatState;
  combatantId: string;
  abilityCatalog: Record<string, CombatAbilityDefinition>;
  basicAttackAbilityId: string;
}): string[] => {
  const { state, combatantId, abilityCatalog, basicAttackAbilityId } = options;
  const actor = state.combatants[combatantId];
  if (actor === undefined) {
    return [];
  }
  const ordered: string[] = [];
  if (
    actor.abilityIds.includes(basicAttackAbilityId) &&
    isAttackAbility(abilityCatalog[basicAttackAbilityId])
  ) {
    ordered.push(basicAttackAbilityId);
  }
  for (const abilityId of [...actor.abilityIds].sort()) {
    if (ordered.includes(abilityId) || !isAttackAbility(abilityCatalog[abilityId])) {
      continue;
    }
    ordered.push(abilityId);
  }
  return ordered;
};

/** The best legal hostile target for one ability, or `undefined`. */
const bestTargetFor = (options: {
  state: CombatState;
  combatantId: string;
  abilityId: string;
  legalTargetIds: readonly string[];
}): string | undefined => {
  const { state, combatantId, legalTargetIds } = options;
  const actor = state.combatants[combatantId];
  if (actor === undefined) {
    return undefined;
  }
  const hostiles = legalTargetIds.filter((targetId) => {
    const target = state.combatants[targetId];
    return target !== undefined && !target.defeated && isHostileTo(actor.team, target.team);
  });
  if (hostiles.length === 0) {
    return undefined;
  }
  return [...hostiles].sort((a, b) => {
    const targetA = state.combatants[a];
    const targetB = state.combatants[b];
    if (targetA === undefined || targetB === undefined) {
      return 0;
    }
    return targetA.hp - targetB.hp || (a < b ? -1 : 1);
  })[0];
};

/** The reachable endpoint that most reduces distance to the nearest hostile. */
export const bestApproachCell = (options: {
  state: CombatState;
  combatantId: string;
  endpoints: readonly GridPoint[];
}): GridPoint | null => {
  const { state, combatantId, endpoints } = options;
  const actor = state.combatants[combatantId];
  if (actor === undefined) {
    return null;
  }
  const hostiles = Object.values(state.combatants).filter(
    (combatant) => !combatant.defeated && isHostileTo(actor.team, combatant.team),
  );
  if (hostiles.length === 0) {
    return null;
  }

  const distanceTo = (from: GridPoint): number =>
    Math.min(...hostiles.map((hostile) => manhattan(from, hostile.position)));

  let best: GridPoint | null = null;
  let bestDistance = distanceTo(actor.position);
  for (const endpoint of endpoints) {
    const distance = distanceTo(endpoint);
    if (distance < bestDistance) {
      best = endpoint;
      bestDistance = distance;
    }
  }
  return best;
};

/** The move command for an AI that is out of range, or `null` when stuck. */
const chooseApproachCommand = (options: {
  state: CombatState;
  combatantId: string;
}): CombatCommand | null => {
  const { state, combatantId } = options;
  const actor = state.combatants[combatantId];
  if (actor === undefined || actor.budget.movementRemaining <= 0) {
    return null;
  }
  const actions = getLegalActions({ state, combatantId });
  const target = bestApproachCell({ state, combatantId, endpoints: actions.endpoints });
  if (target === null) {
    return null;
  }
  const path = findCombatPathToCell({ state, combatantId, to: target });
  if (path === null) {
    return null;
  }
  return { kind: 'move', combatantId, path };
};

/**
 * Chooses the next kernel command for the active AI combatant.
 *
 * Pure: a function of the projected state only, so the same state always picks
 * the same command — determinism is a contract requirement (AC-10).
 */
export const chooseV2AiCommand = (options: {
  state: CombatState;
  combatantId: string;
  abilityCatalog: Record<string, CombatAbilityDefinition>;
  basicAttackAbilityId: string;
}): CombatCommand => {
  const { state, combatantId, abilityCatalog, basicAttackAbilityId } = options;
  const actor = state.combatants[combatantId];
  if (actor === undefined) {
    return { kind: 'endTurn', combatantId };
  }

  const actions = getLegalActions({ state, combatantId });

  for (const abilityId of aiAttackAbilityIds({
    state,
    combatantId,
    abilityCatalog,
    basicAttackAbilityId,
  })) {
    const targetId = bestTargetFor({
      state,
      combatantId,
      abilityId,
      legalTargetIds: actions.targetsByAbility[abilityId] ?? [],
    });
    if (targetId === undefined) {
      continue;
    }
    return { kind: 'useAbility', combatantId, abilityId, targetIds: [targetId] };
  }

  const approach = chooseApproachCommand({ state, combatantId });
  if (approach !== null) {
    return approach;
  }

  if (actor.budget.actionAvailable) {
    return { kind: 'defend', combatantId };
  }

  return { kind: 'endTurn', combatantId };
};

export type RunV2AiTurnsOptions = {
  world: World;
  bridge: EngineBridge;
  abilityCatalog: Record<string, CombatAbilityDefinition>;
  /** Runtime eid of the player entity — its turns are never AI-driven. */
  playerEntityId: number;
  abilityIdsByCombatant?: Record<string, string[]>;
  basicAttackAbilityId?: string;
};

/**
 * Runs every AI combatant's turn until a player-controlled combatant is active
 * or the encounter ends.
 *
 * Called after the encounter starts and after each v2 commit, so a full round
 * resolves without any per-action engine branch.
 */
export const runV2AiTurns = (options: RunV2AiTurnsOptions): void => {
  const { world, bridge, abilityCatalog, playerEntityId } = options;
  const basicAttackAbilityId = options.basicAttackAbilityId ?? DEFAULT_BASIC_ATTACK_ABILITY_ID;

  const project = (): CombatState | null =>
    buildV2CombatState({
      world,
      abilityCatalog,
      ...(options.abilityIdsByCombatant === undefined
        ? {}
        : { abilityIdsByCombatant: options.abilityIdsByCombatant }),
    });

  for (let turn = 0; turn < AI_TURN_GUARD; turn++) {
    const active = getActiveTurn(world);
    if (active === null || active.entityId === playerEntityId) {
      return;
    }
    const turnCombatantId = active.combatantId;

    for (let action = 0; action < AI_ACTIONS_PER_TURN; action++) {
      const state = project();
      if (state === null) {
        return;
      }
      const activeId = state.initiative.order[state.initiative.activeIndex];
      if (activeId === undefined) {
        return;
      }
      const actor = state.combatants[activeId];
      if (actor === undefined || actor.defeated) {
        break;
      }

      const command = chooseV2AiCommand({
        state,
        combatantId: activeId,
        abilityCatalog,
        basicAttackAbilityId,
      });
      const resolved = commitV2KernelCommand({ world, bridge, state, command });
      if (!resolved.ok) {
        // A rejected AI command must never wedge the encounter: log it and end
        // the turn so the next combatant acts.
        logger.warn('[combat_v2_ai] command rejected', {
          combatantId: activeId,
          reasonCode: resolved.reasonCode,
        });
        break;
      }
      if (resolved.state.phase === 'ended') {
        return;
      }
      if (command.kind === 'endTurn') {
        break;
      }
    }

    // The action cap was reached without an explicit end turn (a move does not
    // consume the turn). End it so the round can advance.
    const after = getActiveTurn(world);
    if (after === null) {
      return;
    }
    if (after.combatantId === turnCombatantId) {
      const state = project();
      if (state === null) {
        return;
      }
      const resolved = commitV2KernelCommand({
        world,
        bridge,
        state,
        command: { kind: 'endTurn', combatantId: after.combatantId },
      });
      if (resolved.ok && resolved.state.phase === 'ended') {
        return;
      }
    }
  }

  logger.warn('[combat_v2_ai] AI turn guard reached');
};
