// packages/frontend/engine/src/components/appearance.ts
//
// Appearance — variable-length layer component for dynamic sprite layering (C-430).
//
// ## Migration from six-slot (C-430)
//
// Previously, Appearance stored six fixed parallel arrays (layer0..layer5) with
// `APPEARANCE_LAYER_COUNT = 6` and equipment borrowed torso (index 2) and feet
// (index 4) via `zeroEquipmentOwnedAppearanceSlots`.
//
// Now Appearance stores a variable-length array per entity via the `layers` Map.
// The six legacy arrays (layer0..layer5) are kept for serializer backward
// compatibility — they are populated from the Map on save and read into the Map
// on load. The `zeroEquipmentOwnedAppearanceSlots` helper and `APPEARANCE_LAYER_COUNT`
// are removed.
//
// ## Conventions (C-400, load-bearing)
//
// - **1-indexed layer values.** Manifests and saves store 1-indexed variant
//   numbers; index 0 means intentionally empty. Do not "simplify" this away.
// - **Index 0 means intentionally empty.** A literal 0 resolves to an
//   `empty` recipe entry (slot present, `assetId: ''`, zero-filled palette)
//   and NEVER logs a fallback warning.
// - **Every slot has a declared fallback.** Out-of-range or missing non-zero
//   indices resolve to the slot's fallback asset and log a `warn` once per
//   entity per slot.

import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The Appearance layer index reserved for facial expressions.
 * Layer 1 in the legacy six-slot order is the face.
 */
export const FACE_LAYER_INDEX = 1;

/** Default body variant index used when no appearance is set. */
export const DEFAULT_BODY_LAYER_ID = 1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Which side of the body a layer draws on for the current facing. */
export type LpcLayerRole = 'behind' | 'front';

/**
 * Describes a single layer in an AI-generated LPC character manifest.
 *
 * Each recipe maps a named body/clothing slot to a grayscale asset ID
 * and a 1024-byte palette LUT (256 RGBA pixels) that recolours the
 * grayscale base sheet via the Zero-Branch LUT shader pipeline.
 *
 * The `hexPalette` is a Uint8Array produced by
 * `TextureManager.preparePaletteLUT()` — raw RGBA bytes in sequential
 * per-pixel order: [R0,G0,B0,A0, R1,G1,B1,A1, … R255,G255,B255,A255].
 */
export type LpcLayerRecipe = {
  /** Body/clothing slot name (e.g. "body", "hair", "shirt", "pants", "shoes"). */
  slot: string;
  /** Numeric grayscale asset ID for this layer. */
  assetId: string;
  /** 1024-byte palette LUT (256 RGBA pixels) for this layer. */
  hexPalette: Uint8Array;
  /** Which side of the body this layer draws on. Defaults to 'front'. */
  layerRole: LpcLayerRole;
};

// ---------------------------------------------------------------------------
// SoA component — variable-length layers with legacy array compat
// ---------------------------------------------------------------------------

/**
 * SoA storage for appearance data. Indexed by entity ID.
 *
 * The six legacy arrays (layer0..layer5) are kept for serializer backward
 * compatibility. The `layers` Map holds variable-length data for new saves.
 * `getAppearanceLayers` reads from the Map if available, falling back to
 * the six legacy arrays.
 */
export const Appearance = {
  /** Variable-length layer index array per entity. */
  layers: new Map<number, readonly number[]>(),
  // Legacy six-slot arrays — kept for serializer backward compatibility.
  layer0: [] as number[],
  layer1: [] as number[],
  layer2: [] as number[],
  layer3: [] as number[],
  layer4: [] as number[],
  layer5: [] as number[],
};

/** Payload shape stored / retrieved via observers. */
export type AppearanceData = {
  layers: readonly number[];
};

/**
 * Returns all layer IDs for a given entity.
 *
 * Reads from the variable-length `layers` Map if available, falling back
 * to the six legacy arrays for backward compatibility.
 *
 * @param eid - The entity ID.
 * @returns The layer indices (0 = intentionally empty).
 */
