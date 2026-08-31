// apps/frontend/client/src/lib/services/game/equipment_starter_kit.test.ts
//
// Verifies the STARTER_KIT constant resolves fully: every item exists in the
// item catalog, equipment items are equippable into their slots, and the
// seeded character renders LPC recipes for all equipped gear.
//
// Contract: C-374 Equipment, Armour & Weapon Inventory UI

import { beforeEach, describe, expect, test } from 'bun:test';
import { STARTER_KIT } from '@aikami/constants';
import { getItemDefinition } from '$utils/inventory_utils';
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

  test('seedBaseOutfit fills empty body/feet slots from the base recipe', () => {
    equipmentService.reset();
    inventoryService.reset();
    equipmentService.seedBaseOutfit({
      body: 'body/bodies_male',
      hair: 'hair/bangs_adult',
      torso: 'torso/chainmail_male',
      legs: 'legs/pants_male',
      feet: 'feet/boots/basic_male',
      head: 'head/heads/human_male',
    });
    // Default character's chainmail + boots appear in the paperdoll
    expect(equipmentService.getEquippedItemId('body')).toBe('chainmailArmor');
    expect(equipmentService.getEquippedItemId('feet')).toBe('leatherBoots');
    // Equipped items moved out of the bag into their slots
    expect(inventoryService.inventory.some((e) => e.itemId === 'chainmailArmor')).toBe(false);
    expect(inventoryService.inventory.some((e) => e.itemId === 'leatherBoots')).toBe(false);
  });

  test('seedBaseOutfit never clobbers saved gear', () => {
    equipmentService.reset();
    inventoryService.reset();
    inventoryService.addItem({ itemId: 'ironArmor' });
    equipmentService.equipItem({ itemId: 'ironArmor' });
    equipmentService.seedBaseOutfit({
      torso: 'torso/chainmail_male',
      feet: 'feet/boots/basic_male',
    });
    expect(equipmentService.getEquippedItemId('body')).toBe('ironArmor');
  });

  // Regression (C-374/C-417): boot seeds the base outfit during engine
  // creation, then save hydration restores the service snapshots. An empty
  // equipment snapshot ({ slots: {} }) must not wipe the seeded chainmail/
  // boots — the boot pipeline re-seeds AFTER hydration (game_boot_service
  // _stageHydrateSnapshot), which fills only empty slots, so the base outfit
  // survives while real saved gear is preserved.
  test('re-seeding after an empty-slot hydrate restores the base outfit', () => {
    equipmentService.reset();
    inventoryService.reset();

    // Engine creation seeds the base outfit.
    equipmentService.seedBaseOutfit({
      body: 'body/bodies_male',
      hair: 'hair/bangs_adult',
      torso: 'torso/chainmail_male',
      legs: 'legs/pants_male',
      feet: 'feet/boots/basic_male',
      head: 'head/heads/human_male',
    });
    expect(equipmentService.getEquippedItemId('body')).toBe('chainmailArmor');

    // Save hydration restores an empty equipment snapshot.
    equipmentService.hydrate({ slots: {} });
    expect(equipmentService.getEquippedItemId('body')).toBeUndefined();

    // Boot re-seeds after hydration — the base outfit returns.
    equipmentService.seedBaseOutfit({
      torso: 'torso/chainmail_male',
      feet: 'feet/boots/basic_male',
    });
    expect(equipmentService.getEquippedItemId('body')).toBe('chainmailArmor');
    expect(equipmentService.getEquippedItemId('feet')).toBe('leatherBoots');
  });

  // Re-seeding must not clobber real gear the save actually restored.
  test('re-seeding after hydrate preserves restored saved gear', () => {
    equipmentService.reset();
    inventoryService.reset();

    // Save hydration restored real gear (iron armor + steel sword).
    equipmentService.hydrate({
      slots: { body: 'ironArmor', rightHand: 'steelSword' },
    });

    // Boot re-seeds — must not clobber the restored iron armor.
    equipmentService.seedBaseOutfit({
      torso: 'torso/chainmail_male',
      feet: 'feet/boots/basic_male',
    });
    expect(equipmentService.getEquippedItemId('body')).toBe('ironArmor');
    expect(equipmentService.getEquippedItemId('rightHand')).toBe('steelSword');
    // Empty feet slot gets filled by the base outfit.
    expect(equipmentService.getEquippedItemId('feet')).toBe('leatherBoots');
  });

  // Regression (C-374/C-417): re-seeding must reuse an owned matching item
  // when the slot is empty instead of granting a duplicate. Hydration may
  // restore the chainmail/boots into the bag while leaving the slot empty;
  // re-seeding should equip the owned item without inflating its quantity.
  test('re-seeding equips an owned matching item without increasing quantity', () => {
    equipmentService.reset();
    inventoryService.reset();

    // Hydration restored the matching items into the bag, slots empty.
    inventoryService.addItem({ itemId: 'chainmailArmor', quantity: 1 });
    inventoryService.addItem({ itemId: 'leatherBoots', quantity: 1 });

    // Boot re-seeds — should equip the owned items, not grant duplicates.
    equipmentService.seedBaseOutfit({
      torso: 'torso/chainmail_male',
      feet: 'feet/boots/basic_male',
    });

    expect(equipmentService.getEquippedItemId('body')).toBe('chainmailArmor');
    expect(equipmentService.getEquippedItemId('feet')).toBe('leatherBoots');
    // The owned items were moved into their slots — no duplicate remains in
    // the bag (a buggy re-seed would have added a second copy).
    expect(inventoryService.inventory.some((e) => e.itemId === 'chainmailArmor')).toBe(false);
    expect(inventoryService.inventory.some((e) => e.itemId === 'leatherBoots')).toBe(false);
  });
});
