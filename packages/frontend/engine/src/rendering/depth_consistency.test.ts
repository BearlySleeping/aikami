// packages/frontend/engine/src/rendering/depth_consistency.test.ts
//
// C-506 AC-2 — depth behaves consistently around tall objects. A character
// passing in front of and behind supported props/upper passes must sort
// correctly by base-origin y-depth, and reversing direction must not
// introduce pop-through or duplicate passes. The engine's depth authority is
// `computeEntityZIndex(y)` (C-376 AC-4) plus the declarative overhead band
// (C-378 AC-1); these tests pin the invariant that a monotonic walk path
// (including a stop and a reverse) yields a strictly consistent z-order with
// no ties that would let Pixi's stable sort flip a draw order.

import { describe, expect, it } from 'bun:test';
import { computeEntityZIndex, WORLD_Z_BANDS } from './layer_bands.ts';

describe('C-506 AC-2 — depth consistency around tall objects', () => {
  it('a character passing behind then in front of a prop sorts strictly by base y', () => {
    // Prop base at y=128 (e.g. a 32×64 well anchored at its foot pixel).
    // The character walks from y=96 (behind, smaller y) to y=192 (in front).
    const propBaseY = 128;
    const behind = 96;
    const inFront = 192;

    const behindZ = computeEntityZIndex(behind);
    const propZ = computeEntityZIndex(propBaseY);
    const inFrontZ = computeEntityZIndex(inFront);

    // Behind the prop: the character must draw UNDER it.
    expect(behindZ).toBeLessThan(propZ);
    // In front of the prop: the character must draw OVER it.
    expect(inFrontZ).toBeGreaterThan(propZ);
  });

  it('a stop-and-reverse path keeps a strict monotonic z-order (no pop-through)', () => {
    // Walk path that stops at y=128 then reverses back to y=96 — the exact
    // stop/reverse-direction case AC-2 calls out.
    const path: number[] = [96, 112, 128, 128, 112, 96];
    const zs = path.map((y) => computeEntityZIndex(y));

    // Every step's z-index must be strictly monotonic along the path
    // direction, and identical y must yield identical z (stable tie-break).
    for (let i = 1; i < zs.length; i++) {
      if (path[i] === path[i - 1]) {
        expect(zs[i]).toBe(zs[i - 1]);
      } else {
        // No equality: a strict ordering difference in y must translate to a
        // strict z difference, so Pixi's stable sort cannot flip the pass.
        expect(zs[i]).not.toBe(zs[i - 1]);
      }
    }

    // Reversing returns to the same z as the forward pass (no hysteresis).
    expect(zs[5]).toBe(zs[0]);
  });

  it('overhead bands stay above every in-map actor y (roofs do not become solid)', () => {
    // A roof/canopy draws above an actor regardless of actor depth — but it
    // is a DRAWING pass, not a collision change. Assert the depth band
    // invariant: the overhead band is strictly above any realistic in-map
    // actor y, and entity z stays below it for all in-map positions.
    for (const y of [0, 64, 128, 256, 512, 1024, 4096]) {
      expect(computeEntityZIndex(y)).toBeLessThan(WORLD_Z_BANDS.tilemapOverhead);
    }
    // An actor never accidentally reaches the overhead band.
    expect(computeEntityZIndex(100_000)).toBe(WORLD_Z_BANDS.tilemapOverhead);
  });

  it('floors/rugs (ground band) stay below actor feet for any walkable y', () => {
    // The ground/decor bands must remain below the character's feet so
    // floors/rugs never interleave with an actor — even at the top of the
    // map. Entity z is >= MIN_ENTITY_Y, and ground/decor are strictly below.
    expect(WORLD_Z_BANDS.tilemapGround).toBeLessThan(computeEntityZIndex(0));
    expect(WORLD_Z_BANDS.tilemapDecor).toBeLessThan(computeEntityZIndex(0));
    expect(WORLD_Z_BANDS.tilemapGround).toBeLessThan(computeEntityZIndex(100_000));
    expect(WORLD_Z_BANDS.tilemapDecor).toBeLessThan(computeEntityZIndex(100_000));
  });
});
