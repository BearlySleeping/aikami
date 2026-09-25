// apps/frontend/client/src/lib/utils/appearance_recipe.real_catalog.test.ts
//
// Proves the normalisation against the REAL item catalog rather than a fixture:
// every equippable item's `lpcAssetId` must differ from the base recipe's asset
// for the same LPC layer, so equipping/unequipping any item is always visible.

import { describe, expect, test } from 'bun:test';
import { DEFAULT_LPC_RECIPE } from '@aikami/constants';
import {
  getItemDefinition,
  getResolvableItemCatalog,
  setActiveCatalog,
} from '$utils/inventory_utils';
import { equipmentAssetsBySlot, normalizeRecipeAgainstEquipment } from './appearance_recipe';

describe('real item catalog', () => {
  test('a pack that declares few items still exposes fallback items', () => {
    // The emberwatch pack ships 7 items and does NOT declare chainmailArmor,
    // but `getItemDefinition` falls back to the hardcoded catalog, so chainmail
    // stays equippable at runtime. A pack-only collision check would miss it and
    // leave the reported bug unfixed.
    setActiveCatalog({
      ironArmor: {
        label: 'Iron Armor',
        itemType: 'armor',
        attackBonus: 0,
        defenseBonus: 5,
        equippable: true,
        slot: 'body',
        basePrice: 120,
        lpcSlot: 'torso',
        lpcAssetId: 'torso/armour/plate_male',
      },
    });
    try {
      const torsoItems = [
        ...(equipmentAssetsBySlot(getResolvableItemCatalog()).get('torso') ?? []),
      ];
      expect(torsoItems).toContain('torso/armour/plate_male'); // from the pack
      expect(torsoItems).toContain('torso/chainmail_male'); // from the fallback
    } finally {
      setActiveCatalog({});
    }
  });

  test('the pack wins on an id collision, mirroring getItemDefinition', () => {
    setActiveCatalog({
      chainmailArmor: {
        label: 'Pack Chainmail',
        itemType: 'armor',
        attackBonus: 0,
        defenseBonus: 9,
        equippable: true,
        slot: 'body',
        basePrice: 1,
        lpcSlot: 'torso',
        lpcAssetId: 'torso/chainmail_male',
      },
    });
    try {
      expect(getItemDefinition('chainmailArmor').label).toBe('Pack Chainmail');
      expect(getResolvableItemCatalog().chainmailArmor?.label).toBe('Pack Chainmail');
    } finally {
      setActiveCatalog({});
    }
  });

  test('DEFAULT_LPC_RECIPE never wears an asset an equippable item provides', () => {
    const collisions = normalizeRecipeAgainstEquipment(
      DEFAULT_LPC_RECIPE,
      getResolvableItemCatalog(),
    ).collisions;
    expect(collisions).toEqual([]);
  });

  test('every equippable item is visible against the normalised base', () => {
    const { recipe: base } = normalizeRecipeAgainstEquipment(
      DEFAULT_LPC_RECIPE,
      getResolvableItemCatalog(),
    );
    const bySlot = equipmentAssetsBySlot(getResolvableItemCatalog());
    const invisible: string[] = [];

    for (const [slot, assets] of bySlot) {
      const baseAsset = base[slot];
      if (!baseAsset) {
        continue;
      }
      for (const asset of assets) {
        if (asset === baseAsset) {
          invisible.push(`${slot}:${asset}`);
        }
      }
    }
    expect(invisible).toEqual([]);
  });

  test('a saved persona wearing its own armour is corrected', () => {
    // Reproduces the reported bug with the real catalog: the persona's persisted
    // outfit names an item asset, so the item toggle was a no-op.
    const catalog = getResolvableItemCatalog();
    const torsoItem = Object.values(catalog).find((d) => d.equippable && d.lpcSlot === 'torso');
    expect(torsoItem).toBeDefined();

    const persona = { ...DEFAULT_LPC_RECIPE, torso: torsoItem?.lpcAssetId as string };
    const { recipe, collisions } = normalizeRecipeAgainstEquipment(persona, catalog);
    expect(collisions).toHaveLength(1);
    expect(recipe.torso).toBe(DEFAULT_LPC_RECIPE.torso);
    expect(recipe.torso).not.toBe(torsoItem?.lpcAssetId);
  });

  test('the catalog is non-empty and exposes lpc metadata', () => {
    const catalog = getResolvableItemCatalog();
    const equippable = Object.entries(catalog).filter(([, d]) => d.equippable);
    expect(Object.keys(catalog).length).toBeGreaterThan(0);
    for (const [itemId, definition] of equippable) {
      // Every equippable item should be renderable; one without lpc metadata
      // would silently never appear on the sprite.
      expect(`${itemId}:${definition.lpcSlot}:${definition.lpcAssetId}`).not.toBe(
        `${itemId}:undefined:undefined`,
      );
    }
  });

  test('getItemDefinition and the catalog agree for a known item', () => {
    const definition = getItemDefinition('chainmailArmor');
    expect(definition.lpcSlot).toBe('torso');
    expect(definition.lpcAssetId).toBe('torso/chainmail_male');
  });
});
