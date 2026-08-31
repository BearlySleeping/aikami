// apps/frontend/game/src/engine/entities/create_npc.ts

import type { World } from 'bitecs';
import { addComponent, addEntity, set } from 'bitecs';
import { Appearance, setAppearanceLayers } from '../components/appearance.ts';
import { NPCDialog } from '../components/npc_dialog.ts';
import { Position } from '../components/position.ts';
import { AssetAlias, Visual } from '../components/visual.ts';
import type { NPCSpawnData } from '../types.ts';

// ---------------------------------------------------------------------------
// NPC entity factory
// ---------------------------------------------------------------------------

/**
 * Creates an NPC entity from spawn data.
 *
 * NPCs are interactable — when the player walks within their interaction
 * radius, the {@link DialogTriggerSystem} emits a bridge event.
 *
 * @param world - The bitECS world.
 * @param data - Spawn configuration for this NPC.
 * @returns The entity ID of the newly created NPC.
 */
const createNPC = (world: World, data: NPCSpawnData): number => {
  const entityId = addEntity(world);

  addComponent(world, entityId, Position);
  addComponent(world, entityId, set(Position, { x: data.x, y: data.y }));

  addComponent(world, entityId, Visual);
  addComponent(
    world,
    entityId,
    set(Visual, {
      assetIndex: AssetAlias.NPC,
      tint: 0xffcc00, // gold tint for NPCs
      visible: 1,
    }),
  );

  // Set default Appearance for NPCs — 6-layer stack
  // 10 = body, 11 = hair, 14 = torso, 12 = legs, 15 = feet, 13 = head
  addComponent(world, entityId, Appearance);
  setAppearanceLayers(world, entityId, [10, 11, 14, 12, 15, 13]);

  addComponent(world, entityId, NPCDialog);
  addComponent(
    world,
    entityId,
    set(NPCDialog, {
      npcId: data.npcId,
      npcName: data.npcName,
      dialog: data.dialog,
      interactionRadius: data.interactionRadius,
      playerInRange: false,
    }),
  );

  return entityId;
};

export { createNPC };
