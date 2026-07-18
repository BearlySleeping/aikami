// packages/frontend/engine/src/systems/interaction_system.test.ts
import { describe, expect, it } from 'bun:test';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, getAllEntities, set } from 'bitecs';
import { Interactable, registerInteractableObservers } from '../components/interactable.ts';
import {
  Inventory,
  MAX_INVENTORY_SLOTS,
  registerInventoryObservers,
} from '../components/inventory.ts';
import { Position, registerPositionObservers } from '../components/position.ts';
import { MockEngineBridge } from '../engine_bridge.ts';
import { handleInteract } from './interaction_system.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sets up a fresh bitECS world with all observers registered
 * and creates a player entity with Position + Inventory.
 */
const setupTestWorld = (): {
  world: World;
  playerEid: number;
  bridge: MockEngineBridge;
} => {
  const world = createWorld();

  registerPositionObservers(world);
  registerInventoryObservers(world);
  registerInteractableObservers(world);

  // Create player with Position + empty Inventory
  const playerEid = addEntity(world);
  addComponent(world, playerEid, Position);
  addComponent(world, playerEid, set(Position, { x: 100, y: 100 }));

  addComponent(world, playerEid, Inventory);
  addComponent(
    world,
    playerEid,
    set(Inventory, {
      itemIds: new Array(MAX_INVENTORY_SLOTS).fill(0),
      quantities: new Array(MAX_INVENTORY_SLOTS).fill(0),
      itemTypes: new Array(MAX_INVENTORY_SLOTS).fill(0),
    }),
  );

  const bridge = new MockEngineBridge();

  return { world, playerEid, bridge };
};

/**
 * Creates an item entity at the given position with Interactable data.
 */
