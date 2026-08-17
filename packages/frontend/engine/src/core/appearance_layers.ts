// packages/frontend/engine/src/core/appearance_layers.ts
//
// Shared LPC appearance-layer helpers.
//
// C-374: torso (index 2) and feet (index 4) are equipment-owned — forcing
// them out of the base appearance lets unequipping reveal the bare body and
// renders the base outfit via the equipment service instead. C-417 OQ-1
// resolved: this zero-out is intentional and load-bearing, so both game
// services (boot + engine) must invoke this single helper (C-418).

/**
 * Forces equipment-owned appearance layers (torso index 2, feet index 4) to
 * zero in-place and returns the same array.
 *
 * @param appearanceLayers The LPC appearance-layer indices to mutate.
 * @returns The mutated input array for chaining.
 */
export const zeroEquipmentOwnedAppearanceSlots = (appearanceLayers: number[]): number[] => {
  appearanceLayers[2] = 0;
  appearanceLayers[4] = 0;
  return appearanceLayers;
};
