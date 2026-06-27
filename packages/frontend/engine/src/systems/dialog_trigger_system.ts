// apps/frontend/game/src/engine/systems/dialog_trigger_system.ts
import type { World } from 'bitecs';
import { getComponent, query } from 'bitecs';
import { CollisionLayer } from '../components/collision_data.ts';
import { isSimulationActive } from '../components/engine_state.ts';
import type { NPCDialogData } from '../components/npc_dialog.ts';
import { NPCDialog } from '../components/npc_dialog.ts';
import type { PositionData } from '../components/position.ts';
import { Position } from '../components/position.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import { checkLineOfSight } from '../math/bresenham.ts';

// ---------------------------------------------------------------------------
// DialogTriggerSystem — emit bridge events when player is near an NPC
// ---------------------------------------------------------------------------

/** Cached query terms — NPCs are entities with Position + NPCDialog. */
const NPC_QUERY_TERMS = [Position, NPCDialog];

/**
 * Checks proximity between the player and all NPCs each frame.
 *
 * When the player enters an NPC's interaction radius, emits an
 * `NPC_DIALOG_START` event on the bridge. When the player leaves,
 * emits `NPC_DIALOG_END`.
 *
 * Runs every frame. Uses direct SoA array access for the mutable
 * `playerInRange` field (mutated in-place on the array, not via
 * observers) to avoid per-frame observer overhead.
 *
 * @param world - The bitECS world.
 * @param playerEntityId - The entity ID of the player.
 * @param bridge - The EngineBridge for emitting events.
 */
const updateDialogTriggers = (world: World, playerEntityId: number, bridge: EngineBridge): void => {
  if (!world || !bridge) {
    return;
  }

  // ── C-172 AC-1: Return early during map transitions ──
  if (!isSimulationActive()) {
    return;
  }

  const playerPos = getComponent(world, playerEntityId, Position) as PositionData | undefined;
  if (!playerPos) {
    return;
  }

  const npcEntities = query(world, NPC_QUERY_TERMS);
  for (const eid of npcEntities) {
    const npcDialog = getComponent(world, eid, NPCDialog) as NPCDialogData | undefined;
    if (!npcDialog) {
      continue;
    }

    const npcPos = getComponent(world, eid, Position) as PositionData | undefined;
    if (!npcPos) {
      continue;
    }

    const dx = npcPos.x - playerPos.x;
    const dy = npcPos.y - playerPos.y;
    const distSq = dx * dx + dy * dy;
    const radiusSq = npcDialog.interactionRadius * npcDialog.interactionRadius;

    const isInRange = distSq <= radiusSq;

    if (isInRange && !npcDialog.playerInRange) {
      // ── C-174 AC-3: Line-of-sight check ──
      // Only trigger dialogue if the NPC can see the player.
      const playerTileX = Math.floor(playerPos.x / 32);
      const playerTileY = Math.floor(playerPos.y / 32);
      const npcTileX = Math.floor(npcPos.x / 32);
      const npcTileY = Math.floor(npcPos.y / 32);

      // Walls block NPC vision
      const sightMask = CollisionLayer.wall;

      if (!checkLineOfSight(npcTileX, npcTileY, playerTileX, playerTileY, sightMask)) {
        continue; // Line of sight blocked — skip this NPC
      }

      // Player just entered interaction range — mutate SoA array directly
      NPCDialog.playerInRange[eid] = true;
      bridge.emit({
        type: 'NPC_DIALOG_START',
        npcId: npcDialog.npcId,
        npcName: npcDialog.npcName,
        dialog: npcDialog.dialog,
      });
    } else if (!isInRange && npcDialog.playerInRange) {
      // Player just left interaction range
      NPCDialog.playerInRange[eid] = false;
      bridge.emit({
        type: 'NPC_DIALOG_END',
        npcId: npcDialog.npcId,
      });
    }
  }
};

export { updateDialogTriggers };
