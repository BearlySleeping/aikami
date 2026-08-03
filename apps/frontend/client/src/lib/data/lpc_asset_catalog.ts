// apps/frontend/client/src/lib/data/lpc_asset_catalog.ts
import { LpcAnimationState, LpcDirection } from '$lib/data/lpc_models';
import { setLpcUrlResolver } from '$lib/data/lpc_renderer';
import { lpcTag } from '$lib/data/lpc_tags';
import { assetStore } from '$lib/services/assets/asset_store.svelte';

// ---------------------------------------------------------------------------
// LPC Asset Catalog — types for slot definitions and variants.
// Actual slot data is generated in lpc_asset_catalog_generated.ts from
// the Universal LPC Spritesheet Character Generator.
// ---------------------------------------------------------------------------

/** Slots that every LPC character recipe MUST include for a valid render. */
export const REQUIRED_LPC_SLOTS = ['head', 'body', 'torso'] as const;

/** Default head asset used as fallback when a character's head texture fails to load. */
export const LPC_DEFAULT_HEAD_ASSET_ID = 'head/heads/human_male';

/** Default body asset used as fallback when a character's body layer is missing. */
export const LPC_DEFAULT_BODY_ASSET_ID = 'body/bodies/male/light';

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
 * Wires the manifest-backed LPC URL resolver into the shared renderer.
 *
 * Idempotent — safe to call from every bootstrap / ViewModel wiring point.
 * Also ensures the manifest is fetched so /game and the dev LPC pages can
 * resolve layers on first paint.
 */
export const wireLpcUrlResolver = (): void => {
  setLpcUrlResolver((assetId, state) => assetStore.resolveUrl(lpcTag(assetId, state)));
  if (!assetStore.manifest && !assetStore.isLoading) {
    void assetStore.fetchManifest();
  }
};

// Wire once at module scope — every consumer of getLpcAssetPath imports this
// module, so the renderer is manifest-aware before any layer lookup happens.
wireLpcUrlResolver();

/**
 * Asset path resolver for the sandbox/game engine.
 * Delegates to the shared LPC renderer.
 */
export const getLpcAssetPath = (
  _slot: string,
  assetId: string,
  state: LpcAnimationState,
): string | null => _getLpcAssetPath(assetId, state);
