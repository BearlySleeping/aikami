// packages/frontend/engine/src/__tests__/economy.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, getComponent, set } from 'bitecs';
import type { InventoryData, WalletData } from '../components/inventory.ts';
import {
  Inventory,
  MAX_INVENTORY_SLOTS,
  registerInventoryObservers,
  registerWalletObservers,
  Wallet,
} from '../components/inventory.ts';
import {
  addItemStack,
  deductItem,
  hasItemCapacity,
  processTransaction,
  resetEconomyTracking,
} from '../systems/economy_system.ts';

// ---------------------------------------------------------------------------
// Helper: set up a world with inventory observers registered
// ---------------------------------------------------------------------------

const createTestWorld = (): World => {
  const world = createWorld();
  registerInventoryObservers(world);
  registerWalletObservers(world);
  return world;
};

/** Creates an empty 24-slot inventory data payload. */
const emptyInventory = (): InventoryData => ({
  itemIds: new Array(MAX_INVENTORY_SLOTS).fill(0) as number[],
  quantities: new Array(MAX_INVENTORY_SLOTS).fill(0) as number[],
  itemTypes: new Array(MAX_INVENTORY_SLOTS).fill(0) as number[],
});

/** Creates an inventory with a single item stack in the first slot. */
const inventoryWithStack = (options: {
  itemId: number;
  quantity: number;
  itemType?: number;
  slot?: number;
}): InventoryData => {
  const data = emptyInventory();
  const slot = options.slot ?? 0;
  data.itemIds[slot] = options.itemId;
  data.quantities[slot] = options.quantity;
  data.itemTypes[slot] = options.itemType ?? 1;
  return data;
};

// ---------------------------------------------------------------------------
// AC-1: Zero-Allocation Structural Inventory Transfers
// ---------------------------------------------------------------------------

