// packages/frontend/engine/src/systems/pressure_plate_system.ts
import type { World } from 'bitecs';
import { getComponent, query } from 'bitecs';
import { logger } from '$logger';
import { isSimulationActive } from '../components/engine_state.ts';
import type { InteractableData } from '../components/interactable.ts';
import { Interactable } from '../components/interactable.ts';
import { InteractableState } from '../components/interactable_state.ts';
import type { PositionData } from '../components/position.ts';
import { Position } from '../components/position.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import { evaluatePuzzleDag } from '../systems/puzzle_resolver.ts';

// ---------------------------------------------------------------------------
// Pressure Plate System — per-tick overlap detection for pressure plates
//
// Contract C-342 AC-3: Pressure plates detect the player's tile position
// every tick and emit press/release events. Unlike key-interact types,
// pressure plates are proximity-driven (not interact-key-driven).
//
// The INTERACTION_TARGET_CHANGED event indicates a plate is the nearest
// interactable, but the actual press/release trigger uses a tile-overlap
// check performed here, every tick.
// ---------------------------------------------------------------------------

/** Tile size in pixels — used for tile-overlap check. */
const TILE_SIZE = 32;

/** Per-entity tracking of whether the player is currently on the plate. */
const _platePressed = new Map<number, boolean>();

/**
 * Checks the player's tile position against all pressure plates in the world
 * and emits press/release events when the player steps on/off.
 *
 * Must be called once per simulation tick from the ECS worker.
 */
export const updatePressurePlates = (options: {
  world: World;
  playerEntityId: number;
  bridge: EngineBridge;
}): void => {
  const { world, playerEntityId, bridge } = options;

  if (!world || !bridge) {
    return;
  }

  if (!isSimulationActive()) {
    return;
  }

  const playerPos = getComponent(world, playerEntityId, Position) as PositionData | undefined;
  if (!playerPos) {
    return;
  }

  const playerTileX = Math.floor(playerPos.x / TILE_SIZE);
  const playerTileY = Math.floor(playerPos.y / TILE_SIZE);

  for (const eid of query(world, [Position, Interactable])) {
    const interactable = getComponent(world, eid, Interactable) as InteractableData | undefined;
    if (interactable?.type !== 'pressure_plate') {
      continue;
    }

    const pos = getComponent(world, eid, Position) as PositionData | undefined;
    if (!pos) {
      continue;
    }

    const plateTileX = Math.floor(pos.x / TILE_SIZE);
    const plateTileY = Math.floor(pos.y / TILE_SIZE);

    const playerOnPlate = playerTileX === plateTileX && playerTileY === plateTileY;
    const wasPressed = _platePressed.get(eid) ?? false;

    if (playerOnPlate && !wasPressed) {
      // Player just stepped on the plate
      _platePressed.set(eid, true);
      InteractableState.isToggled[eid] = 1;

      logger.debug('[pressure_plate_system] Plate pressed', {
        spawnId: interactable.spawnId,
        tileX: plateTileX,
        tileY: plateTileY,
      });

      // Evaluate puzzle DAG for activatesSpawnIds
      if (interactable.spawnId) {
        evaluatePuzzleDag({ world, changedSpawnId: interactable.spawnId, bridge });
      }
    } else if (!playerOnPlate && wasPressed) {
      // Player stepped off the plate
      _platePressed.set(eid, false);
      InteractableState.isToggled[eid] = 0;

      logger.debug('[pressure_plate_system] Plate released', {
        spawnId: interactable.spawnId,
        tileX: plateTileX,
        tileY: plateTileY,
      });

      // Evaluate deactivatesOnReleaseSpawnIds
      if (interactable.spawnId) {
        evaluatePuzzleDag({ world, changedSpawnId: interactable.spawnId, bridge });
      }
    }
  }
};

/**
 * Clears per-entity pressure plate tracking state.
 * Useful for tests between scenarios.
 */
export const clearPressurePlateState = (): void => {
  _platePressed.clear();
};
