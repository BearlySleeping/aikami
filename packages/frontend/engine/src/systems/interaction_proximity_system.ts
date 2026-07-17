// packages/frontend/engine/src/systems/interaction_proximity_system.ts
//
// Interaction proximity system — per-tick nearest-interactable evaluation
// with dirty-checked INTERACTION_TARGET_CHANGED emission.
//
// Contract: C-327 AC-2
//
// Reuses the shared selectInteractionTarget helper (same priority rules as
// press-time interact: items before NPCs, nearest wins, deterministic
// tie-break on entity id).

import type { World } from 'bitecs';
import { getComponent } from 'bitecs';
import { isSimulationActive } from '../components/engine_state.ts';
import { Position, type PositionData } from '../components/position.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import { type InteractionTarget, selectInteractionTarget } from './interaction_target_selector.ts';

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/**
 * Currently-active interaction target (dirty-checked).
 *
 * Undefined when nothing is in range or when simulation is paused.
 * Compared against the per-tick selection result to gate event emission.
 */
let currentTarget: InteractionTarget | undefined;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluates the nearest interactable for the player and emits
 * `INTERACTION_TARGET_CHANGED` on the bridge **only when the target changes**.
 *
 * Runs only while `isSimulationActive()` and should be called once per
 * simulation tick from the ECS worker.
 *
 * @param options.world - The bitECS world.
 * @param options.playerEntityId - The entity ID of the player.
 * @param options.bridge - The EngineBridge for emitting events.
 */
export const updateInteractionProximity = (options: {
  world: World;
  playerEntityId: number;
  bridge: EngineBridge;
}): void => {
  const { world, playerEntityId, bridge } = options;

  if (!world || !bridge) {
    return;
  }

  // ── Suppress during map transitions / non-simulation states ──
  if (!isSimulationActive()) {
    if (currentTarget) {
      currentTarget = undefined;
      bridge.emit({
        type: 'INTERACTION_TARGET_CHANGED',
        targetEntityId: undefined,
      });
    }
    return;
  }

  const playerPos = getComponent(world, playerEntityId, Position) as PositionData | undefined;
  if (!playerPos) {
    return;
  }

  const newTarget = selectInteractionTarget({
    world,
    playerX: playerPos.x,
    playerY: playerPos.y,
  });

  // ── Dirty-check: emit only when the target changes ──
  if (_targetsEqual(currentTarget, newTarget)) {
    return;
  }

  currentTarget = newTarget;

  if (newTarget) {
    bridge.emit({
      type: 'INTERACTION_TARGET_CHANGED',
      targetEntityId: newTarget.entityId,
      targetType: newTarget.targetType,
      targetName: newTarget.targetName,
    });
  } else {
    bridge.emit({
      type: 'INTERACTION_TARGET_CHANGED',
      targetEntityId: undefined,
    });
  }
};

/**
 * Clears the internal target state. Useful in tests between scenarios.
 */
export const clearInteractionProximityState = (): void => {
  currentTarget = undefined;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compares two InteractionTarget objects for equality.
 *
 * Targets are equal when they have the same entityId and targetType.
 * Both being undefined is equal (no change).
 */
const _targetsEqual = (
  a: InteractionTarget | undefined,
  b: InteractionTarget | undefined,
): boolean => {
  if (a === undefined && b === undefined) {
    return true;
  }
  if (a === undefined || b === undefined) {
    return false;
  }
  return a.entityId === b.entityId && a.targetType === b.targetType;
};
