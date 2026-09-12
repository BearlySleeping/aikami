// apps/frontend/client/src/lib/views/inventory/inventory_view_model.test.ts
//
// Unit tests for InventoryViewModel — inventory/equipment state passthrough,
// equip/unequip/use delegation, and SFX feedback. This suite exercises the
// ViewModel through feature-owned capability fixtures — no global `$services`
// barrel mock / `mock.module`.
//
// Contract: C-153 Character Dashboard & Equipment
// Contract: C-331 single equip path + consumable use
// Contract: C-374 full paperdoll slots + summed stats

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import {
  createInventoryViewModel,
  type EquipmentCapabilities,
  type InventoryCapabilities,
  type InventoryOverlayCapabilities,
  type InventorySfxCapabilities,
  type InventoryViewModelOptions,
} from './inventory_view_model.svelte';

// ── Fixtures ──────────────────────────────────────────────────────────────

const createInventory = (
  overrides: Partial<InventoryCapabilities> = {},
): InventoryCapabilities => ({
  inventory: [],
  feedbackMessage: undefined,
  useConsumable: () => 'not-owned',
  ...overrides,
});

const createEquipment = (
  overrides: Partial<EquipmentCapabilities> = {},
): EquipmentCapabilities => ({
  getEquippedItemId: () => undefined,
  totalAttack: 0,
  totalDefense: 0,
  equipItem: () => false,
  unequipItem: () => false,
  ...overrides,
});

const createOverlays = (
  overrides: Partial<InventoryOverlayCapabilities> = {},
): InventoryOverlayCapabilities => ({
  closeInventory: () => {},
  ...overrides,
});

const createSfx = (): { sfx: InventorySfxCapabilities; calls: string[] } => {
  const calls: string[] = [];
  return {
    sfx: {
      playSfxByName: (name) => {
        calls.push(name);
      },
    },
    calls,
  };
};

const createViewModel = (
  options: {
    inventory?: InventoryCapabilities;
    equipment?: EquipmentCapabilities;
    overlays?: InventoryOverlayCapabilities;
    sfx?: InventorySfxCapabilities;
  } = {},
) =>
  createInventoryViewModel({
    className: 'InventoryViewModelTest',
    inventory: options.inventory ?? createInventory(),
    equipment: options.equipment ?? createEquipment(),
    overlays: options.overlays ?? createOverlays(),
    sfx: options.sfx ?? { playSfxByName: () => {} },
  } satisfies InventoryViewModelOptions);

// ── Tests ─────────────────────────────────────────────────────────────────

describe('InventoryViewModel — state passthrough', () => {
  test('exposes the injected inventory items', () => {
    const viewModel = createViewModel({
      inventory: createInventory({ inventory: [{ itemId: 'ironSword', quantity: 2 }] }),
    });

    expect(viewModel.items).toEqual([{ itemId: 'ironSword', quantity: 2 }]);
  });

  test('reads summed stats from the equipment capability', () => {
    const viewModel = createViewModel({
      equipment: createEquipment({ totalAttack: 7, totalDefense: 4 }),
    });

    expect(viewModel.totalAttack).toBe(7);
    expect(viewModel.totalDefense).toBe(4);
  });

  test('builds equipped item views with resolved definitions', () => {
    const viewModel = createViewModel({
      equipment: createEquipment({
        getEquippedItemId: (slot) => (slot === 'rightHand' ? 'ironSword' : undefined),
      }),
    });

    expect(viewModel.equippedItems).toHaveLength(1);
    expect(viewModel.equippedItems[0]?.slot).toBe('rightHand');
    expect(viewModel.equippedItems[0]?.definition.label).toBe('Iron Sword');
  });

  test('reports no equipped item for an empty slot', () => {
    const viewModel = createViewModel();

    expect(viewModel.getEquippedItem('head')).toBeUndefined();
  });

  test('falls back to the inventory feedback when there is no local action', () => {
    const viewModel = createViewModel({
      inventory: createInventory({ feedbackMessage: 'Inventory full!' }),
    });

    expect(viewModel.feedbackMessage).toBe('Inventory full!');
  });
});

