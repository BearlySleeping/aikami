// apps/frontend/client/src/lib/services/game/equipment_starter_kit.test.ts
//
// Verifies the STARTER_KIT constant resolves fully: every item exists in the
// item catalog, equipment items are equippable into their slots, and the
// seeded character renders LPC recipes for all equipped gear.
//
// Contract: C-374 Equipment, Armour & Weapon Inventory UI

import { beforeEach, describe, expect, test } from 'bun:test';
import { DEFAULT_LPC_RECIPE, STARTER_KIT } from '@aikami/constants';
import { LEGACY_CATALOG_SNAPSHOT } from '@aikami/lpc';
import { getItemDefinition, ITEM_CATALOG } from '$utils/inventory_utils';
import { equipmentService } from './equipment_service.svelte';
import { inventoryService } from './inventory_service.svelte';
import { playerStateService } from './player_state_service.svelte';

/** Mirrors persona_create_view_model.enterWorld() seeding. */
const seedStarterKit = (): void => {
  inventoryService.reset();
  equipmentService.reset();
  for (const entry of STARTER_KIT.inventory) {
    inventoryService.addItem({ itemId: entry.itemId, quantity: entry.quantity });
  }
  for (const [, itemId] of Object.entries(STARTER_KIT.equipment)) {
    if (!itemId) {
      continue;
    }
    inventoryService.addItem({ itemId, quantity: 1 });
    equipmentService.equipItem({ itemId });
  }
};

describe('STARTER_KIT (C-374)', () => {
  beforeEach(() => {
    playerStateService.reset();
  });

  test('every bag item resolves to a real catalog definition', () => {
    for (const entry of STARTER_KIT.inventory) {
      const definition = getItemDefinition(entry.itemId);
      expect(definition.label).not.toBe(entry.itemId);
      expect(entry.quantity).toBeGreaterThan(0);
    }
  });

  test('every equipment item resolves, is equippable, and maps to an LPC asset', () => {
    for (const [slotKey, itemId] of Object.entries(STARTER_KIT.equipment)) {
      if (!itemId) {
        continue;
      }
      const definition = getItemDefinition(itemId);
      expect(definition.equippable).toBe(true);
      expect(definition.slot).toBeDefined();
      expect(definition.slot).toBe(slotKey); // slot must match the configured key
      expect(definition.lpcAssetId).toBeTruthy();
      expect(definition.lpcSlot).toBeTruthy();
    }
  });

  test('seeding grants the kit and pre-equips all gear', () => {
    seedStarterKit();
    const slots = equipmentService.equippedItems.map((e) => e.slot);
    expect(slots).toContain('body');
    expect(slots).toContain('feet');
    expect(slots).toContain('rightHand');
    expect(slots).toContain('leftHand');
    // Bag potions present
    expect(inventoryService.inventory.find((e) => e.itemId === 'healthPotion')?.quantity).toBe(2);
  });

  test('seeded gear produces LPC recipes for the renderer', () => {
    seedStarterKit();
    const recipes = equipmentService.buildLpcRecipes();
    const slots = recipes.map((r) => r.slot);
    // LPC recipe slots are the LPC layer names (body armour → "torso")
    expect(slots).toContain('torso');
    expect(slots).toContain('feet');
    expect(slots).toContain('weapon');
    expect(slots).toContain('shield');
    // Every recipe has a real asset id
    for (const recipe of recipes) {
      expect(recipe.assetId.length).toBeGreaterThan(0);
    }
  });

  test('female wearer: chainmail + boots resolve to the female variants', () => {
    equipmentService.reset();
    inventoryService.reset();
    equipmentService.configureAppearanceContext({
      bodyAssetId: 'body/bodies_female',
      catalogAssetIdsBySlot: LEGACY_CATALOG_SNAPSHOT,
    });
    inventoryService.addItem({ itemId: 'chainmailArmor' });
    inventoryService.addItem({ itemId: 'leatherBoots' });
    inventoryService.addItem({ itemId: 'ironShield' });
    equipmentService.equipItem({ itemId: 'chainmailArmor' });
    equipmentService.equipItem({ itemId: 'leatherBoots' });
    equipmentService.equipItem({ itemId: 'ironShield' });

    const recipes = equipmentService.buildLpcRecipes();
    expect(recipes.find((r) => r.slot === 'torso')?.assetId).toBe('torso/chainmail_female');
    expect(recipes.find((r) => r.slot === 'feet')?.assetId).toBe('feet/boots/basic_thin');
    expect(recipes.find((r) => r.slot === 'shield')?.assetId).toBe('shield/kite_female');
    // Gameplay item IDs are untouched by visual resolution.
    expect(equipmentService.getEquippedItemId('body')).toBe('chainmailArmor');
    expect(equipmentService.getEquippedItemId('feet')).toBe('leatherBoots');
    expect(equipmentService.getEquippedItemId('leftHand')).toBe('ironShield');
  });

  test('female wearer: starter kit resolves every body-dependent piece compatibly', () => {
    equipmentService.reset();
    inventoryService.reset();
    equipmentService.configureAppearanceContext({
      bodyAssetId: 'body/bodies_female',
      catalogAssetIdsBySlot: LEGACY_CATALOG_SNAPSHOT,
    });
    seedStarterKit();

    const recipes = equipmentService.buildLpcRecipes();
    // Leather armour (torso) → leather_female; leather boots (feet) → basic_thin.
    expect(recipes.find((r) => r.slot === 'torso')?.assetId).toBe('torso/armour/leather_female');
    expect(recipes.find((r) => r.slot === 'feet')?.assetId).toBe('feet/boots/basic_thin');
    // The wooden starter shield is body-agnostic and stays untouched.
    expect(recipes.find((r) => r.slot === 'shield')?.assetId).toBe(
      'shield/heater/original/wood_fg',
    );
    // Weapons are body-agnostic.
    expect(recipes.find((r) => r.slot === 'weapon')?.assetId).toBe('weapon/sword/longsword');
  });

  test('male wearer keeps the catalog default (male) variants', () => {
    equipmentService.reset();
    inventoryService.reset();
    equipmentService.configureAppearanceContext({
      bodyAssetId: 'body/bodies_male',
      catalogAssetIdsBySlot: LEGACY_CATALOG_SNAPSHOT,
    });
    inventoryService.addItem({ itemId: 'chainmailArmor' });
    equipmentService.equipItem({ itemId: 'chainmailArmor' });

    expect(equipmentService.buildLpcRecipes().find((r) => r.slot === 'torso')?.assetId).toBe(
      'torso/chainmail_male',
    );
  });

  test('hydrated saved gear resolves compatibly at runtime (no re-seed required)', () => {
    equipmentService.reset();
    inventoryService.reset();
    equipmentService.configureAppearanceContext({
      bodyAssetId: 'body/bodies_female',
      catalogAssetIdsBySlot: LEGACY_CATALOG_SNAPSHOT,
    });
    // Save hydration restores gameplay item IDs — the same IDs the save stores.
    equipmentService.hydrate({ slots: { body: 'chainmailArmor', feet: 'leatherBoots' } });

    const recipes = equipmentService.buildLpcRecipes();
    expect(recipes.find((r) => r.slot === 'torso')?.assetId).toBe('torso/chainmail_female');
    expect(recipes.find((r) => r.slot === 'feet')?.assetId).toBe('feet/boots/basic_thin');
  });

  test('equip/unequip preserves gameplay item IDs (visual resolution never rewrites saves)', () => {
    equipmentService.reset();
    inventoryService.reset();
    equipmentService.configureAppearanceContext({
      bodyAssetId: 'body/bodies_female',
      catalogAssetIdsBySlot: LEGACY_CATALOG_SNAPSHOT,
    });
    inventoryService.addItem({ itemId: 'leatherBoots' });
    equipmentService.equipItem({ itemId: 'leatherBoots' });

    expect(equipmentService.serialize().slots?.feet).toBe('leatherBoots');

    equipmentService.unequipItem({ slot: 'feet' });
    expect(equipmentService.getEquippedItemId('feet')).toBeUndefined();
    // Unequipping reveals the base appearance (persona outfit) — nothing is
    // silently re-granted or rewritten into the paperdoll.
    expect(equipmentService.serialize().slots?.feet).toBeUndefined();
  });
});

