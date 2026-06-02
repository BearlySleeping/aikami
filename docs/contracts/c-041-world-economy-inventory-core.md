# Contract: C-040 World Economy Inventory Core
<!-- completed: 2026-06-02 -->

## Metadata
| Source | Target | Priority | Dependencies | Status | Version |
|--------|--------|----------|--------------|--------|---------|
| Engine Architecture | Game Client View | High | C-036, C-040 | completed | 1.0.0 |

## Overview
This contract implements the data layer and transactional bitECS components for the world economy subsystem. It establishes the multi-slot item containment arrays, stack size valuation bounds, and secure value modification passes needed to process inventory transfers, equipment updates, and commodity bartering without garbage collection overhead during engine iterations.

## Design Reference
- `packages/frontend/engine/src/config/memory_config.ts`: Native typed array structure benchmarks.
- `packages/frontend/engine/src/worker/ecs_worker.ts`: Mutation phase pipelines.

## Changes Detail
### New Files

#### `packages/frontend/engine/src/components/inventory.ts`
- Define maximum structural bounds: `MAX_INVENTORY_SLOTS = 24`.
- Declare bitECS components via flat array pointers using types matching BiomeJS standards:
  - `Inventory`: Array matching slot structural maps (`item_id` string index allocations, `quantity` unsigned integers, `item_type` flags).
  - `Wallet`: Float32 allocation tracking global player/NPC currency balances.

#### `packages/frontend/engine/src/systems/economy_system.ts`
- Implement a pure function structural bridge `processTransaction(world, sourceEntity, targetEntity, itemId, quantity, price)` to coordinate inventory balancing.
- Add zero-allocation item filtering helpers: `hasItemCapacity()`, `deductItem()`, `addItemStack()`.
- Inject verification metrics to catch stack overflows or negative value modifications prior to updating the data layers.

## Acceptance Criteria
### AC-1: Zero-Allocation Structural Inventory Transfers
- **Given** an engine context where a source entity holds 5 units of an item slot configuration and a target entity holds 0.
- **When** calling `processTransaction()` to transfer 2 units within a tick cycle.
- **Then** the source quantity pointer must decrement cleanly to 3, the target quantity pointer must increment cleanly to 2, and zero new heap allocations or structural array items can be produced.
- *Test Hook*: Validate array index modifications inside engine test specs.

### AC-2: Boundary Enforcement & Underflow Guard Rails
- **Given** an active transaction execution pathway processing commodity bartering steps.
- **When** a deduction request exceeds available quantity or a wallet balance would fall below zero.
- **Then** the transaction pass must abort instantly, throwing an explicit validation error while keeping the original component state unmodified.
- *Test Hook*: Pass invalid transaction quantities within validation paths to confirm state recovery.

## Implementation Notes
1. Create `packages/frontend/engine/src/components/inventory.ts`.
2. Code transactional logic handlers in `packages/frontend/engine/src/systems/economy_system.ts`.
3. Invoke `validate()` to enforce compliance rules across changed module spaces.