describe('InventoryViewModel — equip/unequip', () => {
  test('equipItem delegates and plays the equip SFX on success', () => {
    const equipItem = mock(() => true);
    const { sfx, calls } = createSfx();
    const viewModel = createViewModel({ equipment: createEquipment({ equipItem }), sfx });

    viewModel.equipItem('ironSword');

    expect(equipItem).toHaveBeenCalledWith({ itemId: 'ironSword' });
    expect(calls).toEqual(['sfx_equip']);
  });

  test('equipItem does not play SFX when the equip fails', () => {
    const equipItem = mock(() => false);
    const { sfx, calls } = createSfx();
    const viewModel = createViewModel({ equipment: createEquipment({ equipItem }), sfx });

    viewModel.equipItem('ironSword');

    expect(equipItem).toHaveBeenCalledWith({ itemId: 'ironSword' });
    expect(calls).toEqual([]);
  });

  test('unequipItem delegates to the equipment capability', () => {
    const unequipItem = mock(() => true);
    const viewModel = createViewModel({ equipment: createEquipment({ unequipItem }) });

    viewModel.unequipItem('leftHand');

    expect(unequipItem).toHaveBeenCalledWith({ slot: 'leftHand' });
  });
});

describe('InventoryViewModel — consumable use', () => {
  test('useItem plays the pickup SFX and shows a success message', () => {
    const useConsumable = mock(() => 'ok' as const);
    const { sfx, calls } = createSfx();
    const viewModel = createViewModel({ inventory: createInventory({ useConsumable }), sfx });

    viewModel.useItem('healthPotion');

    expect(useConsumable).toHaveBeenCalledWith({ itemId: 'healthPotion' });
    expect(calls).toEqual(['sfx_pickup']);
    expect(viewModel.feedbackMessage).toBe('Used Health Potion');
  });

  test('useItem reports full HP without playing SFX', () => {
    const useConsumable = mock(() => 'full-hp' as const);
    const { sfx, calls } = createSfx();
    const viewModel = createViewModel({ inventory: createInventory({ useConsumable }), sfx });

    viewModel.useItem('healthPotion');

    expect(calls).toEqual([]);
    expect(viewModel.feedbackMessage).toBe('Already at full HP');
  });
});

describe('InventoryViewModel — item classification', () => {
  test('classifies equippable and consumable items from the catalog', () => {
    const viewModel = createViewModel();

    expect(viewModel.isEquippable('ironSword')).toBe(true);
    expect(viewModel.isConsumable('healthPotion')).toBe(true);
    expect(viewModel.isConsumable('ironSword')).toBe(false);
  });

  test('getCompareLabel reports the stat delta against the equipped item', () => {
    const viewModel = createViewModel({
      equipment: createEquipment({
        getEquippedItemId: (slot) => (slot === 'rightHand' ? 'rustySword' : undefined),
      }),
    });

    expect(viewModel.getCompareLabel('ironSword')).toBe('+2 ATK');
  });
});

describe('InventoryViewModel — overlay navigation', () => {
  test('closeInventory delegates to the overlay capability', () => {
    const closeInventory = mock(() => {});
    const viewModel = createViewModel({ overlays: createOverlays({ closeInventory }) });

    viewModel.closeInventory();

    expect(closeInventory).toHaveBeenCalledTimes(1);
  });
});

describe('InventoryViewModel — bag search and sort', () => {
  const bagInventory = () =>
    createInventory({
      inventory: [
        { itemId: 'rustySword', quantity: 3 },
        { itemId: 'ironSword', quantity: 1 },
      ],
    });

  test('filters by item label, case-insensitively', () => {
    const viewModel = createViewModel({ inventory: bagInventory() });

    viewModel.setSearchQuery('IRON');

    expect(viewModel.hasSearchQuery).toBe(true);
    expect(viewModel.visibleItems).toEqual([{ itemId: 'ironSword', quantity: 1 }]);
  });

  test('a blank query returns the whole bag', () => {
    const viewModel = createViewModel({ inventory: bagInventory() });

    viewModel.setSearchQuery('   ');

    expect(viewModel.hasSearchQuery).toBe(false);
    expect(viewModel.visibleItems).toHaveLength(2);
  });

  test('an unmatched query yields no visible items but keeps the bag', () => {
    const viewModel = createViewModel({ inventory: bagInventory() });

    viewModel.setSearchQuery('nonexistent');

    expect(viewModel.hasItems).toBe(true);
    expect(viewModel.visibleItems).toHaveLength(0);
  });

  test('sorts by name without mutating the source order', () => {
    const inventory = bagInventory();
    const viewModel = createViewModel({ inventory });

    viewModel.setSortMode('name');

    expect(viewModel.visibleItems.map((item) => item.itemId)).toEqual(['ironSword', 'rustySword']);
    expect(inventory.inventory.map((item) => item.itemId)).toEqual(['rustySword', 'ironSword']);
  });

  test('sorts by quantity descending', () => {
    const viewModel = createViewModel({ inventory: bagInventory() });

    viewModel.setSortMode('quantity');

    expect(viewModel.visibleItems.map((item) => item.itemId)).toEqual(['rustySword', 'ironSword']);
  });
});

describe('InventoryViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
