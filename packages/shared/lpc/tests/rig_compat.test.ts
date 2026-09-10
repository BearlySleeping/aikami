// packages/shared/lpc/tests/rig_compat.test.ts
//
// Wearer-aware equipment/clothing resolution (rig compat).
// Uses the PRODUCTION legacy snapshot as the catalog source of truth — never
// a /tmp audit file or a live CDN response.

import { describe, expect, test } from 'bun:test';
import { LEGACY_CATALOG_SNAPSHOT } from '../src/lib/legacy_catalog_snapshot.ts';
import {
  type LpcRig,
  resolveBaseAppearanceRecipe,
  resolveBodyRig,
  resolveRigCompatibleAsset,
} from '../src/lib/rig_compat.ts';

/** Slot → asset IDs in the production catalog order. */
const CATALOG: Readonly<Record<string, readonly string[]>> = LEGACY_CATALOG_SNAPSHOT;

describe('resolveBodyRig', () => {
  test('maps flat catalog body segments to rigs', () => {
    expect(resolveBodyRig('body/bodies_female')).toBe('female');
    expect(resolveBodyRig('body/bodies_male')).toBe('male');
    expect(resolveBodyRig('body/bodies_child')).toBe('child');
    expect(resolveBodyRig('body/bodies_teen')).toBe('teen');
    expect(resolveBodyRig('body/bodies_muscular')).toBe('muscular');
    expect(resolveBodyRig('body/bodies_pregnant')).toBe('pregnant');
  });

  test('maps nested body paths (schema default) to rigs', () => {
    expect(resolveBodyRig('body/bodies/male/light')).toBe('male');
    expect(resolveBodyRig('body/bodies/female/light')).toBe('female');
  });

  test('defaults missing / unknown bodies to male', () => {
    expect(resolveBodyRig(undefined)).toBe('male');
    expect(resolveBodyRig('')).toBe('male');
    expect(resolveBodyRig('body/prosthesis/hook_male')).toBe('male');
  });
});

describe('resolveRigCompatibleAsset — the exact reported recipe', () => {
  test('female body: chainmail resolves to chainmail_female', () => {
    const result = resolveRigCompatibleAsset({
      slot: 'torso',
      assetId: 'torso/chainmail_male',
      rig: 'female',
      catalogAssetIdsBySlot: CATALOG,
    });
    expect(result.assetId).toBe('torso/chainmail_female');
    expect(result.status).toBe('compatible');
  });

  test('female body: basic boots resolve to basic_thin (not basic_female)', () => {
    const result = resolveRigCompatibleAsset({
      slot: 'feet',
      assetId: 'feet/boots/basic_male',
      rig: 'female',
      catalogAssetIdsBySlot: CATALOG,
    });
    expect(result.assetId).toBe('feet/boots/basic_thin');
    expect(result.status).toBe('compatible');
  });

  test('female body: feet plate armour resolves to plate_female', () => {
    const result = resolveRigCompatibleAsset({
      slot: 'feet',
      assetId: 'feet/armour/plate_male',
      rig: 'female',
      catalogAssetIdsBySlot: CATALOG,
    });
    expect(result.assetId).toBe('feet/armour/plate_female');
    expect(result.status).toBe('compatible');
  });

  test('female body: kite shield resolves to kite_female', () => {
    const result = resolveRigCompatibleAsset({
      slot: 'shield',
      assetId: 'shield/kite_male',
      rig: 'female',
      catalogAssetIdsBySlot: CATALOG,
    });
    expect(result.assetId).toBe('shield/kite_female');
    expect(result.status).toBe('compatible');
  });

  test('female body: great helm resolves to greathelm_female', () => {
    const result = resolveRigCompatibleAsset({
      slot: 'hat',
      assetId: 'hat/helmet/greathelm_male',
      rig: 'female',
      catalogAssetIdsBySlot: CATALOG,
    });
    expect(result.assetId).toBe('hat/helmet/greathelm_female');
    expect(result.status).toBe('compatible');
  });
});

describe('resolveRigCompatibleAsset — preservation and fallback', () => {
  test('already-compatible female assets are preserved (tunic_female, sandals_thin)', () => {
    expect(
      resolveRigCompatibleAsset({
        slot: 'torso',
        assetId: 'torso/clothes/tunic_female',
        rig: 'female',
        catalogAssetIdsBySlot: CATALOG,
      }).assetId,
    ).toBe('torso/clothes/tunic_female');
    expect(
      resolveRigCompatibleAsset({
        slot: 'feet',
        assetId: 'feet/sandals_thin',
        rig: 'female',
        catalogAssetIdsBySlot: CATALOG,
      }).assetId,
    ).toBe('feet/sandals_thin');
  });

  test('male rig keeps male variants unchanged', () => {
    expect(
      resolveRigCompatibleAsset({
        slot: 'torso',
        assetId: 'torso/chainmail_male',
        rig: 'male',
        catalogAssetIdsBySlot: CATALOG,
      }).assetId,
    ).toBe('torso/chainmail_male');
  });

  test('body-agnostic assets (nasal_adult) are untouched for any rig', () => {
    expect(
      resolveRigCompatibleAsset({
        slot: 'hat',
        assetId: 'hat/helmet/nasal_adult',
        rig: 'female',
        catalogAssetIdsBySlot: CATALOG,
      }).assetId,
    ).toBe('hat/helmet/nasal_adult');
  });

  test('missing variant keeps the original asset and reports a fallback diagnostic', () => {
    // `torso/clothes/vest_male` has no female/thin pair in the catalog.
    const result = resolveRigCompatibleAsset({
      slot: 'torso',
      assetId: 'torso/clothes/vest_male',
      rig: 'female',
      catalogAssetIdsBySlot: CATALOG,
    });
    expect(result.assetId).toBe('torso/clothes/vest_male');
    expect(result.status).toBe('fallback');
    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0]?.rig).toBe('female');
    expect(result.diagnostics[0]?.slot).toBe('torso');
  });

  test('empty catalog degrades to the original asset without throwing', () => {
    const result = resolveRigCompatibleAsset({
      slot: 'torso',
      assetId: 'torso/chainmail_male',
      rig: 'female',
      catalogAssetIdsBySlot: {},
    });
    expect(result.assetId).toBe('torso/chainmail_male');
    expect(result.status).toBe('fallback');
  });
});