export const getAppearanceLayers = (eid: number): readonly number[] => {
  const fromMap = Appearance.layers.get(eid);
  if (fromMap !== undefined) {
    return fromMap;
  }
  // Fall back to legacy six-slot arrays
  return [
    Appearance.layer0[eid] ?? 0,
    Appearance.layer1[eid] ?? 0,
    Appearance.layer2[eid] ?? 0,
    Appearance.layer3[eid] ?? 0,
    Appearance.layer4[eid] ?? 0,
    Appearance.layer5[eid] ?? 0,
  ];
};

/**
 * Helper to update the Appearance layers for an entity.
 *
 * Writes to the variable-length `layers` Map and also populates the
 * six legacy arrays for serializer backward compatibility.
 */
export const setAppearanceLayers = (
  _world: World,
  eid: number,
  layers: readonly number[],
): void => {
  Appearance.layers.set(eid, layers);
  // Populate legacy arrays for serializer backward compat
  Appearance.layer0[eid] = layers[0] ?? 0;
  Appearance.layer1[eid] = layers[1] ?? 0;
  Appearance.layer2[eid] = layers[2] ?? 0;
  Appearance.layer3[eid] = layers[3] ?? 0;
  Appearance.layer4[eid] = layers[4] ?? 0;
  Appearance.layer5[eid] = layers[5] ?? 0;
};

/**
 * Registers onSet and onGet observers for the Appearance component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerAppearanceObservers = (world: World): void => {
  observe(world, onSet(Appearance), (eid: number, params: Record<string, unknown>) => {
    // Handle both new format ({ layers: [...] }) and legacy format
    // ({ layer0, layer1, ... }) for serializer backward compat.
    if (Array.isArray(params.layers)) {
      const layers = params.layers as readonly number[];
      Appearance.layers.set(eid, layers);
      Appearance.layer0[eid] = layers[0] ?? 0;
      Appearance.layer1[eid] = layers[1] ?? 0;
      Appearance.layer2[eid] = layers[2] ?? 0;
      Appearance.layer3[eid] = layers[3] ?? 0;
      Appearance.layer4[eid] = layers[4] ?? 0;
      Appearance.layer5[eid] = layers[5] ?? 0;
    } else {
      // Legacy format: read individual layer fields
      const layers: number[] = [
        (params.layer0 as number) ?? 0,
        (params.layer1 as number) ?? 0,
        (params.layer2 as number) ?? 0,
        (params.layer3 as number) ?? 0,
        (params.layer4 as number) ?? 0,
        (params.layer5 as number) ?? 0,
      ];
      Appearance.layers.set(eid, layers);
      Appearance.layer0[eid] = layers[0];
      Appearance.layer1[eid] = layers[1];
      Appearance.layer2[eid] = layers[2];
      Appearance.layer3[eid] = layers[3];
      Appearance.layer4[eid] = layers[4];
      Appearance.layer5[eid] = layers[5];
    }
  });

  observe(world, onGet(Appearance), (eid: number): AppearanceData => {
    const fromMap = Appearance.layers.get(eid);
    if (fromMap !== undefined) {
      return { layers: fromMap };
    }
    return {
      layers: [
        Appearance.layer0[eid] ?? 0,
        Appearance.layer1[eid] ?? 0,
        Appearance.layer2[eid] ?? 0,
        Appearance.layer3[eid] ?? 0,
        Appearance.layer4[eid] ?? 0,
        Appearance.layer5[eid] ?? 0,
      ],
    };
  });
};

// ---------------------------------------------------------------------------
// Expression map
// ---------------------------------------------------------------------------

/**
 * Expression string → integer texture ID mapping.
 *
 * When an AI response contains a macro like `{{anim:joy}}`, the parser
 * extracts `joy` and the expression system looks up the corresponding
 * texture ID from this map to update the face layer.
 */
export const EXPRESSION_MAP: Record<string, number> = {
  neutral: 0,
  joy: 1,
  anger: 2,
  sadness: 3,
  surprise: 4,
  fear: 5,
  disgust: 6,
  blush: 7,
  wink: 8,
  pout: 9,
};
