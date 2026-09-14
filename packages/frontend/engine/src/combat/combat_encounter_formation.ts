// packages/frontend/engine/src/combat/combat_encounter_formation.ts
//
// Deterministic placement for an encounter roster (Combat-04).
//
// A main-thread caller authors stats, not cells: it does not know the map
// layout, and the collision funnel derives its roster from entities the map
// already spawned. This module is the single answer to "where does an
// unauthored combatant stand", and it is deterministic on purpose — the same
// player cell and the same roster always produce the same cells, so an
// encounter is reproducible from its seed.
//
// Split out of `combat_encounter_start.ts` (which had drifted past the
// source-file-size hard limit) as one cohesive, independently reviewable
// responsibility: PLACEMENT — no spawning, no engine pinning, no orchestration.
//
// Contract: C-516 AC-2

import { isCellImpassable, worldPixelToCell } from '@aikami/utils';
import type { World } from 'bitecs';
import { hasComponent } from 'bitecs';
import { logger } from '$logger';
import { GridPosition } from '../components/grid_position.ts';
import { Position } from '../components/position.ts';
import { getTerrainTileSize } from '../systems/collision_system.ts';
import { snapshotBattlefield } from './combat_battlefield.ts';
import type {
  CombatEncounterParticipant,
  SolvedEncounterParticipant,
} from './combat_encounter_types.ts';

/**
 * Deterministic formation used when a participant is authored without a cell.
 *
 * Expanding rings from the player's live cell, ORTHOGONAL neighbours first
 * (right, down, left, up) and diagonals after, skipping impassable, occupied
 * and already-taken cells. Preferring orthogonal contact matters: an encounter
 * that begins with everyone a diagonal apart cannot be opened with a melee
 * attack, and a fight nobody can reach stalls forever. Fully deterministic and
 * map-agnostic, so the dialogue chip can author stats without knowing layout.
 */
const FORMATION_OFFSETS: ReadonlyArray<{ x: number; y: number }> = (() => {
  const offsets: Array<{ x: number; y: number }> = [];
  for (let ring = 1; ring <= 4; ring++) {
    const ringOffsets: Array<{ x: number; y: number }> = [];
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) {
          continue;
        }
        ringOffsets.push({ x: dx, y: dy });
      }
    }
    // Orthogonal contact first: |dx| + |dy| === ring means exactly one axis is
    // at the ring distance, which is the cell an adjacent melee attacker needs.
    ringOffsets.sort((a, b) => Math.abs(a.x) + Math.abs(a.y) - (Math.abs(b.x) + Math.abs(b.y)));
    offsets.push(...ringOffsets);
  }
  return offsets;
})();

/** The grid cell an entity occupies — `GridPosition`, else its pixel position. */
export const cellOf = (world: World, entityId: number): { x: number; y: number } => {
  if (hasComponent(world, entityId, GridPosition)) {
    return { x: GridPosition.x[entityId] ?? 0, y: GridPosition.y[entityId] ?? 0 };
  }
  const pixelX = Position.x[entityId] ?? 0;
  const pixelY = Position.y[entityId] ?? 0;
  return worldPixelToCell({ px: pixelX, py: pixelY, tileSize: getTerrainTileSize() });
};

/**
 * Fills in every missing participant cell.
 *
 * Returns `null` when no free cell can be found inside the formation radius —
 * the caller then rejects the whole roster before spawning anything.
 */
export const solveParticipantCells = (options: {
  world: World;
  participants: readonly CombatEncounterParticipant[];
  playerEntityId: number;
}): SolvedEncounterParticipant[] | null => {
  const { world, participants, playerEntityId } = options;
  const playerCell = cellOf(world, playerEntityId);
  const battlefield = snapshotBattlefield(world);
  const taken = new Set<string>();
  for (const participant of participants) {
    if (participant.cell !== undefined) {
      taken.add(`${participant.cell.x}:${participant.cell.y}`);
    }
  }

  const isFree = (cell: { x: number; y: number }): boolean => {
    if (taken.has(`${cell.x}:${cell.y}`)) {
      return false;
    }
    return !isCellImpassable({ battlefield, cell });
  };

  const solved: SolvedEncounterParticipant[] = [];
  for (const participant of participants) {
    if (participant.cell !== undefined) {
      solved.push({ ...participant, cell: { ...participant.cell } });
      continue;
    }
    if (participant.team === 'player') {
      solved.push({ ...participant, cell: playerCell });
      continue;
    }
    const candidate = FORMATION_OFFSETS.map((offset) => ({
      x: playerCell.x + offset.x,
      y: playerCell.y + offset.y,
    })).find(isFree);
    if (candidate === undefined) {
      logger.warn('[combat_encounter_formation] no free formation cell', {
        combatantId: participant.combatantId,
        playerCell,
      });
      return null;
    }
    taken.add(`${candidate.x}:${candidate.y}`);
    solved.push({ ...participant, cell: candidate });
  }
  return solved;
};
