// packages/frontend/engine/src/game_world/entity_display.ts
//
// The display object a newly created entity gets, before any appearance load.
//
// Extracted from `game_world.ts` — that file is at its reviewed size ceiling,
// and this is a self-contained responsibility: it reads a tint, a frame and a
// spawn counter, and produces a container plus the render entry that owns it.
//
// ⚠️  NEVER set `.width` / `.height` on an empty Container. PixiJS computes an
// internal scale multiplier by dividing the target width by the container's
// local bounds — with no children the local bounds are (0,0,0,0), producing a
// scale of 0 (or Infinity), which makes ALL future children invisible.

import type { Application } from 'pixi.js';
import { Container, Sprite, Texture } from 'pixi.js';
import { AnimationController } from '../rendering/animation_controller.ts';
import type { RenderEntry } from './render_entry.ts';

export type EntityDisplay = {
  container: Container;
  entry: RenderEntry;
};

/** Builds the placeholder container and the render entry for one entity. */
export const createEntityDisplay = (options: {
  eid: number;
  tint: number;
  /** Assigned to the entry; the caller owns the monotonic counter. */
  spawnOrder: number;
  /** The world container, or undefined before it exists (stage is the fallback). */
  worldContainer: Container | undefined;
  stage: Application['stage'];
  /** Resolves a prop's named atlas frame; absent leaves the placeholder. */
  loadPropFrame:
    | ((options: { eid: number; frame: string; container: Container }) => void)
    | undefined;
  frame: string | undefined;
  /** C-545: light-source prop — skipped by the scene ambient tint. */
  ambientExempt?: boolean;
  onAddedToStage: (info: { eid: number; stageChildren: number }) => void;
}): EntityDisplay => {
  const container = new Container();

  // Draw a debug colored square using the worker's tint so entities are visible
  // even before LPC textures load. Uses Sprite(Texture.WHITE) because PixiJS v8
  // Graphics has compat issues in headless WebGL. Anchored bottom-center
  // (0.5, 1.0) so the position represents the character's feet — consistent with
  // the LPC layer sprite anchor. 32×32 world units → 128×128 screen pixels at
  // 4× scale. The worker posts a numeric tint; guard NaN from a malformed
  // message rather than rendering an invisible (NaN-tinted) placeholder.
  const safeTint = Number.isNaN(options.tint) ? 0xff00ff : options.tint;
  const sprite = new Sprite(Texture.WHITE);
  sprite.width = 32;
  sprite.height = 32;
  sprite.anchor.set(0.5, 1.0);
  sprite.tint = safeTint;
  container.addChild(sprite);

  // Props carry their named atlas frame from the worker — swap the white
  // placeholder for the real tileset sprite (e.g. "well.png"). The atlas
  // spritesheet is preloaded at boot so Texture.from(frame) resolves.
  if (options.frame && options.loadPropFrame) {
    options.loadPropFrame({ eid: options.eid, frame: options.frame, container });
  }

  // Per-contract C-032: bypass layout hit-tests for character visuals
  container.eventMode = 'none';

  // Add to the world container (scaled + centered) instead of raw stage
  const target = options.worldContainer ?? options.stage;
  target.addChild(container);
  options.onAddedToStage({ eid: options.eid, stageChildren: options.stage.children.length });

  return {
    container,
    entry: {
      displayObject: container,
      spawnOrder: options.spawnOrder,
      // Initialize per-entity animation controller for walk/idle state
      animationController: new AnimationController(),
      tint: options.tint,
      ...(options.ambientExempt ? { ambientExempt: true } : {}),
      cullable: true,
      recipes: [],
    },
  };
};
