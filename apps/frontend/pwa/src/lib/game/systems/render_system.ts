// apps/frontend/pwa/src/lib/game/systems/render-system.ts
import type { World } from 'bitecs';
import { addComponent, getComponent, query, set } from 'bitecs';
import { type Container, Graphics } from 'pixi.js';
import type { PositionData } from '../components/position.ts';
import { Position } from '../components/position.ts';
import type { SpriteData } from '../components/sprite.ts';
import { Sprite } from '../components/sprite.ts';

// ---------------------------------------------------------------------------
// RenderSystem — sync bitECS entities to PixiJS display objects
// ---------------------------------------------------------------------------

/** Cached query terms — entities with Position + Sprite are rendered. */
const RENDER_QUERY_TERMS = [Position, Sprite];

/**
 * Synchronizes bitECS entity positions to their PixiJS display objects.
 *
 * Runs every frame after the movement system. For each entity with both a
 * {@link Position} and {@link Sprite} component, updates the PixiJS
 * container transform to match the world-space position.
 *
 * Entities without a `displayObject` are skipped — the display object is
 * created lazily in {@link ensureDisplayObject} and stored back via
 * {@link addComponent}.
 *
 * @param world - The bitECS world.
 * @param stage - The PixiJS stage container to add sprites to.
 */
const updateRender = (world: World, stage: Container): void => {
  if (!world || !stage) {
    return;
  }

  const entities = query(world, RENDER_QUERY_TERMS);
  for (const eid of entities) {
    const spriteData = getComponent(world, eid, Sprite) as SpriteData | undefined;
    if (!spriteData) {
      continue;
    }

    let displayObject = spriteData.displayObject;
    if (!displayObject) {
      displayObject = ensureDisplayObject(spriteData, stage);
      if (!displayObject) {
        continue;
      }
      // Store the display object back into the component arrays
      addComponent(
        world,
        eid,
        set(Sprite, {
          ...spriteData,
          displayObject,
        }),
      );
    }

    const pos = getComponent(world, eid, Position) as PositionData | undefined;
    if (!pos) {
      continue;
    }

    displayObject.x = pos.x;
    displayObject.y = pos.y;
  }
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Creates and returns a PixiJS display object for the given sprite data.
 *
 * For the MVP, generates a colored rectangle via {@link Graphics} if no
 * texture key is provided. When texture atlases are available later, this
 * will use {@link PixiSprite} with `Assets.load()`.
 *
 * @param spriteData - The sprite component data.
 * @param stage - The PixiJS stage to add the new display object to.
 * @returns The created display object, or `undefined` on failure.
 */
const ensureDisplayObject = (spriteData: SpriteData, stage: Container): Container | undefined => {
  const { tint } = spriteData;

  // MVP: Programmatic colored rectangle — no texture loading needed
  const graphic = new Graphics();
  graphic.rect(0, 0, 32, 32);
  graphic.fill({ color: tint });

  stage.addChild(graphic);
  return graphic;
};

export { updateRender };
