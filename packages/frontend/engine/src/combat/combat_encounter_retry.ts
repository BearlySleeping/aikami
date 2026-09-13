// packages/frontend/engine/src/combat/combat_encounter_retry.ts
//
// Deterministic v2 encounter retry (Combat-04 / AC-10).
//
// A retry must reproduce the encounter from its preserved seed. The world is
// NOT rebuilt from scratch: the entities the encounter spawned (and the map
// entities the collision funnel reused) already exist, so the retry re-runs the
// production start path against them (`reuseEntityId`) instead of spawning a
// second copy. Only the v2 resolver can describe its own opening state (the
// live player entity is authoritative and the authored roster is not held in
// the engine), so `buildV2CombatState` records the opening project here.
//
// Contract: C-516 AC-10, C-525 R-3

import { BASIC_COMBAT_ABILITIES } from '@aikami/constants';
import type { CombatAbilityDefinition, CombatEngineKind, CombatState } from '@aikami/types';
import type { World } from 'bitecs';
import { logger } from '$logger';
import type { EngineBridge } from '../engine_bridge.ts';
import {
  emitCombatStateUpdate,
  initCombat,
  resetTurnTracking,
} from '../systems/turn_manager_system.ts';
import {
  type CombatEncounterParticipant,
  type CombatEncounterRoster,
  getEncounterEngine,
  type StartEncounterResult,
  startProductionEncounter,
} from './combat_encounter_start.ts';
import { getCombatIdentityRegistry, resetCombatApplyGuard } from './combat_state_adapter.ts';
import { resetCombatTurns } from './combat_turn_driver.ts';
import { resetLiveV2CombatState } from './combat_v2_state.ts';

// ---------------------------------------------------------------------------
// Retry descriptor
// ---------------------------------------------------------------------------

/** Everything needed to re-run a v2 encounter without spawning it twice. */
export type EncounterRetryRecord = {
  encounterId: string;
  seed: number;
  engine: CombatEngineKind;
  /** Authored participants with opening cells and stats captured from the state. */
  participants: CombatEncounterParticipant[];
  /** Runtime eid per participant, aligned with {@link participants}. */
  entityIds: number[];
  abilityIdsByCombatant: Record<string, string[]>;
};

const retryRecords = new WeakMap<World, EncounterRetryRecord>();

/** The recorded retry descriptor for this world, or `null` when none exists. */
export const getEncounterRetryRecord = (world: World): EncounterRetryRecord | null =>
  retryRecords.get(world) ?? null;

/** Forgets this world's retry descriptor (encounter teardown / test isolation). */
export const clearEncounterRetryRecord = (world: World): void => {
  retryRecords.delete(world);
};

/**
 * Records the opening state of a v2 encounter the moment it is first projected.
 *
 * The driver's initiative order is the real participant set, so only those
 * combatants are captured. The player slot carries no authored stats in
 * production, so its opening HP/AC/attack/initiative come from the live ECS via
 * the snapshot — exactly as the resolver itself sees them.
 */
export const captureEncounterForRetry = (options: { world: World; state: CombatState }): void => {
  const { world, state } = options;
  const registry = getCombatIdentityRegistry(world);
  registry.sync(world);

  const participants: CombatEncounterParticipant[] = [];
  const entityIds: number[] = [];
  const abilityIdsByCombatant: Record<string, string[]> = {};

  for (const combatantId of state.initiative.order) {
    const combatant = state.combatants[combatantId];
    if (combatant === undefined) {
      continue;
    }
    const entityId = registry.toEntityId(combatantId) ?? 0;
    const team = combatant.team === 'neutral' ? 'enemy' : combatant.team;
    const abilityIds = [...combatant.abilityIds];
    participants.push({
      combatantId,
      team,
      cell: { x: combatant.position.x, y: combatant.position.y },
      stats: {
        hitPoints: combatant.hp,
        armorClass: combatant.armorClass,
        attackBonus: combatant.attackBonus,
        initiative: combatant.initiative,
      },
      abilityIds,
    });
    entityIds.push(entityId);
    abilityIdsByCombatant[combatantId] = abilityIds;
  }

  retryRecords.set(world, {
    encounterId: state.encounterId,
    seed: state.rng.seed,
    engine: 'v2',
    participants,
    entityIds,
    abilityIdsByCombatant,
  });
};

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