describe('base recipe vs. equipment layers (C-374)', () => {
  /**
   * Regression: `mergeLpcRecipes` can only REPLACE a same-(slot, layerRole)
   * base layer or APPEND a new one — it never removes one. So an equippable
   * item whose `lpcAssetId` equals the base recipe's asset for that same
   * `lpcSlot` renders identically equipped and unequipped, making the toggle a
   * visual no-op. This happened with the old DEFAULT_LPC_RECIPE, which wore
   * `torso/chainmail_male` + `feet/boots/basic_male` — byte-identical to
   * chainmailArmor / leatherBoots, so unequipping chainmail changed nothing.
   */
  test('no equippable item collides with the base recipe asset for its lpcSlot', () => {
    equipmentService.reset();
    inventoryService.reset();

    const collisions: string[] = [];
    for (const itemId of Object.keys(ITEM_CATALOG)) {
      const definition = getItemDefinition(itemId);
      if (!definition.equippable || !definition.lpcSlot || !definition.lpcAssetId) {
        continue;
      }
      if (DEFAULT_LPC_RECIPE[definition.lpcSlot] === definition.lpcAssetId) {
        collisions.push(`${itemId} → ${definition.lpcAssetId} (base ${definition.lpcSlot})`);
      }
    }
    expect(collisions).toEqual([]);
  });

  test('toggling chainmail actually changes the composed sprite layers', () => {
    equipmentService.reset();
    inventoryService.reset();
    equipmentService.configureAppearanceContext({
      bodyAssetId: DEFAULT_LPC_RECIPE.body,
      catalogAssetIdsBySlot: LEGACY_CATALOG_SNAPSHOT,
    });

    /** Mirrors the engine's base-recipe + mergeLpcRecipes composition. */
    const compose = (): string[] => {
      const layers = Object.entries(DEFAULT_LPC_RECIPE)
        .filter(([, assetId]) => assetId)
        .map(([slot, assetId]) => ({ slot, assetId }));
      for (const recipe of equipmentService.buildLpcRecipes()) {
        const index = layers.findIndex((entry) => entry.slot === recipe.slot);
        if (index >= 0) {
          layers[index] = { slot: recipe.slot, assetId: recipe.assetId };
        } else {
          layers.push({ slot: recipe.slot, assetId: recipe.assetId });
        }
      }
      return layers.map((entry) => `${entry.slot}=${entry.assetId}`).toSorted();
    };

    const unequipped = compose();
    inventoryService.addItem({ itemId: 'chainmailArmor' });
    equipmentService.equipItem({ itemId: 'chainmailArmor' });
    const equipped = compose();

    expect(equipped).not.toEqual(unequipped);

    equipmentService.unequipItem({ slot: 'body' });
    expect(compose()).toEqual(unequipped);
  });
});
