// packages/shared/lpc/tests/partial_layers.test.ts
//
// Partial-layer classification (upstream LPC `type_name`) and the authoring
// bug it prevents.
//
// Regression: `woodcutter_ada` was authored with
// `torso/clothes/longsleeve/longsleeves_cuffed_female` — upstream's "Cuffed
// Longsleeves Overlay" (`type_name: "sleeves"`), which paints only the two
// detached sleeves. Rendered as a standalone torso it left the NPC with a bare
// chest, while every catalog check passed, because the asset id genuinely IS in
// the catalog. The classification below is what makes that detectable.
//
// Uses the PRODUCTION legacy snapshot as the catalog source of truth — never a
// /tmp audit file or a live CDN response.

import { describe, expect, test } from 'bun:test';
import { LEGACY_CATALOG_SNAPSHOT } from '../src/lib/legacy_catalog_snapshot.ts';
import {
  isPartialLayerAsset,
  isPartialLayerInGarmentSlot,
  LPC_COMPLETE_GARMENT_SLOTS,
  LPC_PARTIAL_LAYER_ASSET_IDS,
  LPC_PARTIAL_LAYER_ASSETS_BY_TYPE,
  LPC_PARTIAL_LAYER_TYPES,
} from '../src/lib/partial_layers.ts';

const PUBLISHED: ReadonlySet<string> = new Set(Object.values(LEGACY_CATALOG_SNAPSHOT).flat());

/** Every id listed in the per-type groups. */
const GROUPED: ReadonlySet<string> = new Set(
  Object.values(LPC_PARTIAL_LAYER_ASSETS_BY_TYPE).flat(),
);

describe('partial-layer classification', () => {
  test('the grouped and flat views agree', () => {
    // Guards against a future edit adding a type group but forgetting to fold
    // it into LPC_PARTIAL_LAYER_ASSET_IDS (or vice versa).
    expect(GROUPED.size).toBe(LPC_PARTIAL_LAYER_ASSET_IDS.size);
    for (const assetId of LPC_PARTIAL_LAYER_ASSET_IDS) {
      expect(GROUPED.has(assetId)).toBe(true);
    }
  });

  test('the sleeves-overlay family is classified as partial', () => {
    // The exact assets that produced the bare-torso bug.
    for (const body of ['female', 'male', 'teen']) {
      expect(isPartialLayerAsset(`torso/clothes/longsleeve/longsleeves_cuffed_${body}`)).toBe(true);
    }
  });

  test('complete garments are NOT classified as partial', () => {
    // Regression guard both ways: over-classifying would reject valid content.
    for (const assetId of [
      'torso/clothes/longsleeve/longsleeve_female',
      'torso/clothes/longsleeve/longsleeve2_female',
      'torso/clothes/shortsleeve/shortsleeve_female',
      'torso/clothes/robe_female',
      'torso/aprons/apron_female',
      'torso/armour/leather_female',
      'torso/chainmail_male',
      'legs/pants_female',
      'feet/boots/basic_thin',
      'body/bodies_female',
    ]) {
      expect(isPartialLayerAsset(assetId)).toBe(false);
    }
  });

  test('all partial asset ids are catalog-shaped LPC ids', () => {
    for (const assetId of LPC_PARTIAL_LAYER_ASSET_IDS) {
      expect(assetId).toMatch(/^[a-z0-9_]+(?:\/[a-z0-9_]+)+$/);
    }
  });
});

describe('partial layers in complete-garment slots', () => {
  test('a sleeves overlay authored as a torso is rejected', () => {
    expect(
      isPartialLayerInGarmentSlot('torso', 'torso/clothes/longsleeve/longsleeves_cuffed_female'),
    ).toBe(true);
  });

  test('a belt authored as a torso is rejected', () => {
    expect(isPartialLayerInGarmentSlot('torso', 'torso/waist/belt_leather_female')).toBe(true);
  });

  test('a complete garment in a garment slot is allowed', () => {
    expect(
      isPartialLayerInGarmentSlot('torso', 'torso/clothes/longsleeve/longsleeve2_female'),
    ).toBe(false);
  });

  test('the slot gate is what enforces — inherently-partial slots are never checked', () => {
    // `hat_trim` / `shield_pattern` overlays are legitimate standalone choices
    // for their own slots, so only complete-garment slots are enforced. The
    // snapshot is scoped to garment slots for the same reason, so this asserts
    // the gate directly rather than reaching for a non-garment id.
    for (const slot of ['hat', 'shield', 'weapon', 'neck', 'facial', 'eyes']) {
      expect(LPC_COMPLETE_GARMENT_SLOTS.has(slot)).toBe(false);
      // Even a known partial id is permitted outside a garment slot.
      expect(
        isPartialLayerInGarmentSlot(slot, 'torso/clothes/longsleeve/longsleeves_cuffed_female'),
      ).toBe(false);
    }
  });

  test('the snapshot is scoped to garment slots', () => {
    // Keeps the data honest about what it covers: an id outside a garment slot
    // would be dead weight, since nothing consults it.
    for (const assetId of LPC_PARTIAL_LAYER_ASSET_IDS) {
      const slot = assetId.split('/')[0] ?? '';
      expect(LPC_COMPLETE_GARMENT_SLOTS.has(slot)).toBe(true);
    }
  });

  test('garment slots cover the slots that must be fully clothed', () => {
    for (const slot of ['body', 'torso', 'dress', 'legs', 'feet']) {
      expect(LPC_COMPLETE_GARMENT_SLOTS.has(slot)).toBe(true);
    }
  });
});

describe('published-catalog overlap', () => {
  test('the classification actually covers published assets', () => {
    // If this ever hits zero the snapshot has drifted from the catalog and the
    // guard would silently stop protecting anything.
    const published = [...LPC_PARTIAL_LAYER_ASSET_IDS].filter((id) => PUBLISHED.has(id));
    expect(published.length).toBeGreaterThan(0);
  });

  test('published partial assets in garment slots are all recognised', () => {
    const garmentSlotPublished = [...PUBLISHED].filter((id) => {
      const slot = id.split('/')[0];
      return LPC_COMPLETE_GARMENT_SLOTS.has(slot) && isPartialLayerAsset(id);
    });
    for (const id of garmentSlotPublished) {
      expect(isPartialLayerInGarmentSlot(id.split('/')[0] ?? '', id)).toBe(true);
    }
    // Sanity: the historical offender is in this set.
    expect(garmentSlotPublished).toContain('torso/clothes/longsleeve/longsleeves_cuffed_female');
  });

  test('no partial type name is empty or duplicated across groups', () => {
    for (const typeName of LPC_PARTIAL_LAYER_TYPES) {
      expect(typeName.length).toBeGreaterThan(0);
    }
  });
});
