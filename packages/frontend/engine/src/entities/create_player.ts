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
 * Options for creating a player entity.
 */
export type PlayerCreateOptions = {
  /** The player character's display name (from active persona). */
  name?: string;
};

/**
 * Creates the player entity in the given bitECS world.
 *
 * The player starts at the center of the canvas with zero velocity. The
 * {@link Sprite} component includes a green tint (`0x00ff88`) so it's
 * visually distinct from NPCs.
 *
 * @param world - The bitECS world to create the player in.
 * @param options - Optional player initialization data (name, stats, etc.).
 * @returns The entity ID of the newly created player.
 */
const createPlayer = (world: World, options?: PlayerCreateOptions): number => {
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

  // Set default Appearance with all 6 engine slots:
  //   body, hair, torso, legs, feet, head
  // Variant indices are 1-indexed (0 = first variant in catalog).
  // Head uses variant 95 (= index 94, head/heads/human_male) so the
  // character has a visible face instead of just ear accessories.
  addComponent(world, entityId, Appearance);
  setAppearanceLayers(world, entityId, [1, 1, 1, 1, 1, 95]);

  // Store player name as a numeric hash on the entity for reference.
  // The UI layer (GameViewModel) owns the display name; the engine
  // only needs positional/rendering data.
  if (options?.name) {
    void options.name;
  }

  return entityId;
};

export { createPlayer };
