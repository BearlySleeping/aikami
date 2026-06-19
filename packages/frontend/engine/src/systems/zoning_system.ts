// packages/frontend/engine/src/systems/zoning_system.ts
import type { World } from 'bitecs';
import { getComponent, query } from 'bitecs';
import { logger } from '$logger';
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

  // Debug: log player position and zone count once per second
  if (!_debugLogThrottle || performance.now() - _debugLogThrottle > 2000) {
    _debugLogThrottle = performance.now();
    logger.debug(
      `[ZoningSystem] player=(${playerPos.x.toFixed(0)},${playerPos.y.toFixed(0)}) zones=${transitionEntities.length}`,
    );
  }

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

    const halfW = zoneData.width / 2;
    const halfH = zoneData.height / 2;
    const zoneMinX = zonePos.x - halfW;
    const zoneMaxX = zonePos.x + halfW;
    const zoneMinY = zonePos.y - halfH;
    const zoneMaxY = zonePos.y + halfH;

    const inBoundsX = playerPos.x >= zoneMinX && playerPos.x <= zoneMaxX;
    const inBoundsY = playerPos.y >= zoneMinY && playerPos.y <= zoneMaxY;

    // Debug: log proximity when player is near a zone
    const dx = Math.max(0, zoneMinX - playerPos.x, playerPos.x - zoneMaxX);
    const dy = Math.max(0, zoneMinY - playerPos.y, playerPos.y - zoneMaxY);
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 80) {
      logger.debug(
        `[ZoningSystem] near zone eid=${eid} dist=${dist.toFixed(0)} ` +
          `player=(${playerPos.x.toFixed(0)},${playerPos.y.toFixed(0)}) ` +
          `zone=[${zoneMinX.toFixed(0)}..${zoneMaxX.toFixed(0)}, ${zoneMinY.toFixed(0)}..${zoneMaxY.toFixed(0)}] ` +
          `inX=${inBoundsX} inY=${inBoundsY}`,
      );
    }

    if (inBoundsX && inBoundsY) {
      logger.debug(`[ZoningSystem] 🚪 ZONE TRIGGERED! eid=${eid} → ${zoneData.targetMap}`);
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

/** Throttle for per-second debug logs. */
let _debugLogThrottle: number | undefined;
