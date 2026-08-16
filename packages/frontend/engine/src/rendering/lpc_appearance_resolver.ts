// packages/frontend/engine/src/rendering/lpc_appearance_resolver.ts
//
// Unified LPC appearance resolver (C-400).
//
// LPC appearance resolution previously existed THREE times (worker resolver,
// game_engine_service._buildLpcPipeline, game_boot_service._buildLpcPipeline)
// with divergent outputs — the worker emitted raw numeric index strings, the
// client copies resolved against the generated catalog, and a hard-coded head
// override silently replaced any non-head head-slot index with human_male.
//
// This module collapses the divergent copies into ONE pure function. Both the
// simulation worker and the client call it with the SAME catalog, so a given
// six-layer appearance resolves to the same slot/assetId sequence everywhere.
//
// ## Conventions (load-bearing)
//
// - **1-indexed layer values.** Manifests and saves store 1-indexed variant
//   numbers; `variants` is 0-indexed. `resolveLpcAppearance` applies the
//   `- 1` internally. Do not "simplify" this away — old saves stay valid only
//   because of it.
// - **Index 0 means intentionally empty.** `_buildPlayerData` writes 0 for
//   torso and feet (equipment-owned slots). A literal 0 resolves to an
//   `empty` recipe entry (slot present, `assetId: ''`, zero-filled palette)
//   and NEVER logs a fallback warning — distinguishing "intentionally empty"
//   from "unresolvable" prevents warning spam for every player entity.
// - **Every slot has a declared fallback.** Out-of-range or missing non-zero
//   indices resolve to the slot's fallback asset and log a `warn` once per
//   entity per slot (naming slot, requested index, catalog size). There is
//   no code path where an unresolved slot produces no recipe.
// - **No head override.** The old `effectiveIdx = 94` correction is removed.
//   Head validity is a content-load-time concern (see the content validator),
//   never a per-render correction.

import { logger } from '$logger';
import type { LpcLayerRecipe } from '../components/appearance.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One engine appearance slot, in render order. */
export type LpcSlotName = 'body' | 'hair' | 'torso' | 'legs' | 'feet' | 'head';

/** Per-slot catalog: the variants available for one slot. */
export type LpcSlotCatalog = {
  readonly slot: LpcSlotName;
  readonly variants: readonly { readonly assetId: string }[];
};

/** Fallback asset per slot, used when an index does not resolve. */
export type LpcSlotFallbacks = Readonly<Record<LpcSlotName, string>>;

/** Why a slot resolved the way it did — carried for observability. */
export type LpcSlotResolution =
  | { readonly kind: 'resolved'; readonly assetId: string }
  | {
      readonly kind: 'fallback';
      readonly assetId: string;
      /** 1-indexed value requested; `null` when the slot was missing from a short input array. */
      readonly requestedIndex: number | null;
      readonly catalogSize: number;
    }
  | { readonly kind: 'empty' };

/** The resolver result: always six entries, never fewer. */
export type LpcAppearanceResult = {
  readonly recipes: readonly {
    readonly slot: LpcSlotName;
    readonly assetId: string;
    readonly hexPalette: Uint8Array;
  }[];
  readonly resolutions: Readonly<Record<LpcSlotName, LpcSlotResolution>>;
};

/** Options for {@link resolveLpcAppearance}. */
export type ResolveLpcAppearanceOptions = {
  /** Six layer indices (1-indexed variant numbers; 0 = intentionally empty). */
  layerIds: readonly number[];
  /** The LPC slot catalog, injected so worker + client share one resolver. */
  catalog: readonly LpcSlotCatalog[];
  /** Per-slot fallback assets. */
  fallbacks: LpcSlotFallbacks;
};

// ---------------------------------------------------------------------------
// Fallback table (data, not scattered branches)
// ---------------------------------------------------------------------------

/**
 * Default per-slot fallback assets — every one exists in the generated LPC
 * catalog (verified 2026-08-16). The head fallback points at a real
 * `head/heads/` asset (head slot variants also include ears/faces).
 */
export const DEFAULT_LPC_SLOT_FALLBACKS: LpcSlotFallbacks = {
  body: 'body/bodies_male',
  hair: 'hair/bangs_adult',
  torso: 'torso/chainmail_male',
  legs: 'legs/pants_male',
  feet: 'feet/shoes/basic_male',
  head: 'head/heads/human_male',
};

/** Engine slot order — matches the render z-order and the six layer slots. */
export const LPC_SLOT_ORDER: readonly LpcSlotName[] = [
  'body',
  'hair',
  'torso',
  'legs',
  'feet',
  'head',
] as const;

// ---------------------------------------------------------------------------
// Dedup of fallback warnings
// ---------------------------------------------------------------------------

/** Fallback warn keys already logged — one warn per entity per slot. */
const _loggedFallbackKeys = new Set<string>();

const _fallbackKey = (
  slot: LpcSlotName,
  requestedIndex: number | null,
  catalogSize: number,
): string => `${slot}:${requestedIndex}:${catalogSize}`;

/** Resets the fallback warn dedup (tests / hot reload). */
export const resetLpcFallbackWarnings = (): void => {
  _loggedFallbackKeys.clear();
};

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolves appearance layer indices to LPC layer recipes.
 *
 * Always returns six entries (one per {@link LPC_SLOT_ORDER} slot) even for
 * short input arrays — a missing trailing slot degrades to its declared
 * fallback (recorded as `requestedIndex: null`). Index 0 is *intentionally
 * empty* (recipe present with `assetId: ''` and a zero-filled palette — no
 * warning). A non-zero index that is out of range for its slot's catalog
 * resolves to the declared fallback asset and logs a `warn` once per entity
 * per slot.
 *
 * @param options - Layer indices, catalog, and fallback table.
 * @returns Six recipes plus per-slot resolution details.
 */
