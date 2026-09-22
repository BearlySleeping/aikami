// packages/frontend/engine/src/rendering/prop_presentation.test.ts
//
// C-496/C-529: prop logical sizing + contact shadow geometry.
//
// These are the invariants that make texture packing unable to dictate world
// geometry: a 512px preparation canvas renders at an authored 32×48 world
// size, legacy props (no authored size) keep native pixels, and neither an
// atlas repack nor a render-size change can move a prop's ground point.

import { describe, expect, test } from 'bun:test';
import {
  CONTACT_SHADOW_COLOR,
  computePropRenderSize,
  DEFAULT_CONTACT_SHADOW_OPACITY,
  resolveContactShadowGeometry,
} from './prop_presentation.ts';

describe('computePropRenderSize', () => {
  test('a 512px generation canvas can intentionally render as 32×48 world px', () => {
    const size = computePropRenderSize({
      textureWidth: 512,
      textureHeight: 512,
      renderWidth: 32,
      renderHeight: 48,
    });
    expect(size).toEqual({ width: 32, height: 48 });
  });

  test('explicit width and height are used verbatim even when they change aspect', () => {
    const size = computePropRenderSize({
      textureWidth: 181,
      textureHeight: 133,
      renderWidth: 32,
      renderHeight: 48,
    });
    expect(size).toEqual({ width: 32, height: 48 });
  });

  test('a single authored dimension preserves the texture aspect ratio', () => {
    // 512×256 texture (2:1): pinning width 64 must derive height 32.
    expect(
      computePropRenderSize({ textureWidth: 512, textureHeight: 256, renderWidth: 64 }),
    ).toEqual({ width: 64, height: 32 });
    // Pinning height 80 on a 100×200 texture must derive width 40.
    expect(
      computePropRenderSize({ textureWidth: 100, textureHeight: 200, renderHeight: 80 }),
    ).toEqual({ width: 40, height: 80 });
  });

  test('legacy props without an authored size keep the texture native pixels', () => {
    expect(computePropRenderSize({ textureWidth: 32, textureHeight: 32 })).toEqual({
      width: 32,
      height: 32,
    });
    expect(computePropRenderSize({ textureWidth: 192, textureHeight: 152 })).toEqual({
      width: 192,
      height: 152,
    });
  });

  test('atlas packing cannot alter the logical world size', () => {
    // The same authored size resolves identically regardless of the packed
    // frame dimensions — the packer may lay the frame out on any page.
    const authored = { renderWidth: 32, renderHeight: 48 } as const;
    const packedSmall = computePropRenderSize({
      textureWidth: 256,
      textureHeight: 256,
      ...authored,
    });
    const packedLarge = computePropRenderSize({
      textureWidth: 1024,
      textureHeight: 1024,
      ...authored,
    });
    expect(packedSmall).toEqual({ width: 32, height: 48 });
    expect(packedLarge).toEqual({ width: 32, height: 48 });
  });

  test('never returns a zero or negative dimension', () => {
    expect(computePropRenderSize({ textureWidth: 0, textureHeight: 0 })).toEqual({
      width: 1,
      height: 1,
    });
    expect(
      computePropRenderSize({ textureWidth: 64, textureHeight: 64, renderWidth: 0.2 }),
    ).toEqual({ width: 1, height: 1 });
  });

  test('authored world size is independent of the anchor origin', () => {
    // Ground contact is expressed by the anchor (normalized) + the container
    // Y; the render size changes only the sprite extent above the anchor.
    const size = computePropRenderSize({
      textureWidth: 512,
      textureHeight: 512,
      renderWidth: 192,
      renderHeight: 224,
    });
    expect(size).toEqual({ width: 192, height: 224 });
  });
});

describe('resolveContactShadowGeometry', () => {
  test('returns null for an explicit none', () => {
    expect(resolveContactShadowGeometry({ kind: 'none' })).toBeNull();
  });

  test('returns null when undefined (legacy props get no shadow)', () => {
    expect(resolveContactShadowGeometry(undefined)).toBeNull();
  });

  test('returns null for a zero-sized or zero-opacity footprint', () => {
    expect(resolveContactShadowGeometry({ kind: 'ellipse', width: 0, height: 10 })).toBeNull();
    expect(
      resolveContactShadowGeometry({ kind: 'ellipse', width: 20, height: 10, opacity: 0 }),
    ).toBeNull();
  });

  test('resolves an ellipse footprint centred on the contact point by default', () => {
    const geometry = resolveContactShadowGeometry({
      kind: 'ellipse',
      width: 30,
      height: 12,
    });
    expect(geometry).toEqual({
      halfWidth: 15,
      halfHeight: 6,
      offsetX: 0,
      offsetY: 0,
      opacity: DEFAULT_CONTACT_SHADOW_OPACITY,
    });
  });

  test('honours an authored offset and clamps opacity to 1', () => {
    const geometry = resolveContactShadowGeometry({
      kind: 'ellipse',
      width: 40,
      height: 16,
      offsetX: 3,
      offsetY: -2,
      opacity: 4,
    });
    expect(geometry).toEqual({
      halfWidth: 20,
      halfHeight: 8,
      offsetX: 3,
      offsetY: -2,
      opacity: 1,
    });
  });

  test('shadow colour is a soft near-black, never pure black', () => {
    expect(CONTACT_SHADOW_COLOR).not.toBe(0x000000);
  });
});
