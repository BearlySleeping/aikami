// packages/shared/lpc/src/lib/partial_layers.ts
//
// biome-ignore-all lint/style/useNamingConvention: upstream LPC `type_name` values (jacket_trim, dress_sleeves, belt, …) and asset ids (longsleeves_cuffed_female, …) are literal snake_case catalog identifiers, not code identifiers.
//
// LPC assets that are PARTIAL layers, not standalone garments.
//
// Upstream Universal-LPC classifies every spritesheet with a `type_name` in
// `sheet_definitions/**.json`. A garment's `type_name` is `clothes`, `apron`,
// `armour`, `chainmail`, `overalls`, `shoes`, `socks`, `legs`, `dress`. A *partial*
// type (`sleeves`, `sash`, `belt`, `jacket_trim`, `buckles`, …) means the sheet only
// draws the part it names — the sleeves of a shirt, a belt across the waist — and is
// meant to be composited ON TOP of a base garment.
//
// The collector publishes both kinds into the same `torso`/`legs`/`feet` slots, so a
// content author can pick a sleeves-overlay as if it were a whole shirt. The result
// renders as a bare chest: `torso/clothes/longsleeve/longsleeves_cuffed_female` is
// upstream's "Cuffed Longsleeves Overlay" (`type_name: "sleeves"`) and paints only
// the two detached sleeves, so `woodcutter_ada` — authored with it — showed no torso
// at all. Every catalog check passed, because the asset id genuinely IS in the
// catalog; only the upstream `type_name` says it is not a whole garment.
//
// SCOPE: garment slots only (`body`, `torso`, `dress`, `legs`, `feet`), because that is
// exactly what {@link isPartialLayerInGarmentSlot} enforces. Overlays for inherently
// partial slots (`hat_trim`, `shield_pattern`, `hairtie`, …) are legitimate standalone
// choices for their own slot and are deliberately not listed here.
//
// DERIVED from upstream `type_name` but COMMITTED as reviewed data — per C-496,
// `examples/**` is gitignored and must never be read at runtime, in tests, or in CI.
// Regenerate by sweeping
// `examples/Universal-LPC-Spritesheet-Character-Generator/sheet_definitions/**` for the
// partial `type_name` values below and keeping entries whose asset id starts with a
// garment slot.

/**
 * Slots whose layer must be a COMPLETE garment.
 *
 * A partial layer authored into one of these leaves the character visibly bare, so
 * content validation rejects it. Slots that are themselves inherently partial
 * (`hat`, `shield`, `weapon`, `neck`, `facial`, `eyes`, …) are excluded — their
 * overlays are legitimate standalone choices.
 */
export const LPC_COMPLETE_GARMENT_SLOTS: ReadonlySet<string> = new Set([
  'body',
  'torso',
  'dress',
  'legs',
  'feet',
] as const);

/** Upstream `type_name` values that mark a partial / overlay layer (garment slots). */
export const LPC_PARTIAL_LAYER_TYPES: ReadonlySet<string> = new Set([
  'belt',
  'buckles',
  'dress_sleeves',
  'dress_sleeves_trim',
  'dress_trim',
  'jacket_collar',
  'jacket_pockets',
  'jacket_trim',
  'sash',
  'sash_tie',
  'sleeves',
] as const);

/**
 * Partial-layer garment asset ids grouped by their upstream `type_name`.
 *
 * Grouped rather than one flat set so a reviewer can audit the classification by
 * type and trace each entry back to the upstream sheet that produced it.
 */
