// apps/frontend/client/src/lib/data/lpc_asset_catalog.ts

import type { LpcCatalog } from '@aikami/lpc';
import { buildLpcCatalog, LpcAnimationState, LpcDirection, lpcTag } from '@aikami/lpc';
import type { AssetResolver } from '@aikami/types';
import { createRegistryAssetResolver } from '$lib/services/assets/registry_asset_resolver';
import { assetStore } from '$lib/services/assets/asset_store.svelte';

// ---------------------------------------------------------------------------
// LPC Asset Catalog — types for slot definitions and variants.
// Actual slot data is derived at runtime from the asset store's seed rows
// via buildLpcCatalog (see getLpcCatalog below) — not a generated file.
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
  /**
   * Which side of the body this sheet draws on. 'front' when the upstream
   * asset has no behind pass — the overwhelming majority.
   */
  layerRole: 'behind' | 'front';
  /**
   * The complementary variant's assetId, when this sheet is half of a
   * bg/fg pair. Absent for standalone sheets.
   */
  pairedAssetId?: string;
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

// ---------------------------------------------------------------------------
// Catalog builder — memoised on assetStore seed reference
// ---------------------------------------------------------------------------

let _lastSeed: object | null = null;
let _cachedCatalog: LpcCatalog | null = null;

/**
 * Builds the LPC catalog from the asset store's seed rows.
 * Memoised on the seed array reference — repeated calls are O(1).
 * Returns an empty catalog if the seed is not yet loaded.
 */
export const getLpcCatalog = (): LpcCatalog => {
  const seed = assetStore.seed;
  if (!seed) {
    return { slots: [], assetIdsBySlot: {}, allAssetIds: [] };
  }
  if (_lastSeed !== seed.rows) {
    _lastSeed = seed.rows;
    _cachedCatalog = buildLpcCatalog({ entries: seed.rows });
  }
  return _cachedCatalog ?? { slots: [], assetIdsBySlot: {}, allAssetIds: [] };
};

/**
 * Builds an AI prompt string from the LPC catalog.
 * Must be called after the catalog is built (not at module scope).
 */
export const getLpcCatalogPrompt = (catalog: LpcCatalog): string => {
  const parts: string[] = ['Available LPC sprite components (asset IDs by slot):'];
  for (const [slot, ids] of Object.entries(catalog.assetIdsBySlot)) {
    parts.push(`  ${slot}: ${ids.join(', ')}`);
  }
  parts.push(
    '\nWhen generating a character appearance, return a JSON object: {"lpcRecipe": {"head": "head/heads/human_male", ...}}',
  );
  return parts.join('\n');
};

// ── Manifest wiring ────────────────────────────────────────────────────────

let _manifestLoadPromise: Promise<void> | null = null;

/**
 * Ensures the asset manifest is loaded before LPC asset lookups run.
 *
 * Idempotent and deduped — safe to call from every bootstrap / ViewModel
 * wiring point: concurrent callers share a single in-flight manifest fetch.
 * Await this before resolving LPC assets so `getLpcAssetPath` never sees a
 * not-yet-loaded manifest (which would otherwise resolve to null).
 */
export const wireLpcUrlResolver = async (): Promise<void> => {
  if (assetStore.manifest) {
    return;
  }
  if (!_manifestLoadPromise) {
    _manifestLoadPromise = assetStore.fetchManifest().finally(() => {
      _manifestLoadPromise = null;
    });
  }
  await _manifestLoadPromise;
};

// Wire once at module scope — every consumer of getLpcAssetPath imports this
// module, so the manifest fetch is already in flight before any layer lookup
// happens. Each call site still awaits wireLpcUrlResolver() itself before
// relying on the result.
void wireLpcUrlResolver();

/**
 * Asset path resolver for the sandbox/game engine.
 * Resolves the LPC (assetId, state) pair to a static URL via the asset store.
 */
export const getLpcAssetPath = (
  _slot: string,
  assetId: string,
  state: LpcAnimationState,
): string | null => assetStore.resolveUrl(lpcTag(assetId, state));

/**
 * Registry-backed {@link AssetResolver} for `createLpcRenderer` consumers
 * (e.g. the LPC preview). Resolves through the same asset store lookup as
 * {@link getLpcAssetPath}, so callers must still `await wireLpcUrlResolver()`
 * before resolving.
 */
export const lpcAssetResolver: AssetResolver = createRegistryAssetResolver();
