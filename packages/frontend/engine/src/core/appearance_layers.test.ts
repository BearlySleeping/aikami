// packages/frontend/engine/src/core/appearance_layers.test.ts
//
// Contract C-418: shared appearanceLayers zero-out helper (C-417 OQ-1
// resolved — the zero-out is intentional, not a bug to remove).

import { describe, expect, it } from 'bun:test';
import { zeroEquipmentOwnedAppearanceSlots } from './appearance_layers.ts';

describe('zeroEquipmentOwnedAppearanceSlots', () => {
  it('forces torso (2) and feet (4) to zero in-place', () => {
    const layers = [1, 1, 1, 1, 1, 1];
    const result = zeroEquipmentOwnedAppearanceSlots(layers);
    expect(result).toBe(layers);
    expect(layers[2]).toBe(0);
    expect(layers[4]).toBe(0);
  });

  it('preserves every other layer index', () => {
    const layers = [3, 2, 1, 4, 5, 6, 7];
    zeroEquipmentOwnedAppearanceSlots(layers);
    expect(layers[0]).toBe(3);
    expect(layers[1]).toBe(2);
    expect(layers[3]).toBe(4);
    expect(layers[5]).toBe(6);
    expect(layers[6]).toBe(7);
  });

  it('tolerates arrays shorter than index 5', () => {
    const layers: number[] = [];
    zeroEquipmentOwnedAppearanceSlots(layers);
    expect(layers[2]).toBe(0);
    expect(layers[4]).toBe(0);
    expect(layers.length).toBe(5);
  });

  it('returns the same array reference for chaining', () => {
    const layers = [1, 1, 1, 1, 1];
    const returned = zeroEquipmentOwnedAppearanceSlots(layers);
    expect(returned).toBe(layers);
  });
});
