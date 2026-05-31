// packages/engine/src/systems/render_system.ts
import type { World } from 'bitecs';
import { addComponent, getComponent, query, set } from 'bitecs';
import { type Container, Graphics } from 'pixi.js';
import type { PositionData } from '../components/position.ts';
import { Position } from '../components/position.ts';
import type { SpriteData } from '../components/sprite.ts';
import { Sprite } from '../components/sprite.ts';
import { COMPONENT_STRIDE } from '../config/memory_config.ts';

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

/**
 * Per-entity render entry for buffer-based rendering.
 *
 * Used by GameWorld's buffer render path when the bitECS world runs in a
 * Web Worker and entity positions arrive via a Float32Array buffer.
 */
export type RenderEntry = {
  /** The PixiJS display object for this entity. */
  displayObject: Container;
  /** Tint color for the entity. */
  tint: number;
};

/**
 * Updates PixiJS display object positions from a Float32Array render buffer.
 *
 * This variant is used when the bitECS world runs in a Web Worker and
 * entity positions arrive via shared memory (SharedArrayBuffer) or
 * Transferable ArrayBuffer. It reads positions directly from the
 * Float32Array buffer instead of querying bitECS components.
 *
 * The buffer layout is: `[eid * COMPONENT_STRIDE + 0] = x`,
 * `[eid * COMPONENT_STRIDE + 1] = y`, `[eid * COMPONENT_STRIDE + 2] = rotation`.
 *
 * @param renderView - Float32Array view into the entity state buffer.
 * @param renderEntries - Map of entity ID → render entry.
 */
const updateRenderFromBuffer = (
  renderView: Float32Array,
  renderEntries: Map<number, RenderEntry>,
): void => {
  if (!renderView || !renderEntries) {
    return;
  }

  for (const [eid, entry] of renderEntries) {
    const offset = eid * COMPONENT_STRIDE;
    const x = renderView[offset];
    const y = renderView[offset + 1];

    if (x === undefined || y === undefined) {
      continue;
    }

    entry.displayObject.x = x;
    entry.displayObject.y = y;
  }
};

export { updateRender, updateRenderFromBuffer };
