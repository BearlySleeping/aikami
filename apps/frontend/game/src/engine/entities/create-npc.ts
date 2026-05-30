// apps/frontend/game/src/engine/entities/create-npc.ts

import type { World } from 'bitecs';
import { addComponent, addEntity, set } from 'bitecs';
import { NPCDialog } from '../components/npc-dialog.ts';
import { Position } from '../components/position.ts';
import { Sprite } from '../components/sprite.ts';
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

  addComponent(world, entityId, Sprite);
  addComponent(
    world,
    entityId,
    set(Sprite, {
      textureKey: data.textureKey,
      tint: 0xffcc00, // gold tint for NPCs
      displayObject: undefined,
    }),
  );

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
