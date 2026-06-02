// packages/frontend/engine/src/components/inventory.ts
import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// Inventory — multi-slot item containment component
//
// Contract C-041: Each entity carries up to MAX_INVENTORY_SLOTS item stacks.
// Flat array pointers store item_id (numeric reference), quantity (unsigned
// integer), and item_type (flag) per slot. Zero-allocation access via direct
// array index mutation — no intermediate object construction during reads or
// writes.
// ---------------------------------------------------------------------------

/** Maximum number of item stacks an entity can carry. */
export const MAX_INVENTORY_SLOTS = 24;

/**
 * SoA storage for per-entity inventory slots.
 *
 * Access pattern: `Inventory.itemIds[eid]` returns a `number[]` of length
 * {@link MAX_INVENTORY_SLOTS}. Slot 0 means empty. Quantities are unsigned
 * integers — negative values are never written.
 */
export const Inventory = {
  itemIds: [] as number[][],
  quantities: [] as number[][],
  itemTypes: [] as number[][],
};

/** Payload shape for set/get observer hooks. */
export type InventoryData = {
  itemIds: number[];
  quantities: number[];
  itemTypes: number[];
};

/**
 * Registers onSet and onGet observers for the Inventory component.
 *
 * The onSet handler clones the incoming arrays to prevent external mutation
 * of internal slot state. The onGet handler returns direct references —
 * callers must treat returned arrays as read-only unless they re-set via
 * {@link addComponent} + {@link set}.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerInventoryObservers = (world: World): void => {
  observe(world, onSet(Inventory), (eid: number, params: InventoryData) => {
    Inventory.itemIds[eid] = [...params.itemIds];
    Inventory.quantities[eid] = [...params.quantities];
    Inventory.itemTypes[eid] = [...params.itemTypes];
  });

  observe(
    world,
    onGet(Inventory),
    (eid: number): InventoryData => ({
      itemIds: Inventory.itemIds[eid],
      quantities: Inventory.quantities[eid],
      itemTypes: Inventory.itemTypes[eid],
    }),
  );
};

// ---------------------------------------------------------------------------
// Wallet — currency balance component
// ---------------------------------------------------------------------------

/** SoA storage for per-entity currency balances. */
export const Wallet = {
  balance: [] as number[],
};

/** Payload shape for wallet balance. */
export type WalletData = {
  balance: number;
};

/**
 * Registers onSet and onGet observers for the Wallet component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerWalletObservers = (world: World): void => {
  observe(world, onSet(Wallet), (eid: number, params: WalletData) => {
    Wallet.balance[eid] = params.balance;
  });

  observe(
    world,
    onGet(Wallet),
    (eid: number): WalletData => ({
      balance: Wallet.balance[eid],
    }),
  );
};