export const resolveLpcAppearance = (options: ResolveLpcAppearanceOptions): LpcAppearanceResult => {
  const { layerIds, catalog, fallbacks } = options;

  // Mutable locals — the returned type is Readonly; we build then cast.
  const mutableRecipes: Array<LpcAppearanceResult['recipes'][number]> = [];
  const resolutions = {} as Record<LpcSlotName, LpcSlotResolution>;

  for (let i = 0; i < LPC_SLOT_ORDER.length; i++) {
    const slot = LPC_SLOT_ORDER[i] ?? 'body';
    // A slot missing from a short input array (e.g. whispering-caves' 4-layer
    // declarations) is normalized to null so the fallback resolution records
    // it explicitly instead of leaking `undefined` into requestedIndex.
    const rawId = layerIds[i] ?? null;

    // 1-indexed layer values → 0-indexed variant lookup.
    const effectiveIdx = rawId === null ? -1 : rawId - 1;

    // Index 0 means intentionally empty — no fallback, no warning.
    if (rawId === 0) {
      mutableRecipes.push({ slot, assetId: '', hexPalette: new Uint8Array(1024) });
      resolutions[slot] = { kind: 'empty' };
      continue;
    }

    const slotDef = catalog.find((s) => s.slot === slot);
    const catalogSize = slotDef?.variants.length ?? 0;
    const variant = slotDef?.variants[effectiveIdx];

    if (variant) {
      mutableRecipes.push({ slot, assetId: variant.assetId, hexPalette: new Uint8Array(1024) });
      resolutions[slot] = { kind: 'resolved', assetId: variant.assetId };
      continue;
    }

    // Unresolvable non-zero index → declared fallback + logged warning.
    const fallbackAsset = fallbacks[slot] ?? '';
    mutableRecipes.push({ slot, assetId: fallbackAsset, hexPalette: new Uint8Array(1024) });
    resolutions[slot] = {
      kind: 'fallback',
      assetId: fallbackAsset,
      requestedIndex: rawId,
      catalogSize,
    };

    const key = _fallbackKey(slot, rawId, catalogSize);
    if (!_loggedFallbackKeys.has(key)) {
      _loggedFallbackKeys.add(key);
      logger.warn('lpc-appearance-resolver:fallback', {
        slot,
        requestedIndex: rawId,
        catalogSize,
        fallbackAsset,
        hint: 'Appearance index outside the slot catalog — rendered the declared fallback asset.',
      });
    }
  }

  return {
    recipes: mutableRecipes,
    resolutions: resolutions as LpcAppearanceResult['resolutions'],
  };
};

/**
 * Projects a wide catalog (as generated — extra slots like beard/eyes/dress
 * plus label/shapeType fields) down to the six engine slots in render order.
 *
 * Both the worker and the client resolve against this projected view, so the
 * slot/assetId sequence for a given layer array is identical everywhere.
 *
 * @param catalog - The full generated LPC slot list.
 * @returns Engine-slot-only catalog in {@link LPC_SLOT_ORDER}.
 */
export const projectLpcCatalog = (
  catalog: readonly {
    readonly slot: string;
    readonly variants: readonly { readonly assetId: string }[];
  }[],
): readonly LpcSlotCatalog[] => {
  const projected: LpcSlotCatalog[] = [];
  for (const slot of LPC_SLOT_ORDER) {
    const found = catalog.find((s) => s.slot === slot);
    if (found) {
      projected.push({
        slot,
        variants: found.variants.map((v) => ({ assetId: v.assetId })),
      });
    }
  }
  return projected;
};

// ---------------------------------------------------------------------------
// Client pipeline builder
// ---------------------------------------------------------------------------

/** Options for {@link createLpcPipeline}. */
export type CreateLpcPipelineOptions = {
  /** The projected engine-slot catalog (see {@link projectLpcCatalog}). */
  catalog: readonly LpcSlotCatalog[];
  /** Resolves a slot's asset ID to a renderable texture URL. */
  getLpcAssetPath: (slot: string, assetId: string, state: string) => string | null;
};

/**
 * Builds the client LPC pipeline: recipe resolver + asset URL resolver.
 *
 * Dedupes the `projectLpcCatalog` + `resolveLpcAppearance` wiring that
 * previously existed in BOTH game_engine_service and game_boot_service
 * (C-400). Also returns the projected catalog so callers pass the SAME
 * instance to GameWorld's `lpcCatalog` option instead of projecting twice.
 *
 * @param options - Projected catalog + asset URL resolver.
 * @returns Recipe resolver, asset URL resolver, and the projected catalog.
 */
export const createLpcPipeline = (
  options: CreateLpcPipelineOptions,
): {
  catalog: readonly LpcSlotCatalog[];
  recipeResolver: (layerIds: readonly number[]) => LpcLayerRecipe[];
  assetUrlResolver: (slot: string, assetId: string, state: string) => string | null;
} => {
  const { catalog, getLpcAssetPath } = options;

  const recipeResolver = (layerIds: readonly number[]): LpcLayerRecipe[] => [
    ...resolveLpcAppearance({ layerIds, catalog, fallbacks: DEFAULT_LPC_SLOT_FALLBACKS }).recipes,
  ];

  const assetUrlResolver = (slot: string, assetId: string, state: string): string | null =>
    getLpcAssetPath(slot, assetId, state);

  return { catalog, recipeResolver, assetUrlResolver };
};
