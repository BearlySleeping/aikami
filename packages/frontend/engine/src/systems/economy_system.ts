// packages/frontend/engine/src/systems/economy_system.ts
import type { World } from 'bitecs';
import { getComponent } from 'bitecs';
import type { InventoryData } from '../components/inventory.ts';
import { Inventory, MAX_INVENTORY_SLOTS, Wallet } from '../components/inventory.ts';

// ---------------------------------------------------------------------------
// EconomySystem — zero-allocation inventory transaction pipeline
//
// Contract C-041: All item transfers, wallet balance adjustments, and
// inventory mutations operate directly on bitECS SoA arrays. No heap
// allocations occur during transaction processing — every read and write
// is a direct array index access.
// ---------------------------------------------------------------------------

/**
 * Options for the {@link processTransaction} function.
 */
type ProcessTransactionOptions = {
  /** The bitECS world. */
  world: World;
  /** Entity ID of the item source. */
  sourceEntity: number;
  /** Entity ID of the item recipient. */
  targetEntity: number;
  /** Numeric item identifier to transfer. */
  itemId: number;
  /** Number of units to transfer (must be > 0). */
  quantity: number;
  /** Currency amount transferred from target to source. 0 = free transfer. */
  price: number;
};

/**
 * Executes a zero-allocation item and currency transfer between two entities.
 *
 * 1. Validates both entities have the {@link Inventory} component.
 * 2. Finds the item stack on the source, verifies sufficient quantity.
 * 3. Checks target capacity (empty slot or matching stack).
 * 4. If price > 0, validates both entities have {@link Wallet} and the
 *    target has sufficient balance.
 * 5. Mutates source and target inventory arrays directly (no allocations).
 * 6. Mutates wallet balances if price is non-zero.
 *
 * On any validation failure, throws a descriptive error. Component state
 * is NOT partially mutated — validation gates are checked before any
 * writes occur.
 *
 * @param options - The transaction parameters.
 * @throws If source lacks the item, quantity is invalid, target is full,
 *   or wallet balance is insufficient.
 */
const processTransaction = (options: ProcessTransactionOptions): void => {
  const { world, sourceEntity, targetEntity, itemId, quantity, price } = options;

  if (quantity <= 0) {
    throw new Error(`[EconomySystem] Invalid quantity: ${quantity} — must be positive`);
  }

  // --- Validate source ---------------------------------------------------

  const sourceInv = getComponent(world, sourceEntity, Inventory) as InventoryData | undefined;
  if (!sourceInv) {
    throw new Error(`[EconomySystem] Source entity ${sourceEntity} has no Inventory component`);
  }

  const sourceSlot = _findItemSlot(sourceInv, itemId);
  if (sourceSlot === -1) {
    throw new Error(`[EconomySystem] Source entity ${sourceEntity} does not have item ${itemId}`);
  }

  const sourceAvailable = sourceInv.quantities[sourceSlot];
  if (sourceAvailable < quantity) {
    throw new Error(
      `[EconomySystem] Insufficient quantity: requested ${quantity}, available ${sourceAvailable} of item ${itemId}`,
    );
  }

  // --- Validate target ---------------------------------------------------

  const targetInv = getComponent(world, targetEntity, Inventory) as InventoryData | undefined;
  if (!targetInv) {
    throw new Error(`[EconomySystem] Target entity ${targetEntity} has no Inventory component`);
  }

  const targetSlot = _findOrCreateTargetSlot(targetInv, itemId);
  if (targetSlot === -1) {
    throw new Error(
      `[EconomySystem] Target entity ${targetEntity} inventory is full (${MAX_INVENTORY_SLOTS} slots)`,
    );
  }

  // --- Validate wallet (only when price is non-zero) ---------------------

  if (price > 0) {
    if (Wallet.balance[sourceEntity] === undefined) {
      throw new Error(
        `[EconomySystem] Source entity ${sourceEntity} has no Wallet component (price=${price})`,
      );
    }

    if (Wallet.balance[targetEntity] === undefined) {
      throw new Error(
        `[EconomySystem] Target entity ${targetEntity} has no Wallet component (price=${price})`,
      );
    }

    if (Wallet.balance[targetEntity] < price) {
      throw new Error(
        `[EconomySystem] Insufficient funds: target has ${Wallet.balance[targetEntity]}, price is ${price}`,
      );
    }
  }

  // --- All validations passed — execute the transfer ---------------------
  // Zero-allocation from this point: direct array index mutations only.

  // Deduct from source
  sourceInv.quantities[sourceSlot] -= quantity;
  if (sourceInv.quantities[sourceSlot] === 0) {
    sourceInv.itemIds[sourceSlot] = 0;
    sourceInv.itemTypes[sourceSlot] = 0;
  }

  // Add to target
  const isNewStack = targetInv.itemIds[targetSlot] === 0;
  if (isNewStack) {
    targetInv.itemIds[targetSlot] = itemId;
    targetInv.itemTypes[targetSlot] = sourceInv.itemTypes[sourceSlot] || 1;
  }
  targetInv.quantities[targetSlot] += quantity;

  // Transfer currency — write directly to SoA array to avoid
  // snapshot object mutation issues from getComponent.
  if (price > 0) {
    Wallet.balance[sourceEntity] = (Wallet.balance[sourceEntity] ?? 0) + price;
    Wallet.balance[targetEntity] -= price;
  }
};

// ---------------------------------------------------------------------------
// Utility helpers — also zero-allocation
// ---------------------------------------------------------------------------

