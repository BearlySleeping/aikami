// packages/frontend/engine/src/game_world/render_entry.ts
//
// The main-thread record for one rendered entity. Shared by the facade (which
// creates/disposes entries) and the frame renderer (which updates them each
// frame), so neither owns the other.

import type { Container } from 'pixi.js';
import type { LpcLayerRecipe } from '../components/appearance.ts';
import type { AnimationController } from '../rendering/animation_controller.ts';
import type { AppearanceLayer } from './entity_appearance.ts';

/** Per-entity rendering data stored on the main thread. */
export type RenderEntry = {
  /** The PixiJS display object (Sprite or Container). */
  displayObject: Container;
  /**
   * Monotonic spawn order — tie-break for y-depth sorting so equal-Y
   * entities render deterministically without per-frame flicker (C-375 AC-2).
   */
  spawnOrder: number;
  /**
   * Per-entity animation controller for directional walk/idle.
   *
   * Computes spritesheet frame indices from positional deltas across
   * frames without access to the worker's Velocity component.
   */
  animationController?: AnimationController;
  /** Tint color for the entity. */
  tint: number;
  /** When `true`, spatial culling is enabled for this entity. */
  cullable: boolean;
  /** Layer recipes for multi-layer rendering. */
  recipes?: LpcLayerRecipe[];
  /** Active layer sprites (owned by the appearance loader). */
  layerSprites?: AppearanceLayer[];
};
