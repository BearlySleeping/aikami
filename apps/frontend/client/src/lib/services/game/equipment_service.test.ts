// apps/frontend/client/src/lib/services/game/equipment_service.test.ts
//
// Unit tests for EquipmentService — single equip path, serialization,
// stat computation, and reset.
//
// Contract C-331 AC-4.

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
    expect(equipmentService.equippedWeapon).toBeUndefined();
    expect(inventoryService.inventory.length).toBe(1); // not consumed
  });

  test('equipItem returns false when item is not in inventory', () => {
    expect(equipmentService.equipItem({ itemId: 'ironSword' })).toBe(false);
    expect(equipmentService.equippedWeapon).toBeUndefined();
  });

  test('equipItem equips weapon and removes it from inventory', () => {
    inventoryService.addItem({ itemId: 'ironSword' });
    const equipped = equipmentService.equipItem({ itemId: 'ironSword' });
    expect(equipped).toBe(true);
    expect(equipmentService.equippedWeapon).toBe('ironSword');
    expect(inventoryService.inventory.find((e) => e.itemId === 'ironSword')).toBeUndefined();
  });

  test('equipItem equips armor and removes it from inventory', () => {
    inventoryService.addItem({ itemId: 'ironArmor' });
    const equipped = equipmentService.equipItem({ itemId: 'ironArmor' });
    expect(equipped).toBe(true);
    expect(equipmentService.equippedArmor).toBe('ironArmor');
    expect(inventoryService.inventory.find((e) => e.itemId === 'ironArmor')).toBeUndefined();
  });

  test('equipItem swaps weapon — old weapon returns to inventory', () => {
    inventoryService.addItem({ itemId: 'rustySword' });
    inventoryService.addItem({ itemId: 'ironSword' });
    equipmentService.equipItem({ itemId: 'rustySword' });
    expect(equipmentService.equippedWeapon).toBe('rustySword');

    equipmentService.equipItem({ itemId: 'ironSword' });
    expect(equipmentService.equippedWeapon).toBe('ironSword');
    // rustySword should be back in inventory
    const rusty = inventoryService.inventory.find((e) => e.itemId === 'rustySword');
    expect(rusty).toBeDefined();
    expect(rusty!.quantity).toBe(1);
  });

  test('equipItem with stack splits — equipping from a stack of 2 decrements to 1 (C-331 edge case)', () => {
    inventoryService.addItem({ itemId: 'ironSword', quantity: 2 });
    const equipped = equipmentService.equipItem({ itemId: 'ironSword' });
    expect(equipped).toBe(true);
    expect(equipmentService.equippedWeapon).toBe('ironSword');
    const remaining = inventoryService.inventory.find((e) => e.itemId === 'ironSword');
    expect(remaining).toBeDefined();
    expect(remaining!.quantity).toBe(1);
  });

  test('unequipItem returns item to inventory', () => {
    inventoryService.addItem({ itemId: 'ironArmor' });
    equipmentService.equipItem({ itemId: 'ironArmor' });
    expect(equipmentService.equippedArmor).toBe('ironArmor');

    const result = equipmentService.unequipItem({ slot: 'armor' });
    expect(result).toBe(true);
    expect(equipmentService.equippedArmor).toBeUndefined();
    const returned = inventoryService.inventory.find((e) => e.itemId === 'ironArmor');
    expect(returned).toBeDefined();
    expect(returned!.quantity).toBe(1);
  });

  test('unequipItem returns false when slot is empty', () => {
    const result = equipmentService.unequipItem({ slot: 'weapon' });
    expect(result).toBe(false);
  });

  // ── Stats ─────────────────────────────────────────────────────────

  test('totalAttack includes weapon bonus', () => {
    // base attack = 5, ironSword = +5 → 10
    inventoryService.addItem({ itemId: 'ironSword' });
    equipmentService.equipItem({ itemId: 'ironSword' });
    expect(equipmentService.totalAttack).toBe(10); // 5 base + 5 sword
  });

  test('totalDefense includes armor bonus', () => {
    // base defense = 12, ironArmor = +5 → 17
    inventoryService.addItem({ itemId: 'ironArmor' });
    equipmentService.equipItem({ itemId: 'ironArmor' });
    expect(equipmentService.totalDefense).toBe(17); // 12 base + 5 armor
  });

  test('totalAttack returns base when nothing equipped', () => {
    expect(equipmentService.totalAttack).toBe(5);
  });

  // ── Serialize / hydrate (AC-2) ────────────────────────────────────

  test('serialize returns slot IDs', () => {
    inventoryService.addItem({ itemId: 'ironSword' });
    inventoryService.addItem({ itemId: 'ironArmor' });
    equipmentService.equipItem({ itemId: 'ironSword' });
    equipmentService.equipItem({ itemId: 'ironArmor' });

    const snapshot = equipmentService.serialize();
    expect(snapshot.equippedWeapon).toBe('ironSword');
    expect(snapshot.equippedArmor).toBe('ironArmor');
  });

  test('hydrate restores slots', () => {
    equipmentService.hydrate({
      equippedWeapon: 'steelSword',
      equippedArmor: 'leatherArmor',
    });
    expect(equipmentService.equippedWeapon).toBe('steelSword');
    expect(equipmentService.equippedArmor).toBe('leatherArmor');
  });

  // ── Reset ─────────────────────────────────────────────────────────

  test('reset clears equipment', () => {
    inventoryService.addItem({ itemId: 'ironSword' });
    equipmentService.equipItem({ itemId: 'ironSword' });
    equipmentService.reset();
    expect(equipmentService.equippedWeapon).toBeUndefined();
    expect(equipmentService.equippedArmor).toBeUndefined();
  });
});
