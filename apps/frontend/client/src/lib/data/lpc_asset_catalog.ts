// apps/frontend/client/src/lib/data/lpc_asset_catalog.ts
import { LpcAnimationState, LpcDirection } from '$lib/data/lpc_models';

// ---------------------------------------------------------------------------
// LPC Asset Catalog — types for slot definitions and variants.
// Actual slot data is generated in lpc_asset_catalog_generated.ts from
// the Universal LPC Spritesheet Character Generator.
// ---------------------------------------------------------------------------

/** Shape type for procedural mock sheet generation. */
export type LpcMockShapeType =
  | 'humanoid'
  | 'elf'
  | 'skeleton'
  | 'mohawk'
  | 'long_braid'
  | 'curly_afro'
  | 'short_crop'
  | 'chainmail'
  | 'leather_vest'
  | 'robe'
  | 'plate_armor'
  | 'plate_greaves'
  | 'cloth_skirt'
  | 'tattered_pants'
  | 'broadsword'
  | 'spear'
  | 'wood_bow'
  | 'shield'
  | 'default';

/** A single variant within an LPC equipment/body slot. */
export type LpcSlotVariant = {
  assetId: string;
  label: string;
  shapeType: LpcMockShapeType;
};

/** Describes an LPC character slot with its available variant options. */
export type LpcSlotDefinition = {
  slot: string;
  label: string;
  variants: LpcSlotVariant[];
};

/** Animation state options for the dropdown selector. */
export const ANIMATION_STATE_OPTIONS: readonly { value: LpcAnimationState; label: string }[] = [
  { value: LpcAnimationState.Walk, label: 'Walk' },
  { value: LpcAnimationState.Spellcast, label: 'Spellcast' },
  { value: LpcAnimationState.Thrust, label: 'Thrust' },
  { value: LpcAnimationState.Slash, label: 'Slash' },
  { value: LpcAnimationState.Shoot, label: 'Shoot' },
  { value: LpcAnimationState.Die, label: 'Die' },
];

/** Direction options for the dropdown selector. */
export const DIRECTION_OPTIONS: readonly { value: LpcDirection; label: string }[] = [
  { value: LpcDirection.Down, label: 'Down' },
  { value: LpcDirection.Up, label: 'Up' },
  { value: LpcDirection.Left, label: 'Left' },
  { value: LpcDirection.Right, label: 'Right' },
];

import { getLpcAssetPath as _getLpcAssetPath } from '$lib/data/lpc_renderer';

/**
 * Asset path resolver for the sandbox/game engine.
 * Delegates to the shared LPC renderer.
 */
export const getLpcAssetPath = (_slot: string, assetId: string, state: LpcAnimationState): string =>
  _getLpcAssetPath(assetId, state);