/**
 * Checks whether an entity has inventory capacity for a given item.
 *
 * Capacity exists if either:
 * - There is at least one empty slot (itemId === 0), OR
 * - A matching itemId stack already exists (stacking is unlimited per slot).
 *
 * @param world - The bitECS world.
 * @param eid - The entity ID to check.
 * @param itemId - Optional item ID to check for stacking capacity.
 * @returns `true` if the entity can accept at least one more item unit.
 */
const hasItemCapacity = (world: World, eid: number, itemId?: number): boolean => {
  const inv = getComponent(world, eid, Inventory) as InventoryData | undefined;
  if (!inv) {
    return false;
  }

  if (itemId !== undefined && _findItemSlot(inv, itemId) !== -1) {
    return true; // Can stack onto existing matching item
  }

  return _findEmptySlot(inv) !== -1;
};

/**
 * Deducts a quantity from an entity's item stack.
 *
 * Operates directly on the entity's inventory arrays — zero allocations.
 * When the quantity reaches zero, the slot is cleared (itemId=0, itemType=0).
 *
 * @param world - The bitECS world.
 * @param eid - The entity ID.
 * @param itemId - The item ID to deduct.
 * @param quantity - The amount to remove (must be <= available).
 * @returns `true` if the deduction succeeded, `false` if the item was not
 *   found or quantity was insufficient.
 */
const deductItem = (world: World, eid: number, itemId: number, quantity: number): boolean => {
  const inv = getComponent(world, eid, Inventory) as InventoryData | undefined;
  if (!inv) {
    return false;
  }

  const slot = _findItemSlot(inv, itemId);
  if (slot === -1) {
    return false;
  }

  if (inv.quantities[slot] < quantity) {
    return false;
  }

  inv.quantities[slot] -= quantity;
  if (inv.quantities[slot] === 0) {
    inv.itemIds[slot] = 0;
    inv.itemTypes[slot] = 0;
  }

  return true;
};

/**
 * Adds an item stack to an entity's inventory.
 *
 * If a matching itemId already exists in a slot, the quantity is added
 * to the existing stack. Otherwise, the first empty slot is used.
 *
 * Operates directly on inventory arrays — zero allocations.
 *
 * @param world - The bitECS world.
 * @param eid - The entity ID.
 * @param itemId - The item ID to add.
 * @param quantity - The amount to add (must be > 0).
 * @param itemType - The item type flag.
 * @returns The slot index where the item was added, or -1 if inventory
 *   is full with no matching stack.
 */
const addItemStack = (
  world: World,
  eid: number,
  itemId: number,
  quantity: number,
  itemType: number,
): number => {
  const inv = getComponent(world, eid, Inventory) as InventoryData | undefined;
  if (!inv) {
    return -1;
  }

  const slot = _findOrCreateTargetSlot(inv, itemId);
  if (slot === -1) {
    return -1;
  }

  if (inv.itemIds[slot] === 0) {
    inv.itemIds[slot] = itemId;
    inv.itemTypes[slot] = itemType;
  }

  inv.quantities[slot] += quantity;
  return slot;
};

// ---------------------------------------------------------------------------
// Internal slot search helpers (zero-allocation, pure array traversal)
// ---------------------------------------------------------------------------

/**
 * Finds the slot index for a given item ID.
 *
 * @param inv - The inventory data (direct array reference).
 * @param itemId - The item ID to search for.
 * @returns The slot index, or -1 if not found.
 */
const _findItemSlot = (inv: InventoryData, itemId: number): number => {
  const { itemIds } = inv;
  for (let slot = 0; slot < MAX_INVENTORY_SLOTS; slot++) {
    if (itemIds[slot] === itemId) {
      return slot;
    }
  }
  return -1;
};

/**
 * Finds a target slot for item placement.
 *
 * Prefers an existing matching itemId stack (for stacking). Falls back
 * to the first empty slot.
 *
 * @param inv - The inventory data (direct array reference).
 * @param itemId - The item ID to place.
 * @returns The target slot index, or -1 if inventory is full.
 */
const _findOrCreateTargetSlot = (inv: InventoryData, itemId: number): number => {
  const { itemIds } = inv;
  let emptySlot = -1;

  for (let slot = 0; slot < MAX_INVENTORY_SLOTS; slot++) {
    if (itemIds[slot] === itemId) {
      return slot; // Stack onto existing
    }
    if (itemIds[slot] === 0 && emptySlot === -1) {
      emptySlot = slot;
    }
  }

  return emptySlot;
};

/**
 * Finds the first empty slot in the inventory.
 *
 * @param inv - The inventory data (direct array reference).
 * @returns The slot index, or -1 if inventory is full.
 */
const _findEmptySlot = (inv: InventoryData): number => {
  const { itemIds } = inv;
  for (let slot = 0; slot < MAX_INVENTORY_SLOTS; slot++) {
    if (itemIds[slot] === 0) {
      return slot;
    }
  }
  return -1;
};

// ---------------------------------------------------------------------------
// Per-world tracking teardown
// ---------------------------------------------------------------------------

/**
 * Clears any per-world economy tracking state.
 *
 * Currently a no-op — the economy system has no persistent module-level
 * state beyond the bitECS component arrays. Exported for API symmetry with
 * other system teardown functions.
 *
 * @param _world - The bitECS world (unused, reserved for future use).
 */
const resetEconomyTracking = (_world: World): void => {
  // No persistent state to clear — economy system operates directly on
  // bitECS component SoA arrays with zero internal caches.
};

export { addItemStack, deductItem, hasItemCapacity, processTransaction, resetEconomyTracking };
