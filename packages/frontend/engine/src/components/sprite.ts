// apps/frontend/game/src/engine/components/sprite.ts

import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';
import type { Container } from 'pixi.js';

// ---------------------------------------------------------------------------
// Sprite — SoA component for PixiJS rendering
// ---------------------------------------------------------------------------

/** SoA storage for sprite rendering data. Indexed by entity ID. */
export const Sprite = {
  textureKey: [] as string[],
  tint: [] as number[],
  /** PixiJS display object reference — internal, never crosses the bridge. */
  displayObject: [] as Array<Container | undefined>,
};

/** Payload shape stored/retrieved via observers. */
export type SpriteData = {
  textureKey: string;
  tint: number;
  displayObject: Container | undefined;
};

/**
 * Registers onSet and onGet observers for the Sprite component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerSpriteObservers = (world: World): void => {
  observe(world, onSet(Sprite), (eid: number, params: SpriteData) => {
    Sprite.textureKey[eid] = params.textureKey;
    Sprite.tint[eid] = params.tint;
    Sprite.displayObject[eid] = params.displayObject;
  });

  observe(
    world,
    onGet(Sprite),
    (eid: number): SpriteData => ({
      textureKey: Sprite.textureKey[eid],
      tint: Sprite.tint[eid],
      displayObject: Sprite.displayObject[eid],
    }),
  );
};
