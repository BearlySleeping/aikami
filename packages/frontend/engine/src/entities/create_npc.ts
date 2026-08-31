// packages/frontend/engine/src/entities/create_npc.ts

import type { World } from 'bitecs';
import { addComponent, addEntity, set } from 'bitecs';
import { Appearance, setAppearanceLayers } from '../components/appearance.ts';
import { CollisionData, CollisionLayer } from '../components/collision_data.ts';
import { Companion } from '../components/companion.ts';
import { GridPosition } from '../components/grid_position.ts';
import { NPCDialog } from '../components/npc_dialog.ts';
import { Position } from '../components/position.ts';
import { SpatialLink } from '../components/spatial_link.ts';
import { AssetAlias, Visual } from '../components/visual.ts';
import { getTerrainTileSize } from '../systems/collision_system.ts';
import type { NPCSpawnData } from '../types.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default 6-layer LPC appearance for NPCs when the caller supplies no
 * explicit appearanceLayers. 1-indexed engine variant indices in slot order:
 * body, hair, torso, legs, feet, head.
 *
 * Matches the NPC_APPEARANCE_LAYERS default in entity_spawner.ts.
 */
const DEFAULT_NPC_APPEARANCE_LAYERS: readonly number[] = [3, 3, 23, 22, 7, 95];

/**
 * Collision mask for NPCs — other NPCs, walls, and enemies block NPCs,
 * but the player does NOT collide with NPCs (C-402: soft obstacles).
 */
const NPC_COLLISION_MASK =
  CollisionLayer.wall | CollisionLayer.npc | CollisionLayer.player | CollisionLayer.enemy;

// ---------------------------------------------------------------------------
// NPC entity factory
// ---------------------------------------------------------------------------

/**
 * Creates an NPC entity from spawn data.
 *
 * NPCs are interactable — when the player walks within their interaction
 * radius, the {@link DialogTriggerSystem} emits a bridge event.
 *
 * When `data.isCompanion` is true, the entity also receives the Companion
 * component (with `recruited: false`) and spatial-grid collision components
 * (GridPosition, SpatialLink, CollisionData) so the party-follow system
 * can path it to formation slots behind the player.
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

  // Appearance — use caller-supplied layers or the default.
  addComponent(world, entityId, Appearance);
  const layers = data.appearanceLayers ?? DEFAULT_NPC_APPEARANCE_LAYERS;
  setAppearanceLayers(world, entityId, layers);

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

  // Companion-specific setup: spatial collision + Companion component.
  // Spatial components are only attached when the terrain grid exists
  // (tileSize > 0), otherwise GridPosition would compute Infinity coords.
  if (data.isCompanion) {
    const tileSize = getTerrainTileSize();
    if (tileSize > 0) {
      addComponent(world, entityId, GridPosition);
      addComponent(
        world,
        entityId,
        set(GridPosition, {
          x: Math.floor(data.x / tileSize),
          y: Math.floor(data.y / tileSize),
        }),
      );
      addComponent(world, entityId, SpatialLink);
      addComponent(world, entityId, set(SpatialLink, { next: 0, prev: 0 }));
      addComponent(world, entityId, CollisionData);
      addComponent(
        world,
        entityId,
        set(CollisionData, { layer: CollisionLayer.npc, mask: NPC_COLLISION_MASK }),
      );
    }

    addComponent(world, entityId, Companion);
    addComponent(
      world,
      entityId,
      set(Companion, {
        npcId: data.npcId,
        approval: data.relationshipValue ?? 0,
        recruited: false,
      }),
    );
  }

  return entityId;
};

export { createNPC };
