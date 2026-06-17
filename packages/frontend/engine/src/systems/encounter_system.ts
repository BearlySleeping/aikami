// packages/frontend/engine/src/systems/encounter_system.ts
import type { World } from 'bitecs';
import { addComponent, getComponent, query, set } from 'bitecs';
import type { CombatStatsData } from '../components/combat_stats.ts';
import { CombatStats } from '../components/combat_stats.ts';
import { Enemy } from '../components/enemy.ts';
import type { PositionData } from '../components/position.ts';
import { Position } from '../components/position.ts';
import { Velocity } from '../components/velocity.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import { getEngineGameMode, setEngineGameMode } from '../state/game_mode.ts';

// ---------------------------------------------------------------------------
// EncounterSystem — player↔enemy collision detection for combat triggers
//
// Runs every tick. Queries all entities with the Enemy tag and checks
// spatial overlap with the player. When the player collides with an enemy
// in EXPLORE mode, the system:
//
// 1. Halts player velocity.
// 2. Emits COMBAT_STARTED through the bridge with enemy stats.
// 3. Sets the engine mode to COMBAT (gating movement + interaction).
//
// Designed to run in the Web Worker alongside other game systems.
// Must run AFTER movement_system (positions are finalized) and BEFORE
// the bridge event flush at the end of the tick loop.
//
// Contract: C-144 Combat Encounter Integration
// ---------------------------------------------------------------------------

/** Default encounter trigger radius in pixels (squared). */
const ENCOUNTER_RADIUS_SQ = 48 * 48; // 48px radius

/** Cached query terms for enemy entities with position and combat stats. */
const ENEMY_QUERY_TERMS = [Enemy, Position, CombatStats];

// ---------------------------------------------------------------------------
// Tick entry point
// ---------------------------------------------------------------------------

/**
 * Runs the encounter system for a single tick.
 *
 * Called from the worker's tick loop. Checks whether the player entity
 * overlaps any Enemy-tagged entity. If an encounter triggers, this function
 * handles all side effects (velocity halt, bridge emit, mode change) and
 * returns `true`. The caller should skip additional encounter checks for
 * this tick — combat is now active.
 *
 * When the engine mode is already COMBAT, this function is a no-op —
 * encounters only trigger from EXPLORE mode.
 *
 * @param options.world - The bitECS world.
 * @param options.playerEntityId - The player entity ID for distance checks.
 * @param options.bridge - The EngineBridge for emitting events.
 * @returns `true` if an encounter triggered this tick, `false` otherwise.
 */
export const updateEncounterSystem = (options: {
  world: World;
  playerEntityId: number;
  bridge: EngineBridge;
}): boolean => {
  const { world, playerEntityId, bridge } = options;

  if (!world || playerEntityId <= 0 || !bridge) {
    return false;
  }

  // Only trigger encounters from EXPLORE mode
  if (getEngineGameMode() !== 'EXPLORE') {
    return false;
  }

  // Read player position
  const playerPos = getComponent(world, playerEntityId, Position) as PositionData | undefined;
  if (!playerPos) {
    return false;
  }

  // Iterate all enemy entities and check proximity
  for (const eid of query(world, ENEMY_QUERY_TERMS)) {
    if (eid === playerEntityId) {
      continue;
    }

    // Check if enemy is still active
    if (!Enemy.isActive[eid]) {
      continue;
    }

    const enemyPos = getComponent(world, eid, Position) as PositionData | undefined;
    if (!enemyPos) {
      continue;
    }

    // Squared distance check (avoids sqrt)
    const dx = enemyPos.x - playerPos.x;
    const dy = enemyPos.y - playerPos.y;
    const distSq = dx * dx + dy * dy;

    if (distSq <= ENCOUNTER_RADIUS_SQ) {
      _triggerEncounter({ world, playerEntityId, enemyEid: eid, bridge });
      return true;
    }
  }

  return false;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parameters for triggering a combat encounter.
 */
type EncounterTriggerParams = {
  world: World;
  playerEntityId: number;
  enemyEid: number;
  bridge: EngineBridge;
};

/**
 * Triggers a combat encounter when the player overlaps an enemy.
 *
 * Side effects:
 * 1. Halts player velocity.
 * 2. Builds the COMBAT_STARTED event payload with enemy stats.
 * 3. Emits the event through the bridge.
 * 4. Switches engine mode to COMBAT.
 *
 * @param params - World, player/enemy entity IDs, and bridge reference.
 */
const _triggerEncounter = (params: EncounterTriggerParams): void => {
  const { world, playerEntityId, enemyEid, bridge } = params;

  // 1. Deactivate the enemy so it won't re-trigger on the next tick
  //    even if the player hasn't moved away (C-147).
  Enemy.isActive[enemyEid] = false;

  // 2. Halt player velocity immediately
  addComponent(world, playerEntityId, set(Velocity, { x: 0, y: 0 }));

  // 3. Read enemy combat stats for the event payload
  const stats = getComponent(world, enemyEid, CombatStats) as CombatStatsData | undefined;
  const enemyHp = stats?.health ?? 0;
  const enemyMaxHp = stats?.maxHealth ?? 0;

  // 4. Switch engine mode to COMBAT (gates movement)
  setEngineGameMode('COMBAT');

  // 5. Emit COMBAT_STARTED with enemy metadata
  bridge.emit({
    type: 'COMBAT_STARTED',
    participantIds: [playerEntityId, enemyEid],
    firstTurnEntityId: playerEntityId,
    enemyId: enemyEid,
    enemyHp,
    enemyMaxHp,
  });
};
