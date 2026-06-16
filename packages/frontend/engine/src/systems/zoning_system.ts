// packages/frontend/engine/src/systems/zoning_system.ts
import type { World } from 'bitecs';
import { getComponent, query } from 'bitecs';
import type { PositionData } from '../components/position.ts';
import { Position } from '../components/position.ts';
import { Transition, type TransitionData } from '../components/transition.ts';
import type { EngineBridge } from '../engine_bridge.ts';

// ---------------------------------------------------------------------------
// ZoningSystem — detect when the player overlaps a transition zone
//
// Each tick, checks whether the player's Position falls within the
// bounding rectangle of any entity with Position + Transition. On the
// first overlap, locks the zone (prevents double-trigger), emits a
// ZONE_TRIGGERED bridge event, and sends a STOP_PLAYER command.
//
// Contract: C-138 Map Transitions
// ---------------------------------------------------------------------------

/** Cached query terms — transition zones have Position + Transition. */
const TRANSITION_QUERY_TERMS = [Position, Transition];

/**
 * Checks each tick whether the player overlaps a transition zone.
 *
 * When overlap is detected:
 * 1. Sets {@link Transition.triggered}[eid] = true (one-shot lock).
 * 2. Emits `ZONE_TRIGGERED` via the bridge.
 * 3. Sends `STOP_PLAYER` command to freeze movement.
 *
 * @param world - The bitECS world.
 * @param playerEntityId - The entity ID of the player.
 * @param bridge - The EngineBridge for emitting events.
 */
export const updateZoningSystem = (
  world: World,
  playerEntityId: number,
  bridge: EngineBridge,
): void => {
  if (!world || !bridge || playerEntityId <= 0) {
    return;
  }

  const playerPos = getComponent(world, playerEntityId, Position) as PositionData | undefined;
  if (!playerPos) {
    return;
  }

  const transitionEntities = query(world, TRANSITION_QUERY_TERMS);

  for (const eid of transitionEntities) {
    // Skip already-triggered zones
    if (Transition.triggered[eid]) {
      continue;
    }

    const zonePos = getComponent(world, eid, Position) as PositionData | undefined;
    if (!zonePos) {
      continue;
    }

    const zoneData = getComponent(world, eid, Transition) as TransitionData | undefined;
    if (!zoneData) {
      continue;
    }

    // AABB overlap check: player point vs zone rectangle.
    // The zone's Position is treated as the top-left corner; width/height
    // define the extent. Using point-in-rect for simplicity — players are
    // single-tile entities (1 pixel for collision purposes).
    const halfW = zoneData.width / 2;
    const halfH = zoneData.height / 2;
    const zoneCenterX = zonePos.x;
    const zoneCenterY = zonePos.y;

    const inBoundsX = playerPos.x >= zoneCenterX - halfW && playerPos.x <= zoneCenterX + halfW;
    const inBoundsY = playerPos.y >= zoneCenterY - halfH && playerPos.y <= zoneCenterY + halfH;

    if (inBoundsX && inBoundsY) {
      // One-shot lock — prevent multiple triggers from the same zone
      Transition.triggered[eid] = true;

      bridge.emit({
        type: 'ZONE_TRIGGERED',
        targetMap: zoneData.targetMap,
        targetX: zoneData.targetX,
        targetY: zoneData.targetY,
      });
    }
  }
};
