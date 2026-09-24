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
import { projectWorldPointToScreen } from './camera_system.ts';
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
let currentScreenPosition: { x: number; y: number } | undefined;

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
      currentScreenPosition = undefined;
      bridge.emit({
        type: 'INTERACTION_TARGET_CHANGED',
        targetEntityId: undefined,
      });
    }
    return;
  }

  const playerPos = getComponent(world, playerEntityId, Position) as PositionData | undefined;
  if (!playerPos) {
    // Emit undefined target transition before returning — clears stale prompt (C-327)
    if (currentTarget) {
      currentTarget = undefined;
      currentScreenPosition = undefined;
      bridge.emit({
        type: 'INTERACTION_TARGET_CHANGED',
        targetEntityId: undefined,
      });
    }
    return;
  }

  const newTarget = selectInteractionTarget({
    world,
    playerX: playerPos.x,
    playerY: playerPos.y,
  });

  const targetPosition = newTarget
    ? (getComponent(world, newTarget.entityId, Position) as PositionData | undefined)
    : undefined;
  const screenPosition = targetPosition
    ? projectWorldPointToScreen(targetPosition.x, targetPosition.y)
    : undefined;

  // Keep the target identity notification dirty-checked, but refresh the
  // retained prompt when camera motion changes its projected position.
  if (_targetsEqual(currentTarget, newTarget)) {
    _refreshRetainedTargetPosition(newTarget, screenPosition, bridge);
    return;
  }

  currentTarget = newTarget;
  currentScreenPosition = screenPosition;

  if (newTarget) {
    bridge.emit({
      type: 'INTERACTION_TARGET_CHANGED',
      targetEntityId: newTarget.entityId,
      targetType: newTarget.targetType,
      targetName: newTarget.targetName,
      targetScreenX: screenPosition?.x,
      targetScreenY: screenPosition?.y,
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
  currentScreenPosition = undefined;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const _refreshRetainedTargetPosition = (
  target: InteractionTarget | undefined,
  screenPosition: { x: number; y: number } | undefined,
  bridge: EngineBridge,
): void => {
  if (
    !target ||
    (screenPosition?.x === currentScreenPosition?.x &&
      screenPosition?.y === currentScreenPosition?.y)
  ) {
    return;
  }
  currentScreenPosition = screenPosition;
  bridge.emit({
    type: 'INTERACTION_TARGET_POSITION_UPDATED',
    targetScreenX: screenPosition?.x,
    targetScreenY: screenPosition?.y,
  });
};

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
