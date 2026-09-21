// packages/frontend/engine/src/rendering/prop_presentation.ts
//
// Prop presentation math + the renderer-owned contact shadow (C-496/C-529).
//
// Two independent concerns that both exist because texture packing must never
// dictate gameplay/visual geometry:
//
//   1. `computePropRenderSize` — the authored logical WORLD size of a prop,
//      decoupled from the packed texture frame's pixel size. A frame packed
//      from a 512×512 preparation canvas can render at 32×48 world pixels.
//   2. `createContactShadow` — a cheap, deterministic contact shadow drawn at
//      the prop's ground/contact point. It is renderer-owned metadata, never a
//      baked opaque ground rectangle in the art.
//
// Everything here is allocation-free at frame time: shadows are built once, at
// prop load, and the per-frame depth sort is untouched (the shadow is a child
// of the prop container, which is itself sorted by its base Y).

import type { PropContactShadow } from '@aikami/schemas';
import { type Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { computePropRenderSize } from './prop_render_size.ts';

export { computePropRenderSize } from './prop_render_size.ts';
export type { PropRenderSize } from './prop_render_size.ts';

export type { PropContactShadow };

/** Default shadow opacity — deliberately subtle for a pixel-friendly style. */
export const DEFAULT_CONTACT_SHADOW_OPACITY = 0.22;

/** Colour of a contact shadow — near-black, never pure black (reads softer). */
export const CONTACT_SHADOW_COLOR = 0x0a0d10;

/** Contact-point geometry for a shadow, relative to the prop's anchor origin. */
export type ContactShadowGeometry = {
  /** Half-width of the ellipse (world px). */
  halfWidth: number;
  /** Half-height of the ellipse (world px). */
  halfHeight: number;
  /** Centre X, relative to the prop's anchor/contact origin. */
  offsetX: number;
  /** Centre Y, relative to the prop's anchor/contact origin. */
  offsetY: number;
  /** Resolved opacity. */
  opacity: number;
};

/**
 * Pure geometry resolution for a contact shadow.
 *
 * Returns `null` when there is no shadow to draw (`kind: 'none'`, a zero-sized
 * footprint, or zero opacity), so callers never allocate an empty display
 * object.
 */
export const resolveContactShadowGeometry = (
  shadow: PropContactShadow | undefined,
): ContactShadowGeometry | null => {
  if (shadow === undefined || shadow.kind !== 'ellipse') {
    return null;
  }
  const opacity = shadow.opacity ?? DEFAULT_CONTACT_SHADOW_OPACITY;
  if (opacity <= 0 || shadow.width <= 0 || shadow.height <= 0) {
    return null;
  }
  return {
    halfWidth: shadow.width / 2,
    halfHeight: shadow.height / 2,
    offsetX: shadow.offsetX ?? 0,
    offsetY: shadow.offsetY ?? 0,
    opacity: Math.min(1, opacity),
  };
};

/**
 * Builds the renderer-owned contact shadow for one prop.
 *
 * A soft look is achieved with layered ellipses (a wider, fainter halo under a
 * tighter, darker core) — no filters, no per-frame allocation, and no baked
 * ground rectangle in the prop art. The returned Graphics is positioned at the
 * prop's anchor/contact origin; the caller adds it BEFORE the prop sprite so it
 * composites underneath.
 *
 * Returns `null` when {@link resolveContactShadowGeometry} says there is
 * nothing to draw.
 */
export const createContactShadow = (shadow: PropContactShadow | undefined): Graphics | null => {
  const geometry = resolveContactShadowGeometry(shadow);
  if (geometry === null) {
    return null;
  }
  const graphics = new Graphics();
  // Outer halo → core. Each layer is a separate fill so alpha accumulates
  // softly toward the centre without a blur pass.
  const layers = [
    { scale: 1, alpha: geometry.opacity * 0.55 },
    { scale: 0.72, alpha: geometry.opacity * 0.7 },
    { scale: 0.46, alpha: geometry.opacity },
  ] as const;
  for (const layer of layers) {
    graphics.ellipse(0, 0, geometry.halfWidth * layer.scale, geometry.halfHeight * layer.scale);
    graphics.fill({ color: CONTACT_SHADOW_COLOR, alpha: layer.alpha });
  }
  graphics.position.set(geometry.offsetX, geometry.offsetY);
  return graphics;
};

/** Per-frame presentation metadata consumed by {@link composePropDisplay}. */
export type PropDisplayMeta = {
  anchorX: number;
  anchorY: number;
  renderWidth?: number;
  renderHeight?: number;
  shadow?: PropContactShadow;
};

/**
 * Composes a prop's display children onto its entity container: an optional
 * contact shadow (added first, so it composites underneath) and the sized,
 * anchored sprite. Returns the resolved world size for diagnostics.
 *
 * Kept here rather than in `game_world.ts` because the container and the
 * metadata are the whole responsibility — no engine state is involved.
 */
export const composePropDisplay = (options: {
  container: Container;
  texture: Texture;
  meta: PropDisplayMeta;
}): { width: number; height: number; hasShadow: boolean } => {
  const { container, texture, meta } = options;
  const renderSize = computePropRenderSize({
    textureWidth: texture.width,
    textureHeight: texture.height,
    ...(meta.renderWidth === undefined ? {} : { renderWidth: meta.renderWidth }),
    ...(meta.renderHeight === undefined ? {} : { renderHeight: meta.renderHeight }),
  });
  const sprite = new Sprite(texture);
  sprite.width = renderSize.width;
  sprite.height = renderSize.height;
  sprite.anchor.set(meta.anchorX, meta.anchorY);

  const shadow = createContactShadow(meta.shadow);
  if (shadow) {
    container.addChild(shadow);
  }
  container.addChild(sprite);
  return { width: renderSize.width, height: renderSize.height, hasShadow: shadow !== null };
};