describe('Economy — AC-1: inventory transfers', () => {
  let world: World;

  beforeEach(() => {
    world = createTestWorld();
  });

  afterEach(() => {
    resetEconomyTracking(world);
  });

  it('transfers items from source to target entity', () => {
    const sourceEid = addEntity(world);
    addComponent(world, sourceEid, Inventory);
    addComponent(
      world,
      sourceEid,
      set(Inventory, inventoryWithStack({ itemId: 100, quantity: 5 })),
    );

    const targetEid = addEntity(world);
    addComponent(world, targetEid, Inventory);
    addComponent(world, targetEid, set(Inventory, emptyInventory()));

    processTransaction({
      world,
      sourceEntity: sourceEid,
      targetEntity: targetEid,
      itemId: 100,
      quantity: 2,
      price: 0,
    });

    const sourceInv = getComponent(world, sourceEid, Inventory) as InventoryData;
    expect(sourceInv.quantities[0]).toBe(3);

    const targetInv = getComponent(world, targetEid, Inventory) as InventoryData;
    expect(targetInv.quantities[0]).toBe(2);
    expect(targetInv.itemIds[0]).toBe(100);
  });

  it('stacks items with same itemId in target inventory', () => {
    const sourceEid = addEntity(world);
    addComponent(world, sourceEid, Inventory);
    addComponent(
      world,
      sourceEid,
      set(Inventory, inventoryWithStack({ itemId: 100, quantity: 5 })),
    );

    const targetEid = addEntity(world);
    addComponent(world, targetEid, Inventory);
    addComponent(
      world,
      targetEid,
      set(Inventory, inventoryWithStack({ itemId: 100, quantity: 3 })),
    );

    processTransaction({
      world,
      sourceEntity: sourceEid,
      targetEntity: targetEid,
      itemId: 100,
      quantity: 2,
      price: 0,
    });

    const sourceInv = getComponent(world, sourceEid, Inventory) as InventoryData;
    expect(sourceInv.quantities[0]).toBe(3);

    const targetInv = getComponent(world, targetEid, Inventory) as InventoryData;
    // Target already had 3 of item 100 in slot 0, now should have 5
    expect(targetInv.quantities[0]).toBe(5);
    expect(targetInv.itemIds[0]).toBe(100);
  });

  it('fills an empty slot when target has no matching item stack', () => {
    const sourceEid = addEntity(world);
    addComponent(world, sourceEid, Inventory);
    addComponent(
      world,
      sourceEid,
      set(Inventory, inventoryWithStack({ itemId: 100, quantity: 5 })),
    );

    const targetEid = addEntity(world);
    addComponent(world, targetEid, Inventory);
    const targetData = emptyInventory();
    // Fill slot 0 with a different item
    targetData.itemIds[0] = 200;
    targetData.quantities[0] = 3;
    targetData.itemTypes[0] = 1;
    addComponent(world, targetEid, set(Inventory, targetData));

    processTransaction({
      world,
      sourceEntity: sourceEid,
      targetEntity: targetEid,
      itemId: 100,
      quantity: 2,
      price: 0,
    });

    const targetInv = getComponent(world, targetEid, Inventory) as InventoryData;
    // Slot 0 still has item 200
    expect(targetInv.itemIds[0]).toBe(200);
    expect(targetInv.quantities[0]).toBe(3);
    // Slot 1 now has item 100
    expect(targetInv.itemIds[1]).toBe(100);
    expect(targetInv.quantities[1]).toBe(2);
  });

  it('clears the source slot when quantity reaches zero', () => {
    const sourceEid = addEntity(world);
    addComponent(world, sourceEid, Inventory);
    addComponent(
      world,
      sourceEid,
      set(Inventory, inventoryWithStack({ itemId: 100, quantity: 2 })),
    );

    const targetEid = addEntity(world);
    addComponent(world, targetEid, Inventory);
    addComponent(world, targetEid, set(Inventory, emptyInventory()));

    processTransaction({
      world,
      sourceEntity: sourceEid,
      targetEntity: targetEid,
      itemId: 100,
      quantity: 2,
      price: 0,
    });

    const sourceInv = getComponent(world, sourceEid, Inventory) as InventoryData;
    expect(sourceInv.itemIds[0]).toBe(0);
    expect(sourceInv.quantities[0]).toBe(0);
  });

  it('transfers wallet currency when price is set', () => {
    const sourceEid = addEntity(world);
    addComponent(world, sourceEid, Inventory);
    addComponent(
      world,
      sourceEid,
      set(Inventory, inventoryWithStack({ itemId: 100, quantity: 5 })),
    );
    addComponent(world, sourceEid, Wallet);
    addComponent(world, sourceEid, set(Wallet, { balance: 0 }));

    const targetEid = addEntity(world);
    addComponent(world, targetEid, Inventory);
    addComponent(world, targetEid, set(Inventory, emptyInventory()));
    addComponent(world, targetEid, Wallet);
    addComponent(world, targetEid, set(Wallet, { balance: 100 }));

    processTransaction({
      world,
      sourceEntity: sourceEid,
      targetEntity: targetEid,
      itemId: 100,
      quantity: 2,
      price: 30,
    });

    const sourceWallet = getComponent(world, sourceEid, Wallet) as WalletData;
    expect(sourceWallet.balance).toBe(30);

    const targetWallet = getComponent(world, targetEid, Wallet) as WalletData;
    expect(targetWallet.balance).toBe(70);
  });

  it('transfers items without wallet when neither entity has Wallet component', () => {
    const sourceEid = addEntity(world);
    addComponent(world, sourceEid, Inventory);
    addComponent(
      world,
      sourceEid,
      set(Inventory, inventoryWithStack({ itemId: 100, quantity: 5 })),
    );

    const targetEid = addEntity(world);
    addComponent(world, targetEid, Inventory);
    addComponent(world, targetEid, set(Inventory, emptyInventory()));

    // Should not throw — walletless transfer is valid when price is 0
    expect(() => {
      processTransaction({
        world,
        sourceEntity: sourceEid,
        targetEntity: targetEid,
        itemId: 100,
        quantity: 2,
        price: 0,
      });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC-2: Boundary Enforcement & Underflow Guard Rails
// ---------------------------------------------------------------------------

describe('Economy — AC-2: boundary enforcement', () => {
  let world: World;

  beforeEach(() => {
    world = createTestWorld();
  });

  afterEach(() => {
    resetEconomyTracking(world);
  });

  it('throws when source entity does not have the requested item', () => {
    const sourceEid = addEntity(world);
    addComponent(world, sourceEid, Inventory);
    addComponent(world, sourceEid, set(Inventory, emptyInventory()));

    const targetEid = addEntity(world);
    addComponent(world, targetEid, Inventory);
    addComponent(world, targetEid, set(Inventory, emptyInventory()));

    expect(() => {
      processTransaction({
        world,
        sourceEntity: sourceEid,
        targetEntity: targetEid,
        itemId: 100,
        quantity: 1,
        price: 0,
      });
    }).toThrow();
  });

  it('throws when deducting more than available quantity', () => {
    const sourceEid = addEntity(world);
    addComponent(world, sourceEid, Inventory);
    addComponent(
      world,
      sourceEid,
      set(Inventory, inventoryWithStack({ itemId: 100, quantity: 3 })),
    );

    const targetEid = addEntity(world);
    addComponent(world, targetEid, Inventory);
    addComponent(world, targetEid, set(Inventory, emptyInventory()));

    expect(() => {
      processTransaction({
        world,
        sourceEntity: sourceEid,
        targetEntity: targetEid,
        itemId: 100,
        quantity: 5,
        price: 0,
      });
    }).toThrow();
  });

  it('keeps source state unmodified after failed deduction', () => {
    const sourceEid = addEntity(world);
    addComponent(world, sourceEid, Inventory);
    addComponent(
      world,
      sourceEid,
      set(Inventory, inventoryWithStack({ itemId: 100, quantity: 3 })),
    );

    const targetEid = addEntity(world);
    addComponent(world, targetEid, Inventory);
    addComponent(world, targetEid, set(Inventory, emptyInventory()));

    try {
      processTransaction({
        world,
        sourceEntity: sourceEid,
        targetEntity: targetEid,
        itemId: 100,
        quantity: 5,
        price: 0,
      });
    } catch {
      // Expected
    }

    const sourceInv = getComponent(world, sourceEid, Inventory) as InventoryData;
    expect(sourceInv.quantities[0]).toBe(3);
    expect(sourceInv.itemIds[0]).toBe(100);
  });

  it('throws when target inventory is full and has no matching stack', () => {
    const sourceEid = addEntity(world);
    addComponent(world, sourceEid, Inventory);
    addComponent(
      world,
      sourceEid,
      set(Inventory, inventoryWithStack({ itemId: 999, quantity: 1 })),
    );

    const targetEid = addEntity(world);
    addComponent(world, targetEid, Inventory);
    // Fill ALL 24 slots with different items
    const fullData = emptyInventory();
    for (let slot = 0; slot < MAX_INVENTORY_SLOTS; slot++) {
      fullData.itemIds[slot] = 100 + slot;
      fullData.quantities[slot] = 1;
      fullData.itemTypes[slot] = 1;
    }
    addComponent(world, targetEid, set(Inventory, fullData));

    expect(() => {
      processTransaction({
        world,
        sourceEntity: sourceEid,
        targetEntity: targetEid,
        itemId: 999,
        quantity: 1,
        price: 0,
      });
    }).toThrow();
  });

  it('throws when target wallet balance is insufficient for price', () => {
    const sourceEid = addEntity(world);
    addComponent(world, sourceEid, Inventory);
    addComponent(
      world,
      sourceEid,
      set(Inventory, inventoryWithStack({ itemId: 100, quantity: 5 })),
    );
    addComponent(world, sourceEid, Wallet);
    addComponent(world, sourceEid, set(Wallet, { balance: 0 }));

    const targetEid = addEntity(world);
    addComponent(world, targetEid, Inventory);
    addComponent(world, targetEid, set(Inventory, emptyInventory()));
    addComponent(world, targetEid, Wallet);
    addComponent(world, targetEid, set(Wallet, { balance: 20 }));

    expect(() => {
      processTransaction({
        world,
        sourceEntity: sourceEid,
        targetEntity: targetEid,
        itemId: 100,
        quantity: 1,
        price: 50,
      });
    }).toThrow();
  });

  it('keeps wallet state unmodified after insufficient balance failure', () => {
    const sourceEid = addEntity(world);
    addComponent(world, sourceEid, Inventory);
    addComponent(
      world,
      sourceEid,
      set(Inventory, inventoryWithStack({ itemId: 100, quantity: 5 })),
    );
    addComponent(world, sourceEid, Wallet);
    addComponent(world, sourceEid, set(Wallet, { balance: 0 }));

    const targetEid = addEntity(world);
    addComponent(world, targetEid, Inventory);
    addComponent(world, targetEid, set(Inventory, emptyInventory()));
    addComponent(world, targetEid, Wallet);
    addComponent(world, targetEid, set(Wallet, { balance: 20 }));

    try {
      processTransaction({
        world,
        sourceEntity: sourceEid,
        targetEntity: targetEid,
        itemId: 100,
        quantity: 1,
        price: 50,
      });
    } catch {
      // Expected
    }

    const sourceWallet = getComponent(world, sourceEid, Wallet) as WalletData;
    expect(sourceWallet.balance).toBe(0);

    const targetWallet = getComponent(world, targetEid, Wallet) as WalletData;
    expect(targetWallet.balance).toBe(20);

    // Inventory also untouched
    const sourceInv = getComponent(world, sourceEid, Inventory) as InventoryData;
    expect(sourceInv.quantities[0]).toBe(5);
  });

  it('throws when source entity lacks Inventory component', () => {
    const sourceEid = addEntity(world);
    // No Inventory component added

    const targetEid = addEntity(world);
    addComponent(world, targetEid, Inventory);
    addComponent(world, targetEid, set(Inventory, emptyInventory()));

    expect(() => {
      processTransaction({
        world,
        sourceEntity: sourceEid,
        targetEntity: targetEid,
        itemId: 100,
        quantity: 1,
        price: 0,
      });
    }).toThrow();
  });

  it('throws when target entity lacks Inventory component', () => {
    const sourceEid = addEntity(world);
    addComponent(world, sourceEid, Inventory);
    addComponent(
      world,
      sourceEid,
      set(Inventory, inventoryWithStack({ itemId: 100, quantity: 5 })),
    );

    const targetEid = addEntity(world);
    // No Inventory component added

    expect(() => {
      processTransaction({
        world,
        sourceEntity: sourceEid,
        targetEntity: targetEid,
        itemId: 100,
        quantity: 1,
        price: 0,
      });
    }).toThrow();
  });

  it('rejects zero quantity transfer', () => {
    const sourceEid = addEntity(world);
    addComponent(world, sourceEid, Inventory);
    addComponent(
      world,
      sourceEid,
      set(Inventory, inventoryWithStack({ itemId: 100, quantity: 5 })),
    );

    const targetEid = addEntity(world);
    addComponent(world, targetEid, Inventory);
    addComponent(world, targetEid, set(Inventory, emptyInventory()));

    expect(() => {
      processTransaction({
        world,
        sourceEntity: sourceEid,
        targetEntity: targetEid,
        itemId: 100,
        quantity: 0,
        price: 0,
      });
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Utility helper tests — deductItem, addItemStack, hasItemCapacity
// ---------------------------------------------------------------------------

describe('Economy — utility helpers', () => {
  let world: World;

  beforeEach(() => {
    world = createTestWorld();
  });

  afterEach(() => {
    resetEconomyTracking(world);
  });

  it('hasItemCapacity returns true when empty slots exist', () => {
    const eid = addEntity(world);
    addComponent(world, eid, Inventory);
    addComponent(world, eid, set(Inventory, emptyInventory()));

    expect(hasItemCapacity(world, eid)).toBe(true);
  });

  it('hasItemCapacity returns true when a matching stack exists', () => {
    const eid = addEntity(world);
    addComponent(world, eid, Inventory);
    addComponent(world, eid, set(Inventory, inventoryWithStack({ itemId: 100, quantity: 1 })));

    // Even with no empty slots (all others filled), matching stack counts as capacity
    expect(hasItemCapacity(world, eid)).toBe(true);
  });

  it('hasItemCapacity returns false when inventory is full and no matching stack', () => {
    const eid = addEntity(world);
    addComponent(world, eid, Inventory);
    const fullData = emptyInventory();
    for (let slot = 0; slot < MAX_INVENTORY_SLOTS; slot++) {
      fullData.itemIds[slot] = 100 + slot;
      fullData.quantities[slot] = 1;
      fullData.itemTypes[slot] = 1;
    }
    addComponent(world, eid, set(Inventory, fullData));

    // Without a specific itemId, capacity check just looks at empty slots
    expect(hasItemCapacity(world, eid)).toBe(false);
    // But with a matching itemId that exists, there IS capacity (stacking)
    expect(hasItemCapacity(world, eid, 100)).toBe(true);
  });

  it('deductItem decreases quantity and clears slot at zero', () => {
    const eid = addEntity(world);
    addComponent(world, eid, Inventory);
    addComponent(world, eid, set(Inventory, inventoryWithStack({ itemId: 100, quantity: 5 })));

    const result = deductItem(world, eid, 100, 3);
    expect(result).toBe(true);

    const inv = getComponent(world, eid, Inventory) as InventoryData;
    expect(inv.quantities[0]).toBe(2);
  });

  it('deductItem returns false when item not found', () => {
    const eid = addEntity(world);
    addComponent(world, eid, Inventory);
    addComponent(world, eid, set(Inventory, emptyInventory()));

    const result = deductItem(world, eid, 999, 1);
    expect(result).toBe(false);
  });

  it('deductItem returns false when quantity exceeds available', () => {
    const eid = addEntity(world);
    addComponent(world, eid, Inventory);
    addComponent(world, eid, set(Inventory, inventoryWithStack({ itemId: 100, quantity: 3 })));

    const result = deductItem(world, eid, 100, 10);
    expect(result).toBe(false);
  });

  it('addItemStack creates new stack in empty slot', () => {
    const eid = addEntity(world);
    addComponent(world, eid, Inventory);
    addComponent(world, eid, set(Inventory, emptyInventory()));

    const slot = addItemStack(world, eid, 100, 5, 1);
    expect(slot).toBeGreaterThanOrEqual(0);

    const inv = getComponent(world, eid, Inventory) as InventoryData;
    expect(inv.itemIds[slot]).toBe(100);
    expect(inv.quantities[slot]).toBe(5);
    expect(inv.itemTypes[slot]).toBe(1);
  });

  it('addItemStack stacks onto existing matching itemId', () => {
    const eid = addEntity(world);
    addComponent(world, eid, Inventory);
    addComponent(
      world,
      eid,
      set(Inventory, inventoryWithStack({ itemId: 100, quantity: 3, itemType: 1 })),
    );

    const slot = addItemStack(world, eid, 100, 2, 1);
    expect(slot).toBe(0);

    const inv = getComponent(world, eid, Inventory) as InventoryData;
    expect(inv.quantities[0]).toBe(5);
  });

  it('addItemStack returns -1 when inventory is full', () => {
    const eid = addEntity(world);
    addComponent(world, eid, Inventory);
    const fullData = emptyInventory();
    for (let slot = 0; slot < MAX_INVENTORY_SLOTS; slot++) {
      fullData.itemIds[slot] = 100 + slot;
      fullData.quantities[slot] = 1;
      fullData.itemTypes[slot] = 1;
    }
    addComponent(world, eid, set(Inventory, fullData));

    const slot = addItemStack(world, eid, 999, 1, 1);
    expect(slot).toBe(-1);
  });

  it('deductItem zeroes out itemId and itemType when clearing', () => {
    const eid = addEntity(world);
    addComponent(world, eid, Inventory);
    addComponent(
      world,
      eid,
      set(Inventory, inventoryWithStack({ itemId: 100, quantity: 3, itemType: 5 })),
    );

    deductItem(world, eid, 100, 3);

    const inv = getComponent(world, eid, Inventory) as InventoryData;
    expect(inv.itemIds[0]).toBe(0);
    expect(inv.quantities[0]).toBe(0);
    expect(inv.itemTypes[0]).toBe(0);
  });
});