/** Starts a roster through the production encounter path. */
export type RetryEncounterStart = (roster: CombatEncounterRoster) => StartEncounterResult;

/** The injected v2 AI runner — avoids a resolver↔retry module cycle. */
export type RunV2AiTurns = (options: {
  world: World;
  bridge: EngineBridge;
  abilityCatalog: Record<string, CombatAbilityDefinition>;
  playerEntityId: number;
  abilityIdsByCombatant?: Record<string, string[]>;
}) => void;

/**
 * Re-runs the last v2 encounter on the same entities with its preserved seed.
 *
 * Tears down the previous driver/kernel state first — including the revision
 * apply guard, without which the first commit of the retry would be ignored —
 * then re-spawns through the production start path with every existing entity
 * reused. Returns `null` when there is no v2 retry descriptor.
 */
export const retryEncounter = (options: {
  world: World;
  start: RetryEncounterStart;
}): StartEncounterResult | null => {
  const { world } = options;
  const record = retryRecords.get(world);
  if (record === undefined) {
    return null;
  }

  resetCombatTurns(world);
  resetLiveV2CombatState(world);
  resetCombatApplyGuard(world);

  const roster: CombatEncounterRoster = {
    encounterId: record.encounterId,
    seed: record.seed,
    engine: record.engine,
    participants: record.participants.map((participant, index) => ({
      ...participant,
      ...(participant.team === 'player' ? {} : { reuseEntityId: record.entityIds[index] }),
    })),
  };

  return options.start(roster);
};

/**
 * The worker's full RETRY_ENCOUNTER path.
 *
 * Branches on the encounter's pinned engine (the same record the command
 * dispatcher uses), falling back to the retry descriptor because the pin is
 * cleared when a v2 fight ends. Legacy keeps its historical behaviour. On a v2
 * success the deferred AI turns run and the per-combatant grants are returned
 * so the worker can keep routing player commands with them.
 */
export const retryEncounterCommand = (options: {
  world: World;
  bridge: EngineBridge;
  playerEntityId: number;
  seed: number;
  runAiTurns: RunV2AiTurns;
}): Record<string, string[]> | undefined => {
  const { world, bridge, playerEntityId, seed, runAiTurns } = options;
  const engine = getEncounterEngine(world) ?? retryRecords.get(world)?.engine ?? 'legacy';

  if (engine !== 'v2') {
    resetTurnTracking(world);
    initCombat(world, bridge, seed);
    return undefined;
  }

  const started = retryEncounter({
    world,
    start: (roster) =>
      startProductionEncounter({
        world,
        bridge,
        roster,
        playerEntityId,
        abilityCatalog: BASIC_COMBAT_ABILITIES,
        hooks: { runAiTurn: () => {}, emitStateUpdate: emitCombatStateUpdate },
      }),
  });

  // No descriptor (an encounter that predates this record): keep legacy retry.
  if (started === null) {
    resetTurnTracking(world);
    initCombat(world, bridge, seed);
    return undefined;
  }

  if (!started.ok) {
    const encounterId = retryRecords.get(world)?.encounterId ?? '';
    logger.warn('[combat_encounter_retry] retry rejected', {
      encounterId,
      reasonCode: started.reasonCode,
    });
    bridge.emit({
      type: 'COMBAT_START_REJECTED',
      encounterId,
      reasonCode: started.reasonCode,
      messageKey: started.messageKey,
    });
    return undefined;
  }

  try {
    runAiTurns({
      world,
      bridge,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
      playerEntityId,
      abilityIdsByCombatant: started.abilityIdsByCombatant,
    });
  } catch (error) {
    logger.error('[combat_encounter_retry] retry AI turns failed', {
      encounterId: retryRecords.get(world)?.encounterId ?? '',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return started.abilityIdsByCombatant;
};