const createItemEntity = (
  world: World,
  options: { x: number; y: number; itemId: string; quantity: number },
): number => {
  const eid = addEntity(world);
  addComponent(world, eid, Position);
  addComponent(world, eid, set(Position, { x: options.x, y: options.y }));

  addComponent(world, eid, Interactable);
  addComponent(
    world,
    eid,
    set(Interactable, {
      type: 'item',
      itemId: options.itemId,
      quantity: options.quantity,
    }),
  );

  return eid;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Interaction System — Item Pickup', () => {
  it('adds item to player inventory when within range', () => {
    const { world, playerEid, bridge } = setupTestWorld();

    // Place item within interaction radius (50px)
    createItemEntity(world, {
      x: 120,
      y: 100,
      itemId: 'healthPotion',
      quantity: 1,
    });

    handleInteract({ world, playerEntityId: playerEid, bridge });

    // Verify inventory gained the item
    const playerItemIds = Inventory.itemIds[playerEid] ?? [];
    const playerQuantities = Inventory.quantities[playerEid] ?? [];

    const slot0Id = playerItemIds[0] ?? 0;
    const slot0Qty = playerQuantities[0] ?? 0;

    expect(slot0Id).toBe(1); // 1 = filled
    expect(slot0Qty).toBe(1);
  });

  it('destroys item entity after pickup', () => {
    const { world, playerEid, bridge } = setupTestWorld();

    const itemEid = createItemEntity(world, {
      x: 100,
      y: 110,
      itemId: 'sword',
      quantity: 1,
    });

    const entityCountBefore = getAllEntities(world).length;

    handleInteract({ world, playerEntityId: playerEid, bridge });

    const entityCountAfter = getAllEntities(world).length;

    // One entity should be gone (the item), and player inventory gained
    expect(entityCountAfter).toBe(entityCountBefore - 1);

    // Verify item entity no longer exists
    const allEids = getAllEntities(world);
    expect(allEids.includes(itemEid)).toBe(false);
  });

  it('does not pick up items outside interaction radius', () => {
    const { world, playerEid, bridge } = setupTestWorld();

    // Place item far away (200px, far beyond 50px radius)
    createItemEntity(world, {
      x: 500,
      y: 500,
      itemId: 'far_item',
      quantity: 1,
    });

    const entityCountBefore = getAllEntities(world).length;

    handleInteract({ world, playerEntityId: playerEid, bridge });

    const entityCountAfter = getAllEntities(world).length;

    // All entities should remain (item untouched)
    expect(entityCountAfter).toBe(entityCountBefore);

    // Inventory should still be empty
    const playerItemIds = Inventory.itemIds[playerEid] ?? [];
    expect(playerItemIds[0] ?? 0).toBe(0);
  });

  it('stacks items into first empty slot', () => {
    const { world, playerEid, bridge } = setupTestWorld();

    // Pre-fill slot 0
    const playerItemIds = Inventory.itemIds[playerEid] ?? [];
    const playerQuantities = Inventory.quantities[playerEid] ?? [];
    playerItemIds[0] = 1; // filled
    playerQuantities[0] = 5;

    // Place item nearby
    createItemEntity(world, {
      x: 105,
      y: 100,
      itemId: 'potion',
      quantity: 3,
    });

    handleInteract({ world, playerEntityId: playerEid, bridge });

    // Slot 0 should still have quantity 5 (unchanged)
    expect(playerQuantities[0]).toBe(5);

    // Item should go into slot 1
    expect(playerItemIds[1] ?? 0).toBe(1);
    expect(playerQuantities[1] ?? 0).toBe(3);
  });

  it('does nothing when inventory is full', () => {
    const { world, playerEid, bridge } = setupTestWorld();

    // Fill all inventory slots
    const playerItemIds = Inventory.itemIds[playerEid] ?? [];
    for (let slot = 0; slot < MAX_INVENTORY_SLOTS; slot++) {
      playerItemIds[slot] = 1; // filled
    }

    createItemEntity(world, {
      x: 100,
      y: 100,
      itemId: 'overflow_item',
      quantity: 1,
    });

    const entityCountBefore = getAllEntities(world).length;

    handleInteract({ world, playerEntityId: playerEid, bridge });

    const entityCountAfter = getAllEntities(world).length;

    // Item entity should still exist (not picked up)
    expect(entityCountAfter).toBe(entityCountBefore);
  });

  it('emits ITEM_PICKED_UP delta event (C-331)', () => {
    const { world, playerEid } = setupTestWorld();
    const bridge = new MockEngineBridge();

    let receivedItemId: string | undefined;
    let receivedQuantity: number | undefined;

    bridge.on('ITEM_PICKED_UP', (event) => {
      receivedItemId = event.itemId;
      receivedQuantity = event.quantity;
    });

    createItemEntity(world, {
      x: 100,
      y: 100,
      itemId: 'manaPotion',
      quantity: 5,
    });

    handleInteract({ world, playerEntityId: playerEid, bridge });

    expect(receivedItemId).toBe('manaPotion');
    expect(receivedQuantity).toBe(5);
  });

  it('does nothing when no interactable entities exist', () => {
    const { world, playerEid, bridge } = setupTestWorld();

    const entityCountBefore = getAllEntities(world).length;

    handleInteract({ world, playerEntityId: playerEid, bridge });

    const entityCountAfter = getAllEntities(world).length;

    // Nothing changed
    expect(entityCountAfter).toBe(entityCountBefore);
  });

  it('does nothing when player has no position', () => {
    const world = createWorld();
    registerPositionObservers(world);
    registerInventoryObservers(world);
    registerInteractableObservers(world);

    const playerEid = addEntity(world);
    // Player has no Position component
    addComponent(world, playerEid, Inventory);

    const bridge = new MockEngineBridge();

    createItemEntity(world, {
      x: 100,
      y: 100,
      itemId: 'sword',
      quantity: 1,
    });

    // Should not throw
    handleInteract({ world, playerEntityId: playerEid, bridge });
  });
});

describe('Interaction System — Edge Cases', () => {
  it('picks up closest item when multiple items are in range', () => {
    const { world, playerEid, bridge } = setupTestWorld();

    // Place two items — one close, one farther
    createItemEntity(world, {
      x: 100,
      y: 100, // Distance 0 — right on top
      itemId: 'close_item',
      quantity: 1,
    });

    createItemEntity(world, {
      x: 130,
      y: 100, // Distance 30 — still in range
      itemId: 'far_item',
      quantity: 2,
    });

    handleInteract({ world, playerEntityId: playerEid, bridge });

    // Only the closest item should be picked up
    const playerItemIds = Inventory.itemIds[playerEid] ?? [];
    const slot0Id = playerItemIds[0] ?? 0;

    // Item was picked up (slot filled)
    expect(slot0Id).toBe(1);

    // Only 2 entities remain: player + far_item
    expect(getAllEntities(world).length).toBe(2);

    // Second interact picks up the far item
    handleInteract({ world, playerEntityId: playerEid, bridge });
    expect(getAllEntities(world).length).toBe(1); // only player
  });
});
