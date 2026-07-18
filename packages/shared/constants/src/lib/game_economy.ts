// packages/shared/constants/src/lib/game_economy.ts
//
// Shared economy constants — single source of truth for inventory capacity
// and vendor pricing rules used by both the game engine (ECS) and the
// client services.
//
// Contract: C-331 Integrate Inventory, Equipment, Loot, and Vendor

/** Maximum number of distinct item stacks an inventory can hold. */
export const MAX_INVENTORY_SLOTS = 24;

/** Fixed sell-back ratio applied to an item's base price (floor rounding). */
export const VENDOR_SELL_RATIO = 0.5;

/** Fallback base price for items without an authored basePrice. */
export const DEFAULT_VENDOR_BASE_PRICE = 10;