describe('resolveRigCompatibleAsset — supported body profiles', () => {
  const cases: ReadonlyArray<{ rig: LpcRig; assetId: string; expected: string; slot: string }> = [
    {
      rig: 'teen',
      slot: 'torso',
      assetId: 'torso/armour/plate_male',
      expected: 'torso/armour/plate_teen',
    },
    {
      rig: 'teen',
      slot: 'feet',
      assetId: 'feet/boots/basic_male',
      expected: 'feet/boots/basic_thin',
    },
    {
      rig: 'pregnant',
      slot: 'torso',
      assetId: 'torso/clothes/shortsleeve/shortsleeve_male',
      expected: 'torso/clothes/shortsleeve/shortsleeve_pregnant',
    },
    {
      rig: 'pregnant',
      slot: 'feet',
      assetId: 'feet/boots/basic_male',
      expected: 'feet/boots/basic_thin',
    },
    { rig: 'child', slot: 'legs', assetId: 'legs/pants_male', expected: 'legs/pants_child' },
    {
      rig: 'muscular',
      slot: 'torso',
      assetId: 'torso/chainmail_male',
      expected: 'torso/chainmail_male',
    },
  ];

  for (const { rig, slot, assetId, expected } of cases) {
    test(`${rig} rig: ${assetId} → ${expected}`, () => {
      const result = resolveRigCompatibleAsset({
        slot,
        assetId,
        rig,
        catalogAssetIdsBySlot: CATALOG,
      });
      expect(result.assetId).toBe(expected);
      expect(result.status).toBe('compatible');
    });
  }
});

describe('resolveBaseAppearanceRecipe', () => {
  test('resolves the exact female persona recipe without disturbing the outfit', () => {
    const { recipe, rig, diagnostics } = resolveBaseAppearanceRecipe({
      recipe: {
        body: 'body/bodies_female',
        head: 'head/heads/human_female',
        hair: 'hair/parted_adult',
        torso: 'torso/clothes/tunic_female',
        legs: 'legs/formal_thin',
        feet: 'feet/sandals_thin',
      },
      catalogAssetIdsBySlot: CATALOG,
    });
    expect(rig).toBe('female');
    expect(recipe.torso).toBe('torso/clothes/tunic_female');
    expect(recipe.legs).toBe('legs/formal_thin');
    expect(recipe.feet).toBe('feet/sandals_thin');
    expect(diagnostics).toEqual([]);
  });

  test('female body with only a body override no longer keeps male defaults', () => {
    const { recipe, rig } = resolveBaseAppearanceRecipe({
      recipe: {
        body: 'body/bodies_female',
        head: 'head/heads/human_male',
        hair: 'hair/bangs_adult',
        torso: 'torso/chainmail_male',
        legs: 'legs/pants_male',
        feet: 'feet/boots/basic_male',
      },
      catalogAssetIdsBySlot: CATALOG,
    });
    expect(rig).toBe('female');
    expect(recipe.torso).toBe('torso/chainmail_female');
    expect(recipe.legs).toBe('legs/pants_female');
    expect(recipe.feet).toBe('feet/boots/basic_thin');
  });

  test('male default recipe stays fully male', () => {
    const { recipe, rig } = resolveBaseAppearanceRecipe({
      recipe: {
        body: 'body/bodies_male',
        head: 'head/heads/human_male',
        hair: 'hair/bangs_adult',
        torso: 'torso/chainmail_male',
        legs: 'legs/pants_male',
        feet: 'feet/boots/basic_male',
      },
      catalogAssetIdsBySlot: CATALOG,
    });
    expect(rig).toBe('male');
    expect(recipe.torso).toBe('torso/chainmail_male');
    expect(recipe.legs).toBe('legs/pants_male');
    expect(recipe.feet).toBe('feet/boots/basic_male');
  });

  test('reports diagnostics when a slot has no compatible variant', () => {
    const { recipe, diagnostics } = resolveBaseAppearanceRecipe({
      recipe: {
        body: 'body/bodies_female',
        head: 'head/heads/human_male',
        hair: 'hair/bangs_adult',
        torso: 'torso/clothes/vest_male',
        legs: 'legs/pants_male',
        feet: 'feet/boots/basic_male',
      },
      catalogAssetIdsBySlot: CATALOG,
    });
    expect(recipe.torso).toBe('torso/clothes/vest_male'); // preserved + flagged
    expect(
      diagnostics.some((d) => d.slot === 'torso' && d.assetId === 'torso/clothes/vest_male'),
    ).toBe(true);
  });
});
