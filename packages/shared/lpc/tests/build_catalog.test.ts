// packages/shared/lpc/tests/build_catalog.test.ts
//
// AC-2: The catalog derives from published entries.

import { describe, expect, test } from 'bun:test';
import { buildLpcCatalog } from '../src/lib/build_catalog.ts';

describe('buildLpcCatalog', () => {
  test('returns empty catalog for empty entries', () => {
    const result = buildLpcCatalog({ entries: [] });
    expect(result.slots).toEqual([]);
    expect(result.assetIdsBySlot).toEqual({});
    expect(result.allAssetIds).toEqual([]);
  });

  test('groups entries by slot and collapses variants', () => {
    const entries = [
      { tag: 'lpc:body:bodies_male:walk', category: 'lpc', ext: 'webp' },
      { tag: 'lpc:body:bodies_male:slash', category: 'lpc', ext: 'webp' },
      { tag: 'lpc:body:bodies_female:walk', category: 'lpc', ext: 'webp' },
      { tag: 'lpc:hair:bangs_adult:walk', category: 'lpc', ext: 'webp' },
      { tag: 'lpc:hair:bangs_adult:slash', category: 'lpc', ext: 'webp' },
      { tag: 'lpc:hair:mohawk:walk', category: 'lpc', ext: 'webp' },
    ];

    const result = buildLpcCatalog({ entries });

    // Should have 2 slots
    expect(result.slots.length).toBe(2);

    // body slot
    const bodySlot = result.slots.find((s) => s.slot === 'body');
    expect(bodySlot).toBeDefined();
    expect(bodySlot!.variants.length).toBe(2); // bodies_male, bodies_female
    expect(bodySlot!.variants[0].assetId).toBe('body/bodies_female');
    expect(bodySlot!.variants[1].assetId).toBe('body/bodies_male');

    // bodies_male should have 2 states (insertion order preserved)
    expect(bodySlot!.variants[1].states).toEqual(['walk', 'slash']);

    // hair slot
    const hairSlot = result.slots.find((s) => s.slot === 'hair');
    expect(hairSlot).toBeDefined();
    expect(hairSlot!.variants.length).toBe(2);
    expect(hairSlot!.variants[0].assetId).toBe('hair/bangs_adult');
    expect(hairSlot!.variants[1].assetId).toBe('hair/mohawk');

    // bangs_adult should have 2 states (insertion order preserved)
    expect(hairSlot!.variants[0].states).toEqual(['walk', 'slash']);

    // allAssetIds should have 4 unique entries
    expect(result.allAssetIds.length).toBe(4);
    expect(result.allAssetIds).toEqual([
      'body/bodies_female',
      'body/bodies_male',
      'hair/bangs_adult',
      'hair/mohawk',
    ]);

    // assetIdsBySlot
    expect(result.assetIdsBySlot['body']).toEqual(['body/bodies_female', 'body/bodies_male']);
    expect(result.assetIdsBySlot['hair']).toEqual(['hair/bangs_adult', 'hair/mohawk']);
  });

  test('skips unparseable tags with debug log', () => {
    const entries = [
      { tag: 'lpc:body:bodies_male:walk', category: 'lpc', ext: 'webp' },
      { tag: 'not-an-lpc-tag', category: 'lpc', ext: 'webp' },
      { tag: 'lpc:too:short', category: 'lpc', ext: 'webp' },
    ];

    const result = buildLpcCatalog({ entries });
    expect(result.slots.length).toBe(1);
    expect(result.slots[0].slot).toBe('body');
  });

  test('detects bg_/fg_ paired variants', () => {
    // bg_ prefix at the start of the last path segment
    const entries = [
      { tag: 'lpc:shield:bg_buckler:walk', category: 'lpc', ext: 'webp' },
      { tag: 'lpc:shield:fg_buckler:walk', category: 'lpc', ext: 'webp' },
    ];

    const result = buildLpcCatalog({ entries });
    const shieldSlot = result.slots.find((s) => s.slot === 'shield');
    expect(shieldSlot).toBeDefined();

    const bgVariant = shieldSlot!.variants.find((v) => v.assetId === 'shield/bg_buckler');
    expect(bgVariant).toBeDefined();
    expect(bgVariant!.layerRole).toBe('behind');
    expect(bgVariant!.pairedAssetId).toBe('shield/fg_buckler');

    const fgVariant = shieldSlot!.variants.find((v) => v.assetId === 'shield/fg_buckler');
    expect(fgVariant).toBeDefined();
    expect(fgVariant!.layerRole).toBe('front');
    expect(fgVariant!.pairedAssetId).toBe('shield/bg_buckler');
  });

  test('ordering is lexicographic and deterministic', () => {
    // Same entries in different order should produce the same result
    const entries1 = [
      { tag: 'lpc:body:bodies_male:walk', category: 'lpc', ext: 'webp' },
      { tag: 'lpc:body:bodies_female:walk', category: 'lpc', ext: 'webp' },
      { tag: 'lpc:hair:mohawk:walk', category: 'lpc', ext: 'webp' },
      { tag: 'lpc:hair:bangs_adult:walk', category: 'lpc', ext: 'webp' },
    ];

    const entries2 = [
      { tag: 'lpc:hair:bangs_adult:walk', category: 'lpc', ext: 'webp' },
      { tag: 'lpc:body:bodies_male:walk', category: 'lpc', ext: 'webp' },
      { tag: 'lpc:hair:mohawk:walk', category: 'lpc', ext: 'webp' },
      { tag: 'lpc:body:bodies_female:walk', category: 'lpc', ext: 'webp' },
    ];

    const result1 = buildLpcCatalog({ entries: entries1 });
    const result2 = buildLpcCatalog({ entries: entries2 });

    expect(result1.slots.map((s) => s.slot)).toEqual(result2.slots.map((s) => s.slot));
    expect(result1.allAssetIds).toEqual(result2.allAssetIds);
  });
});
