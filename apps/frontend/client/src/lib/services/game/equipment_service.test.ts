// apps/frontend/client/src/lib/services/game/equipment_service.test.ts
//
// Unit tests for EquipmentService — 5-slot paperdoll, single equip path,
// serialization, stat computation, and reset.
//
// Contracts: C-331 AC-4, C-374 Equipment, Armour & Weapon Inventory UI.

import { beforeEach, describe, expect, test } from 'bun:test';
import { equipmentService } from './equipment_service.svelte';
import { inventoryService } from './inventory_service.svelte';
import { playerStateService } from './player_state_service.svelte';

describe('EquipmentService', () => {
  beforeEach(() => {
    equipmentService.reset();
    inventoryService.reset();
    playerStateService.reset();
  });

  // ── Equip / Unequip (AC-4) ────────────────────────────────────────

  test('equipItem returns false for non-equippable item', () => {
    inventoryService.addItem({ itemId: 'healthPotion' });
    expect(equipmentService.equipItem({ itemId: 'healthPotion' })).toBe(false);
    expect(equipmentService.getEquippedItemId('rightHand')).toBeUndefined();
    expect(inventoryService.inventory.length).toBe(1); // not consumed
  });

  test('equipItem returns false when item is not in inventory', () => {
    expect(equipmentService.equipItem({ itemId: 'ironSword' })).toBe(false);
    expect(equipmentService.getEquippedItemId('rightHand')).toBeUndefined();
  });

  test('equipItem equips weapon into rightHand and removes it from inventory', () => {
    inventoryService.addItem({ itemId: 'ironSword' });
    const equipped = equipmentService.equipItem({ itemId: 'ironSword' });
    expect(equipped).toBe(true);
    expect(equipmentService.getEquippedItemId('rightHand')).toBe('ironSword');
    expect(inventoryService.inventory.find((e) => e.itemId === 'ironSword')).toBeUndefined();
  });

  test('equipItem equips shield into leftHand and armor into body', () => {
    inventoryService.addItem({ itemId: 'woodenShield' });
    inventoryService.addItem({ itemId: 'ironArmor' });
    expect(equipmentService.equipItem({ itemId: 'woodenShield' })).toBe(true);
    expect(equipmentService.equipItem({ itemId: 'ironArmor' })).toBe(true);
    expect(equipmentService.getEquippedItemId('leftHand')).toBe('woodenShield');
    expect(equipmentService.getEquippedItemId('body')).toBe('ironArmor');
  });

  test('equipItem equips bow into rightHand (same slot as sword)', () => {
    inventoryService.addItem({ itemId: 'shortBow' });
    expect(equipmentService.equipItem({ itemId: 'shortBow' })).toBe(true);
    expect(equipmentService.getEquippedItemId('rightHand')).toBe('shortBow');
  });

  test('equipItem swaps weapon — old weapon returns to inventory', () => {
    inventoryService.addItem({ itemId: 'rustySword' });
    inventoryService.addItem({ itemId: 'ironSword' });
    equipmentService.equipItem({ itemId: 'rustySword' });
    expect(equipmentService.getEquippedItemId('rightHand')).toBe('rustySword');

    equipmentService.equipItem({ itemId: 'ironSword' });
    expect(equipmentService.getEquippedItemId('rightHand')).toBe('ironSword');
    // rustySword should be back in inventory
    const rusty = inventoryService.inventory.find((e) => e.itemId === 'rustySword');
    expect(rusty).toBeDefined();
    expect(rusty?.quantity).toBe(1);
  });

  test('equipItem with stack splits — equipping from a stack of 2 decrements to 1 (C-331 edge case)', () => {
    inventoryService.addItem({ itemId: 'ironSword', quantity: 2 });
    const equipped = equipmentService.equipItem({ itemId: 'ironSword' });
    expect(equipped).toBe(true);
    expect(equipmentService.getEquippedItemId('rightHand')).toBe('ironSword');
    const remaining = inventoryService.inventory.find((e) => e.itemId === 'ironSword');
    expect(remaining).toBeDefined();
    expect(remaining?.quantity).toBe(1);
  });

  test('unequipItem returns item to inventory', () => {
    inventoryService.addItem({ itemId: 'ironArmor' });
    equipmentService.equipItem({ itemId: 'ironArmor' });
    expect(equipmentService.getEquippedItemId('body')).toBe('ironArmor');

    const result = equipmentService.unequipItem({ slot: 'body' });
    expect(result).toBe(true);
    expect(equipmentService.getEquippedItemId('body')).toBeUndefined();
    const returned = inventoryService.inventory.find((e) => e.itemId === 'ironArmor');
    expect(returned).toBeDefined();
    expect(returned?.quantity).toBe(1);
  });

  test('unequipItem returns false when slot is empty', () => {
    expect(equipmentService.unequipItem({ slot: 'rightHand' })).toBe(false);
  });

  test('equippedItems lists filled slots in canonical order', () => {
    inventoryService.addItem({ itemId: 'ironSword' });
    inventoryService.addItem({ itemId: 'leatherBoots' });
    equipmentService.equipItem({ itemId: 'leatherBoots' });
    equipmentService.equipItem({ itemId: 'ironSword' });
    const slots = equipmentService.equippedItems.map((e) => e.slot);
    // Canonical order: head, leftHand, rightHand, body, feet
    expect(slots).toEqual(['rightHand', 'feet']);
  });

  // ── Stats ─────────────────────────────────────────────────────────

  test('totalAttack includes weapon bonus', () => {
    // base attack = 5, ironSword = +5 → 10
    inventoryService.addItem({ itemId: 'ironSword' });
    equipmentService.equipItem({ itemId: 'ironSword' });
    expect(equipmentService.totalAttack).toBe(10); // 5 base + 5 sword
  });

  test('totalDefense sums bonuses across all slots', () => {
    // base defense = 12, ironArmor = +5, woodenShield = +2, leatherBoots = +1 → 20
    inventoryService.addItem({ itemId: 'ironArmor' });
    inventoryService.addItem({ itemId: 'woodenShield' });
    inventoryService.addItem({ itemId: 'leatherBoots' });
    equipmentService.equipItem({ itemId: 'ironArmor' });
    equipmentService.equipItem({ itemId: 'woodenShield' });
    equipmentService.equipItem({ itemId: 'leatherBoots' });
    expect(equipmentService.totalDefense).toBe(20);
  });

  test('totalAttack returns base when nothing equipped', () => {
    expect(equipmentService.totalAttack).toBe(5);
  });

  // ── Serialize / hydrate (AC-2) ────────────────────────────────────

  test('serialize returns slots record', () => {
    inventoryService.addItem({ itemId: 'ironSword' });
    inventoryService.addItem({ itemId: 'ironArmor' });
    equipmentService.equipItem({ itemId: 'ironSword' });
    equipmentService.equipItem({ itemId: 'ironArmor' });

    const snapshot = equipmentService.serialize();
    expect(snapshot.slots?.rightHand).toBe('ironSword');
    expect(snapshot.slots?.body).toBe('ironArmor');
  });

  test('hydrate restores slots from canonical shape', () => {
    equipmentService.hydrate({
      slots: { rightHand: 'steelSword', body: 'leatherArmor', feet: 'leatherBoots' },
    });
    expect(equipmentService.getEquippedItemId('rightHand')).toBe('steelSword');
    expect(equipmentService.getEquippedItemId('body')).toBe('leatherArmor');
    expect(equipmentService.getEquippedItemId('feet')).toBe('leatherBoots');
  });

  test('hydrate maps legacy equippedWeapon/equippedArmor to rightHand/body', () => {
    equipmentService.hydrate({
      equippedWeapon: 'steelSword',
      equippedArmor: 'leatherArmor',
    });
    expect(equipmentService.getEquippedItemId('rightHand')).toBe('steelSword');
    expect(equipmentService.getEquippedItemId('body')).toBe('leatherArmor');
  });

  test('hydrate does NOT restore legacy wardAmulet (retired item with no valid slot)', () => {
    equipmentService.hydrate({
      equippedArmor: 'wardAmulet',
    });
    // wardAmulet has no valid equipmentSlot → not equippable → NOT hydrated
    expect(equipmentService.getEquippedItemId('body')).toBeUndefined();
    // Defense bonus should remain at base (no equipped items)
    expect(equipmentService.totalDefense).toBe(12); // base defense only
  });

  // ── Reset ─────────────────────────────────────────────────────────

  test('reset clears equipment', () => {
    inventoryService.addItem({ itemId: 'ironSword' });
    equipmentService.equipItem({ itemId: 'ironSword' });
    equipmentService.reset();
    expect(equipmentService.getEquippedItemId('rightHand')).toBeUndefined();
    expect(equipmentService.equippedItems.length).toBe(0);
  });
});
