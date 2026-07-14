// packages/frontend/engine/src/components/visual.ts

import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// Visual — pure numeric SoA component for PixiJS rendering
//
// Contract C-170: Decouples PixiJS objects from bitECS by storing only
// numeric asset metadata. The rendering system maintains a private
// Map<eid, DisplayObject> — the ECS world never holds PixiJS references.
//
// Uses sparse arrays (bitECS SoA convention) with numeric-only fields:
//   - assetIndex: number → maps to an AssetAlias
//   - tint: number → hex colour (e.g. 0xffcc00)
//   - visible: number → 1 = visible, 0 = hidden
// ---------------------------------------------------------------------------

/** SoA storage for visual rendering data. Indexed by entity ID. */
export const Visual = {
  /** Integer ID corresponding to the asset dictionary or alias. */
  assetIndex: [] as number[],
  /** Hex colour tint (e.g. 0xffcc00). */
  tint: [] as number[],
  /** Visibility flag: 1 = visible, 0 = hidden. */
  visible: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type VisualData = {
  assetIndex: number;
  tint: number;
  visible: number;
};

/**
 * Maps integer constants to PixiJS asset alias strings.
 *
 * The rendering system reads `Visual.assetIndex[eid]` and resolves the
 * corresponding texture path from this dictionary during `onAdd`.
 *
 * Values 0–999 are reserved for core asset aliases.  Values ≥ 1000 are
 * reserved for dynamic/procedural assets.
 */
export const AssetAlias = {
  // biome-ignore lint/style/useNamingConvention: enum-like constant names
  PLACEHOLDER: 0,
  // biome-ignore lint/style/useNamingConvention: enum-like constant names
  PLAYER: 1,
  // biome-ignore lint/style/useNamingConvention: enum-like constant names
  NPC: 2,
  // biome-ignore lint/style/useNamingConvention: enum-like constant names
  PROP_CHEST: 3,
  // biome-ignore lint/style/useNamingConvention: enum-like constant names
  ENEMY: 4,
  // biome-ignore lint/style/useNamingConvention: enum-like constant names
  ITEM: 6,
} as const;

/** Type alias for AssetAlias values. */
export type AssetAlias = (typeof AssetAlias)[keyof typeof AssetAlias];

/**
 * Resolves an AssetAlias to a PixiJS asset path string.
 *
 * Used by the rendering system to load textures when `onAdd(Visual)`
 * fires for a new entity.
 *
 * @param alias - The numeric asset alias.
 * @returns A PixiJS asset path string, or empty string for PLACEHOLDER.
 */
export const resolveAssetPath = (alias: number): string => {
  switch (alias) {
    case AssetAlias.PLAYER:
      return 'player';
    case AssetAlias.NPC:
      return '/game-data/lpc/body/male/walk.png';
    case AssetAlias.PROP_CHEST:
      return '/game-data/lpc/props/chest_01.png';
    case AssetAlias.ENEMY:
      return 'enemy';

    case AssetAlias.ITEM:
      return 'item';
    default:
      return '';
  }
};

/**
 * Registers onSet and onGet observers for the Visual component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerVisualObservers = (world: World): void => {
  observe(world, onSet(Visual), (eid: number, params: VisualData) => {
    Visual.assetIndex[eid] = params.assetIndex;
    Visual.tint[eid] = params.tint;
    Visual.visible[eid] = params.visible;
  });

  observe(
    world,
    onGet(Visual),
    (eid: number): VisualData => ({
      assetIndex: Visual.assetIndex[eid],
      tint: Visual.tint[eid],
      visible: Visual.visible[eid],
    }),
  );
};