export const LPC_PARTIAL_LAYER_ASSETS_BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  belt: [
    'torso/waist/belt_belly/male_teen',
    'torso/waist/belt_belly_female',
    'torso/waist/belt_belly_male',
    'torso/waist/belt_double/male_teen',
    'torso/waist/belt_double_female',
    'torso/waist/belt_double_male',
    'torso/waist/belt_formal_male',
    'torso/waist/belt_leather/female_teen',
    'torso/waist/belt_leather2/female_teen',
    'torso/waist/belt_leather2_female',
    'torso/waist/belt_leather2_male',
    'torso/waist/belt_leather_female',
    'torso/waist/belt_leather_male',
    'torso/waist/belt_loose/female_teen',
    'torso/waist/belt_loose_female',
    'torso/waist/belt_loose_male',
    'torso/waist/belt_mage_female',
    'torso/waist/belt_mage_teen',
    'torso/waist/belt_robe/female_teen',
    'torso/waist/belt_robe_female',
    'torso/waist/belt_robe_male',
  ],
  buckles: ['torso/waist/buckles_female'],
  dress_sleeves: [
    'dress/kimono/sleeves/universal/female_front_female',
    'dress/kimono/sleeves/universal/female_front_teen',
    'dress/kimono/sleeves/universal/female_teen',
    'dress/kimono/sleeves/universal_female',
    'dress/kimono/sleeves_oversize/universal/female_front_female',
    'dress/kimono/sleeves_oversize/universal/female_front_teen',
    'dress/kimono/sleeves_oversize/universal/female_teen',
    'dress/kimono/sleeves_oversize/universal_female',
  ],
  dress_sleeves_trim: [
    'dress/kimono/sleeves/trim/universal/female_front_female',
    'dress/kimono/sleeves/trim/universal/female_front_teen',
    'dress/kimono/sleeves/trim/universal/female_teen',
    'dress/kimono/sleeves/trim/universal_female',
    'dress/kimono/sleeves_oversize/trim/universal/female_front_female',
    'dress/kimono/sleeves_oversize/trim/universal/female_front_teen',
    'dress/kimono/sleeves_oversize/trim/universal/female_teen',
    'dress/kimono/sleeves_oversize/trim/universal_female',
  ],
  dress_trim: [
    'dress/kimono/normal/trim/universal/female_teen',
    'dress/kimono/normal/trim/universal_female',
    'dress/kimono/split/trim/universal/female_teen',
    'dress/kimono/split/trim/universal_female',
  ],
  jacket_collar: ['torso/jacket/trim/frock_collar_male'],
  jacket_pockets: ['torso/jacket/trim/jacket_pockets_male'],
  jacket_trim: [
    'torso/jacket/trim/frock_buttons_male',
    'torso/jacket/trim/frock_lace_male',
    'torso/jacket/trim/frock_lapel_male',
  ],
  sash: [
    'torso/waist/obi/male_muscular',
    'torso/waist/obi/thin_female',
    'torso/waist/obi/thin_pregnant',
    'torso/waist/obi/thin_teen',
    'torso/waist/obi_male',
    'torso/waist/sash/male_teen',
    'torso/waist/sash_female',
    'torso/waist/sash_male',
    'torso/waist/sash_narrow/male_teen',
    'torso/waist/sash_narrow_female',
    'torso/waist/sash_narrow_male',
    'torso/waist/waistband_female',
  ],
  sash_tie: [
    'torso/waist/obi/knot/left/male_muscular',
    'torso/waist/obi/knot/left/thin_female',
    'torso/waist/obi/knot/left/thin_pregnant',
    'torso/waist/obi/knot/left/thin_teen',
    'torso/waist/obi/knot/left_male',
    'torso/waist/obi/knot/right/male_muscular',
    'torso/waist/obi/knot/right/thin_female',
    'torso/waist/obi/knot/right/thin_pregnant',
    'torso/waist/obi/knot/right/thin_teen',
    'torso/waist/obi/knot/right_male',
  ],
  sleeves: [
    'torso/clothes/longsleeve/longsleeves2_female',
    'torso/clothes/longsleeve/longsleeves2_male',
    'torso/clothes/longsleeve/longsleeves2_teen',
    'torso/clothes/longsleeve/longsleeves_cuffed_female',
    'torso/clothes/longsleeve/longsleeves_cuffed_male',
    'torso/clothes/longsleeve/longsleeves_cuffed_teen',
    'torso/clothes/longsleeve/longsleeves_female',
    'torso/clothes/longsleeve/longsleeves_male',
    'torso/clothes/longsleeve/longsleeves_teen',
    'torso/clothes/shortsleeve/shortsleeves2_female',
    'torso/clothes/shortsleeve/shortsleeves2_male',
    'torso/clothes/shortsleeve/shortsleeves2_teen',
    'torso/clothes/shortsleeve/shortsleeves_female',
    'torso/clothes/shortsleeve/shortsleeves_male',
    'torso/clothes/shortsleeve/shortsleeves_teen',
  ],
} as const;

/** Flat set of every partial-layer garment asset id. */
export const LPC_PARTIAL_LAYER_ASSET_IDS: ReadonlySet<string> = new Set(
  Object.values(LPC_PARTIAL_LAYER_ASSETS_BY_TYPE).flat(),
);

/** True when `assetId` is a known partial layer (sleeve overlay, belt, sash, trim). */
export const isPartialLayerAsset = (assetId: string): boolean =>
  LPC_PARTIAL_LAYER_ASSET_IDS.has(assetId);

/**
 * True when `assetId` is a partial layer being used where a complete garment is
 * required — the authoring bug this snapshot exists to catch.
 */
export const isPartialLayerInGarmentSlot = (slot: string, assetId: string): boolean =>
  LPC_COMPLETE_GARMENT_SLOTS.has(slot) && LPC_PARTIAL_LAYER_ASSET_IDS.has(assetId);
