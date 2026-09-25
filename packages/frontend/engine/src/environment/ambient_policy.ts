// packages/frontend/engine/src/environment/ambient_policy.ts
//
// C-545 — the ONE documented ambient policy for the world scene.
//
// Before C-545 the day/night/interior ambient reached terrain only: the
// tilemap shader multiplied every ground pixel by `uTint` (C-378/C-417), while
// standalone prop sprites, LPC actors and static enemies rendered at their
// source brightness. This module is the single resolver both consumers use:
//
//   • terrain  → the same normalized RGB as the tilemap `uTint` float uniform
//   • props/   → the same factor packed as a PixiJS display-object tint
//     actors/enemies
//
// The policy:
//   1. Interiors pin to {@link COLOR_INTERIOR}, independent of the clock.
//   2. Outdoors follow the worker's environment UBO ambient while it exists,
//      and stay neutral (1,1,1) before the first UBO arrives, so boot is
//      pixel-identical to an untinted render.
//   3. The HUD is never tinted (it lives outside the world container and is
//      not passed to this module).
//   4. Emissive props (a lit hearth, a brazier) opt out explicitly and keep
//      their authored colour.
//
// Terrain must never be double-tinted: the world container and stage are left
// untouched; only per-entity containers are tinted.

import type { Container } from 'pixi.js';
import { COLOR_INTERIOR, ENV_UBO_OFFSETS } from './environment_ubo.ts';

/**
 * One resolved ambient multiplier. `r`/`g`/`b` are the exact normalized
 * channels the tilemap shader receives as `uTint`; `hex` is the identical
 * factor packed for a PixiJS tint (0xRRGGBB).
 */
export type SceneAmbient = {
  r: number;
  g: number;
  b: number;
  hex: number;
};

/** Neutral multiplier — an untinted render. Used before the worker UBO arrives. */
export const NEUTRAL_SCENE_AMBIENT: SceneAmbient = {
  r: 1,
  g: 1,
  b: 1,
  hex: 0xffffff,
};

const clamp01 = (value: number): number => {
  if (Number.isNaN(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
};

/** Packs normalized channels into a 0xRRGGBB display tint. */
export const ambientToHex = (r: number, g: number, b: number): number =>
  (Math.round(clamp01(r) * 255) << 16) |
  (Math.round(clamp01(g) * 255) << 8) |
  Math.round(clamp01(b) * 255);

/**
 * Resolves the scene ambient from the interior flag and the worker UBO.
 *
 * The returned `r`/`g`/`b` are written verbatim into terrain's `uTint`, and
 * `hex` is applied to prop/actor/enemy containers — so both consumers
 * multiply by exactly the same factor.
 */
export const resolveSceneAmbient = (options: {
  isInterior: boolean;
  environmentUbo: Float32Array | undefined;
}): SceneAmbient => {
  let r = 1;
  let g = 1;
  let b = 1;

  if (options.isInterior) {
    // Interiors are lit independently of the world clock (C-417 AC-2).
    r = COLOR_INTERIOR[0] ?? 1;
    g = COLOR_INTERIOR[1] ?? 1;
    b = COLOR_INTERIOR[2] ?? 1;
  } else if (options.environmentUbo) {
    const ubo = options.environmentUbo;
    r = ubo[ENV_UBO_OFFSETS.ambientColor + 0] ?? 1;
    g = ubo[ENV_UBO_OFFSETS.ambientColor + 1] ?? 1;
    b = ubo[ENV_UBO_OFFSETS.ambientColor + 2] ?? 1;
  }

  const cr = clamp01(r);
  const cg = clamp01(g);
  const cb = clamp01(b);
  return { r: cr, g: cg, b: cb, hex: ambientToHex(cr, cg, cb) };
};

/**
 * Applies the ambient multiplier to one entity's display container.
 *
 * Container tint cascades to every descendant (current and future), so this
 * covers LPC layer sprites, static actor/enemy images, prop sprites — and a
 * prop whose texture loads AFTER the hour changed, because the tint lives on
 * the container rather than the sprite.
 *
 * @returns `true` when the tint changed (so callers can skip no-op churn).
 */
export const applyAmbientToEntity = (options: {
  displayObject: Container;
  ambient: SceneAmbient;
  /** Emissive props (lit hearth, brazier) keep their authored colour. */
  exempt?: boolean;
}): boolean => {
  if (options.exempt === true) {
    return false;
  }
  if (options.displayObject.tint === options.ambient.hex) {
    return false;
  }
  options.displayObject.tint = options.ambient.hex;
  return true;
};
