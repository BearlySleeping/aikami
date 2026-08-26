// packages/shared/lpc/tests/empty_catalog.test.ts
//
// AC-4: The empty catalog never crashes a consumer.

import { describe, expect, test } from 'bun:test';
import { buildLpcCatalog } from '../src/lib/build_catalog.ts';
import { resolveLpcAppearance, projectLpcCatalog, DEFAULT_LPC_SLOT_FALLBACKS, LPC_SLOT_ORDER } from '../src/lib/appearance.ts';

describe('empty catalog never crashes', () => {
  test('buildLpcCatalog with empty entries returns empty catalog without throwing', () => {
    expect(() => buildLpcCatalog({ entries: [] })).not.toThrow();
    const result = buildLpcCatalog({ entries: [] });
    expect(result.slots).toEqual([]);
    expect(result.allAssetIds).toEqual([]);
  });

  test('projectLpcCatalog with empty catalog returns empty array', () => {
    const projected = projectLpcCatalog([]);
    expect(projected).toEqual([]);
  });

  test('resolveLpcAppearance with empty catalog uses fallbacks', () => {
    const result = resolveLpcAppearance({
      layerIds: [1, 1, 1, 1, 1, 1],
      catalog: [],
      fallbacks: DEFAULT_LPC_SLOT_FALLBACKS,
    });

    // Should return 6 recipes (one per slot)
    expect(result.recipes.length).toBe(6);
    // All should use fallbacks since catalog is empty
    for (const recipe of result.recipes) {
      expect(recipe.assetId).not.toBe('');
    }
  });

  test('resolveLpcAppearance with empty catalog and zero indices returns empty recipes', () => {
    const result = resolveLpcAppearance({
      layerIds: [0, 0, 0, 0, 0, 0],
      catalog: [],
      fallbacks: DEFAULT_LPC_SLOT_FALLBACKS,
    });

    expect(result.recipes.length).toBe(6);
    for (const recipe of result.recipes) {
      expect(recipe.assetId).toBe('');
    }
  });

  test('resolveLpcAppearance with short input array fills missing slots with fallbacks', () => {
    const result = resolveLpcAppearance({
      layerIds: [1], // Only body specified
      catalog: [],
      fallbacks: DEFAULT_LPC_SLOT_FALLBACKS,
    });

    expect(result.recipes.length).toBe(6);
    // First recipe should use fallback
    expect(result.recipes[0].assetId).toBe(DEFAULT_LPC_SLOT_FALLBACKS.body);
    // Missing slots should also use fallbacks
    expect(result.recipes[1].assetId).toBe(DEFAULT_LPC_SLOT_FALLBACKS.hair);
  });
});
