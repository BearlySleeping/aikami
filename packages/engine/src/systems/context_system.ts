// packages/engine/src/systems/context_system.ts
import type { World } from 'bitecs';
import { getComponent } from 'bitecs';
import type { NPCDialogData } from '../components/npc_dialog.ts';
import { NPCDialog } from '../components/npc_dialog.ts';
import type { PositionData } from '../components/position.ts';
import { Position } from '../components/position.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import type { SpatialHashGrid } from '../math/spatial_hash_grid.ts';

// ---------------------------------------------------------------------------
// ContextSystem — emit bridge events when player is near a context-bearing entity
// ---------------------------------------------------------------------------

/** Default context radius in pixels. */
const DEFAULT_CONTEXT_RADIUS = 50;

/**
 * Internal Set of entity IDs that are currently "in context" (player is
 * within range). Used to detect enter vs exit transitions.
 *
 * Mutable singleton — no allocation per tick.
 */
const entitiesInContext = new Set<number>();

/**
 * Checks proximity between the player and context-bearing entities each
 * frame using a spatial hash grid for O(1) candidate lookup.
 *
 * When the player enters an entity's context radius, emits a
 * `CONTEXT_ENTERED` event on the bridge with the entity's context payload.
 * When the player leaves, emits `CONTEXT_EXITED`.
 *
 * Uses squared distance (`dx*dx + dy*dy < radius*radius`) to avoid the
 * overhead of `Math.sqrt` in the per-entity loop.
 *
 * The context radius is separate from the dialog interaction radius. By
 * default it is 50px (matching the acceptance criteria), but can be
 * overridden via the `contextRadius` option.
 *
 * @param options.world - The bitECS world.
 * @param options.playerEntityId - The entity ID of the player.
 * @param options.bridge - The EngineBridge for emitting events.
 * @param options.spatialGrid - Pre-populated spatial hash grid with entity positions.
 * @param options.contextRadius - Optional override for the context radius (default: 50).
 */
const updateContextSystem = (options: {
  world: World;
  playerEntityId: number;
  bridge: EngineBridge;
  spatialGrid: SpatialHashGrid;
  contextRadius?: number;
}): void => {
  const { world, playerEntityId, bridge, spatialGrid } = options;
  const contextRadius = options.contextRadius ?? DEFAULT_CONTEXT_RADIUS;

  if (!world || !bridge || !spatialGrid) {
    return;
  }

  const playerPos = getComponent(world, playerEntityId, Position) as PositionData | undefined;
  if (!playerPos) {
    return;
  }

  const contextRadiusSq = contextRadius * contextRadius;

  // Query the spatial hash grid for candidate entities in the 3×3
  // neighborhood around the player. This replaces the O(N) full-scan
  // with an amortized O(1) lookup bounded by the constant cell count.
  const candidateEids = spatialGrid.queryNeighborhood(playerPos.x, playerPos.y);

  for (const eid of candidateEids) {
    const npcDialog = getComponent(world, eid, NPCDialog) as NPCDialogData | undefined;
    if (!npcDialog) {
      continue;
    }

    const npcPos = getComponent(world, eid, Position) as PositionData | undefined;
    if (!npcPos) {
      continue;
    }

    // Squared distance check — no Math.sqrt in the loop
    const dx = npcPos.x - playerPos.x;
    const dy = npcPos.y - playerPos.y;
    const distSq = dx * dx + dy * dy;

    const isInContext = distSq < contextRadiusSq;

    if (isInContext && !entitiesInContext.has(eid)) {
      // Player just entered context range
      entitiesInContext.add(eid);
      bridge.emit({
        type: 'CONTEXT_ENTERED',
        entityId: npcDialog.npcId,
        contextPayload: {
          npcId: npcDialog.npcId,
          npcName: npcDialog.npcName,
          dialog: npcDialog.dialog,
          interactionRadius: npcDialog.interactionRadius,
        },
      });
    } else if (!isInContext && entitiesInContext.has(eid)) {
      // Player just left context range
      entitiesInContext.delete(eid);
      bridge.emit({
        type: 'CONTEXT_EXITED',
        entityId: npcDialog.npcId,
      });
    }
  }
};

/**
 * Clears all in-context state. Useful in tests between scenarios.
 * Does not affect the game world — only the internal Set.
 */
const clearContextState = (): void => {
  entitiesInContext.clear();
};

export { clearContextState, updateContextSystem };
