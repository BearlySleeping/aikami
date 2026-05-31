// packages/engine/src/components/appearance.ts
import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// Appearance — SoA component for dynamic sprite layering
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

/**
 * The Appearance layer index reserved for facial expressions.
 *
 * Layer 0 is typically the base body/outfit, layer 1 is the face.
 * Expression macros like `{{anim:joy}}` update `Appearance.layer1[eid]`.
 */
export const FACE_LAYER_INDEX = 1;

/** Number of asset layers an entity can compose from. */
export const APPEARANCE_LAYER_COUNT = 5;

/** SoA storage for appearance data. Indexed by entity ID. */
export const Appearance = {
  /** Asset hash / texture key for each compositing layer (0 = empty). */
  layer0: [] as number[],
  layer1: [] as number[],
  layer2: [] as number[],
  layer3: [] as number[],
  layer4: [] as number[],
};

/** Payload shape stored / retrieved via observers. */
export type AppearanceData = {
  layer0: number;
  layer1: number;
  layer2: number;
  layer3: number;
  layer4: number;
};

/**
 * Helper that returns all 5 layer IDs for a given entity as a readonly array.
 *
 * @param eid - The entity ID.
 * @returns A readonly array of 5 layer asset IDs (0 means no asset).
 */
export const getAppearanceLayers = (eid: number): readonly number[] => [
  Appearance.layer0[eid] ?? 0,
  Appearance.layer1[eid] ?? 0,
  Appearance.layer2[eid] ?? 0,
  Appearance.layer3[eid] ?? 0,
  Appearance.layer4[eid] ?? 0,
];

/**
 * Registers onSet and onGet observers for the Appearance component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerAppearanceObservers = (world: World): void => {
  observe(world, onSet(Appearance), (eid: number, params: AppearanceData) => {
    Appearance.layer0[eid] = params.layer0;
    Appearance.layer1[eid] = params.layer1;
    Appearance.layer2[eid] = params.layer2;
    Appearance.layer3[eid] = params.layer3;
    Appearance.layer4[eid] = params.layer4;
  });

  observe(
    world,
    onGet(Appearance),
    (eid: number): AppearanceData => ({
      layer0: Appearance.layer0[eid] ?? 0,
      layer1: Appearance.layer1[eid] ?? 0,
      layer2: Appearance.layer2[eid] ?? 0,
      layer3: Appearance.layer3[eid] ?? 0,
      layer4: Appearance.layer4[eid] ?? 0,
    }),
  );
};
