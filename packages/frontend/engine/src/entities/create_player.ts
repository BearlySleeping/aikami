// apps/frontend/game/src/engine/entities/create_player.ts

import type { World } from 'bitecs';
import { addComponent, addEntity, set } from 'bitecs';
import { Appearance, setAppearanceLayers } from '../components/appearance.ts';
import { Position } from '../components/position.ts';
import { Sprite } from '../components/sprite.ts';
import { Velocity } from '../components/velocity.ts';

// ---------------------------------------------------------------------------
// Player entity factory
// ---------------------------------------------------------------------------

/**
 * Creates the player entity in the given bitECS world.
 *
 * The player starts at the center of the canvas with zero velocity. The
 * {@link Sprite} component includes a green tint (`0x00ff88`) so it's
 * visually distinct from NPCs.
 *
 * @param world - The bitECS world to create the player in.
 * @returns The entity ID of the newly created player.
 */
const createPlayer = (world: World): number => {
  const entityId = addEntity(world);

  addComponent(world, entityId, Position);
  addComponent(world, entityId, set(Position, { x: 400, y: 300 }));

  addComponent(world, entityId, Velocity);
  addComponent(world, entityId, set(Velocity, { x: 0, y: 0 }));

  addComponent(world, entityId, Sprite);
  addComponent(
    world,
    entityId,
    set(Sprite, {
      textureKey: 'player',
      tint: 0x00ff88,
      displayObject: undefined,
    }),
  );

  // Set default Appearance (Male Muscular, Short Hair, Shirt, Pants, Shoes)
  // Layer IDs map to asset catalog indices. We'll use placeholder IDs for now,
  // the recipeResolver on the main thread will map them back.
  // We'll use specific IDs to be mapped by the client:
  // 1 = muscular body
  // 2 = short hair
  // 3 = long sleeve shirt
  // 4 = pants
  // 5 = shoes
  addComponent(world, entityId, Appearance);
  setAppearanceLayers(world, entityId, [1, 2, 3, 4, 5]);

  return entityId;
};

export { createPlayer };
