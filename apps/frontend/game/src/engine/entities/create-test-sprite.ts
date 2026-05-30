// apps/frontend/game/src/engine/entities/create-test-sprite.ts

import type { World } from 'bitecs';
import { addComponent, addEntity, set } from 'bitecs';
import { Position } from '../components/position.ts';
import { Sprite } from '../components/sprite.ts';
import { Velocity } from '../components/velocity.ts';

// ---------------------------------------------------------------------------
// Test sprite entity factory — MVP proof-of-life
// ---------------------------------------------------------------------------

/**
 * Creates a simple test sprite entity that bounces around the canvas.
 *
 * This is the MVP entity — it proves the full stack works (bitECS world →
 * PixiJS rendering → visible on canvas). The sprite starts at the canvas
 * center with a diagonal velocity so it visibly moves each frame.
 *
 * @param world - The bitECS world.
 * @param canvasWidth - Width of the canvas in pixels.
 * @param canvasHeight - Height of the canvas in pixels.
 * @returns The entity ID of the test sprite.
 */
const createTestSprite = (world: World, canvasWidth: number, canvasHeight: number): number => {
  const entityId = addEntity(world);

  addComponent(world, entityId, Position);
  addComponent(
    world,
    entityId,
    set(Position, {
      x: canvasWidth / 2,
      y: canvasHeight / 2,
    }),
  );

  addComponent(world, entityId, Velocity);
  addComponent(
    world,
    entityId,
    set(Velocity, {
      x: 80,
      y: 60,
    }),
  );

  addComponent(world, entityId, Sprite);
  addComponent(
    world,
    entityId,
    set(Sprite, {
      textureKey: 'test_sprite',
      tint: 0xff6688, // pinkish-red tint
      displayObject: undefined,
    }),
  );

  return entityId;
};

export { createTestSprite };
