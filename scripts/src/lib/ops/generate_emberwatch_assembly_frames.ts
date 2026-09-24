// scripts/src/lib/ops/generate_emberwatch_assembly_frames.ts
//
// Shared atlas dispatch for procedural authored structures. Keeping the
// bridge and house lookups here prevents the large atlas painter registry from
// growing a second branch ladder for every assembly family.

import { BRIDGE_FRAME_PAINT, paintBridgeFrame } from './generate_emberwatch_bridge_frames.ts';
import { paintHouseFrameByName } from './generate_emberwatch_house_frames.ts';

/**
 * Paint a named procedural assembly frame.
 *
 * Returns false for ordinary terrain/decor frames so the caller can continue
 * through the stable atlas painter registry.
 */
export const paintAssemblyFrame = (options: { key: string; col: number; row: number }): boolean => {
  if (paintHouseFrameByName(options)) {
    return true;
  }
  const bridge = BRIDGE_FRAME_PAINT[options.key];
  if (!bridge) {
    return false;
  }
  paintBridgeFrame({ col: options.col, row: options.row, ...bridge });
  return true;
};
