// packages/frontend/engine/src/combat/combat_encounter_spawn.ts
//
// Materialisation of one roster slot into real ECS combatants (Combat-04).
//
// The player slot reuses the live player entity (the turn driver keys on it), an
// enemy slot goes through the existing content-pack spawner, and an ally slot is
// a fresh entity tagged `Companion` so the roster classifier sees an ally rather
// than another enemy.
//
// Split out of `combat_encounter_start.ts` (which had drifted past the
// source-file-size hard limit) as one cohesive responsibility: SPAWNING — it
// owns the component shape a v2 combatant must have to be previewable, and
// nothing about validation, placement or turn order.
//
// Contract: C-516 AC-1, AC-2; C-526 AC-6, AC-8

import { cellToWorldPixel } from '@aikami/utils';
import type { World } from 'bitecs';
import { addComponent, addEntity, getComponent, hasComponent, set } from 'bitecs';
import { CombatIdentity } from '../components/combat_identity.ts';
import { CombatMovement } from '../components/combat_movement.ts';
import type { CombatStatsData } from '../components/combat_stats.ts';
import { CombatStats } from '../components/combat_stats.ts';
import { Companion } from '../components/companion.ts';
import { GridPosition } from '../components/grid_position.ts';
import { Position } from '../components/position.ts';
import { TurnOrder } from '../components/turn_order.ts';
import { getTerrainTileSize } from '../systems/collision_system.ts';
import { spawnEncounterEnemy } from '../systems/encounter_system.ts';
import type {
  EncounterParticipantStats,
  SolvedEncounterParticipant,
} from './combat_encounter_types.ts';

/** Grid cell → world pixel, using the LIVE terrain tile size. */
export const cellPixel = (cell: { x: number; y: number }): { x: number; y: number } =>
  cellToWorldPixel({ cell, tileSize: getTerrainTileSize() });

/** Attaches the combat-2.0 components a participant needs to be previewable. */
export const attachCombatComponents = (options: {
  world: World;
  entityId: number;
  combatantId: string;
  participant: SolvedEncounterParticipant;
}): void => {
  const { world, entityId, combatantId, participant } = options;

  if (!hasComponent(world, entityId, GridPosition)) {
    addComponent(world, entityId, GridPosition);
  }
  addComponent(
    world,
    entityId,
    set(GridPosition, { x: participant.cell.x, y: participant.cell.y }),
  );

  const pixel = cellPixel(participant.cell);
  if (!hasComponent(world, entityId, Position)) {
    addComponent(world, entityId, Position);
  }
  addComponent(world, entityId, set(Position, { x: pixel.x, y: pixel.y }));

  if (!hasComponent(world, entityId, CombatIdentity)) {
    addComponent(world, entityId, CombatIdentity);
  }
  addComponent(world, entityId, set(CombatIdentity, { combatantId }));

  addComponent(world, entityId, CombatMovement);
  // Only write an authored allowance: writing `0` would override the driver's
  // default and leave the combatant unable to move at all.
  const movementPerTurn = participant.stats?.movementPerTurn;
  if (movementPerTurn !== undefined) {
    addComponent(world, entityId, set(CombatMovement, { movementPerTurn }));
  }
};

/** Overwrites only the adapter-mapped `CombatStats` fields. */
export const applyCombatStats = (options: {
  world: World;
  entityId: number;
  stats: EncounterParticipantStats;
}): void => {
  const { world, entityId, stats } = options;
  if (!hasComponent(world, entityId, CombatStats)) {
    addComponent(world, entityId, CombatStats);
  }
  const existing =
    (getComponent(world, entityId, CombatStats) as CombatStatsData | undefined) ??
    ({} as CombatStatsData);
  addComponent(
    world,
    entityId,
    set(CombatStats, {
      ...existing,
      health: stats.hitPoints,
      maxHealth: stats.hitPoints,
      evasion: stats.armorClass,
      accuracy: stats.attackBonus,
      initiative: stats.initiative,
    }),
  );

  if (!hasComponent(world, entityId, TurnOrder)) {
    addComponent(world, entityId, TurnOrder);
  }
  addComponent(
    world,
    entityId,
    set(TurnOrder, { currentTurn: false, initiativeValue: stats.initiative, isActive: true }),
  );
};

/**
 * Materialises one roster slot and returns its runtime entity id (`0` on
 * failure, which the caller treats as a rejected roster).
 */
export const spawnParticipant = (options: {
  world: World;
  playerEntityId: number;
  encounterId: string;
  participant: SolvedEncounterParticipant;
}): number => {
  const { world, playerEntityId, encounterId, participant } = options;
  const authoredStats = participant.stats;

  if (participant.reuseEntityId !== undefined && participant.team !== 'player') {
    if (authoredStats !== undefined) {
      applyCombatStats({ world, entityId: participant.reuseEntityId, stats: authoredStats });
    }
    attachCombatComponents({
      world,
      entityId: participant.reuseEntityId,
      combatantId: participant.combatantId,
      participant,
    });
    return participant.reuseEntityId;
  }

  if (participant.team === 'player') {
    if (participant.stats !== undefined) {
      applyCombatStats({ world, entityId: playerEntityId, stats: participant.stats });
    }
    attachCombatComponents({
      world,
      entityId: playerEntityId,
      combatantId: participant.combatantId,
      participant,
    });
    return playerEntityId;
  }

  const entityId =
    participant.team === 'enemy'
      ? spawnEncounterEnemy({
          world,
          data: {
            encounterId,
            npcName: participant.npcId ?? participant.combatantId,
            x: cellPixel(participant.cell).x,
            y: cellPixel(participant.cell).y,
            hitPoints: authoredStats?.hitPoints ?? 1,
            attackBonus: authoredStats?.attackBonus ?? 0,
            armorClass: authoredStats?.armorClass ?? 0,
            initiative: authoredStats?.initiative ?? 0,
          },
        })
      : addEntity(world);

  if (entityId === 0) {
    return 0;
  }

  if (participant.team === 'ally') {
    addComponent(world, entityId, Companion);
    addComponent(
      world,
      entityId,
      set(Companion, {
        npcId: participant.npcId ?? participant.combatantId,
        approval: 0,
        recruited: true,
        ...(participant.controlMode === undefined ? {} : { controlMode: participant.controlMode }),
      }),
    );
    if (authoredStats !== undefined) {
      applyCombatStats({ world, entityId, stats: authoredStats });
    }
  }

  attachCombatComponents({
    world,
    entityId,
    combatantId: participant.combatantId,
    participant,
  });
  return entityId;
};
