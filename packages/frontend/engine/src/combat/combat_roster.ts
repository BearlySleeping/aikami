// packages/frontend/engine/src/combat/combat_roster.ts
//
// Combat roster discovery — the "who is in this fight" half of the turn
// driver. Resolves the live participants of a world, classifies each by team
// and controller, and derives the stable `combatantId` the turn coordinator
// keys on.
//
// Extracted from `combat_turn_driver.ts` (C-515) so the driver stays inside
// the source-file-size budget. These helpers deliberately own no per-world
// state: every one is a pure read of the ECS world plus the adapter's identity
// registry, which is why they can live outside the driver's `DriverState`.
//
// Contract: C-514 AC-2; C-515 AC-6

import type { CombatantTurnStatus } from '@aikami/types';
import type { World } from 'bitecs';
import { getComponent, query } from 'bitecs';
import { CombatStats } from '../components/combat_stats.ts';
import { Companion } from '../components/companion.ts';
import type { TurnOrderData } from '../components/turn_order.ts';
import { TurnOrder } from '../components/turn_order.ts';
import {
  deriveCombatantId,
  getCombatIdentityRegistry,
  registerCombatantIdentity,
} from './combat_state_adapter.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Who decides a combatant's turn. */
export type ControllerKind = 'player' | 'companion_ai' | 'enemy_ai';

// ---------------------------------------------------------------------------
// Roster discovery
// ---------------------------------------------------------------------------

/** Initiative value for one entity, `0` when it carries no turn-order component. */
export const initiativeOf = (world: World, eid: number): number => {
  const turnOrder = getComponent(world, eid, TurnOrder) as TurnOrderData | undefined;
  return turnOrder?.initiativeValue ?? 0;
};

/**
 * Live combat participants in deterministic initiative order: initiative desc,
 * eid asc as the tiebreak (mirrors `initCombat`'s historical ordering).
 */
export const collectParticipants = (world: World): number[] => {
  const participants: number[] = [];
  for (const eid of query(world, [CombatStats, TurnOrder])) {
    if (eid <= 0) {
      continue;
    }
    const turnOrder = getComponent(world, eid, TurnOrder) as TurnOrderData | undefined;
    if (turnOrder?.isActive !== true) {
      continue;
    }
    participants.push(eid);
  }
  return participants.sort((a, b) => {
    const diff = initiativeOf(world, b) - initiativeOf(world, a);
    return diff !== 0 ? diff : a - b;
  });
};

/**
 * Which controller drives one entity's turn.
 *
 * A recruited companion in `'direct'` control mode is PLAYER-controlled
 * (C-526 §12.5): the player owns its turn through the same direct controls as
 * their own, so the AI turn runner must not consume it. Every other mode leaves
 * the turn AI-driven — the control mode is a preference, not a second rules
 * path, and the commands still flow through the same kernel.
 */
export const controllerFor = (
  eid: number,
  playerEntityId: number,
  companionControlMode?: string,
): ControllerKind => {
  if (eid === playerEntityId) {
    return 'player';
  }
  if (Companion.recruited[eid] === true) {
    const mode = companionControlMode ?? Companion.controlMode[eid];
    return mode === 'direct' ? 'player' : 'companion_ai';
  }
  return 'enemy_ai';
};

/**
 * Whether the player owns this entity's turn — the player themself or a
 * `direct`-mode companion.
 *
 * The v2 AI runner stops on this predicate instead of comparing against the
 * player's runtime eid, which is what makes Direct mode a real runtime effect
 * rather than a persisted field nobody reads.
 */
export const isPlayerControlled = (eid: number, playerEntityId: number): boolean =>
  controllerFor(eid, playerEntityId) === 'player';

/**
 * Team classification for one entity.
 *
 * Shared by the initial roster build (`startCombatTurns`, which runs before a
 * `DriverState` exists) and the live projection (`teamFor`), so the two can
 * never disagree on who is on which side.
 */
export const teamOf = (eid: number, playerEntityId: number): CombatantTurnStatus['team'] => {
  if (eid === playerEntityId) {
    return 'player';
  }
  if (Companion.recruited[eid] === true) {
    return 'ally';
  }
  return 'enemy';
};

/**
 * Resolves the stable combatant id for a participant: the adapter's identity
 * registry first, then the adapter's authored-id derivation. Never a raw eid.
 */
export const resolveCombatantId = (
  world: World,
  eid: number,
  index: number,
  options: { encounterId: string; playerCombatantId: string; playerEntityId: number },
): string => {
  const registry = getCombatIdentityRegistry(world);
  // C-516: encounter start writes `CombatIdentity` on the spawned entities, so
  // the registry must be reconciled before the lookup or every authored
  // combatant id would silently fall back to the derived id.
  registry.sync(world);
  const mapped = registry.toCombatantId(eid);
  if (mapped !== null && mapped !== '') {
    return mapped;
  }
  const derived = deriveCombatantId({
    entityId: eid,
    encounterId: options.encounterId,
    playerCombatantId: options.playerCombatantId,
    playerEntityId: options.playerEntityId,
    spawnIndex: index,
  });
  registerCombatantIdentity({
    entityId: eid,
    encounterId: options.encounterId,
    playerCombatantId: options.playerCombatantId,
    playerEntityId: options.playerEntityId,
    spawnIndex: index,
  });
  return derived;
};
