# Contract C-023: Dense Spatial Hash Implementation

**Status**: In Progress
**Created**: 2026-05-31
**Scope**: `packages/engine`

## Objective

Replace the O(N²) proximity check in `ContextSystem` with a spatial hash grid
that reduces per-tick distance calculations from N entities to the ~9-cell
neighborhood around the player.

## Current State

`context_system.ts` queries ALL entities with `Position + NPCDialog` and runs a
distance check against every one. For N entities this is O(N) per-tick per
context-bearing entity type — acceptable for small N but scales poorly as the
world grows.

## Target State

A `SpatialHashGrid` class using a 3-pass counting sort (Count → Prefix Sum →
Distribute) over a fixed-size `Int32Array` hash table. The grid is populated
each tick with entity positions, and the context system queries only the 3×3
cell neighborhood around the player.

## Implementation Plan

### 1. SpatialHashGrid (`packages/engine/src/math/spatial_hash_grid.ts`)

- **Constructor** `{ cellSize, capacity }` — allocates `Int32Array` for
  `count`, `offset`, and `particleMap`.
- **`populate(positions: Float32Array, entityIds: number[])`** — the 3-pass
  counting sort:
  1. **Count**: for each entity, compute `hash(floor(x/cellSize), floor(y/cellSize))`
     and increment `count[hash]`.
  2. **Prefix Sum**: `offset[0] = 0; offset[i] = offset[i-1] + count[i-1]`.
  3. **Distribute**: copy `offset` to working array, re-hash each entity,
     place eid at `working[hash]++`.
- **`queryNeighborhood(x: number, y: number): number[]`** — iterate the 9
  cells in the 3×3 grid centered on `(x, y)`, collect all entity IDs from
  `particleMap[start..end]`. Uses a module-level pre-allocated result buffer
  to avoid allocations.

### 2. Context System Refactor (`packages/engine/src/systems/context_system.ts`)

- Signature changes to accept a `SpatialHashGrid` reference via options object.
- Remove the `query(world, CONTEXT_QUERY_TERMS)` call.
- Call `spatialGrid.queryNeighborhood(playerPos.x, playerPos.y)` to get
  candidate entity IDs.
- Only run `dx*dx + dy*dy` distance checks against those candidates.

### 3. Worker Integration (`packages/engine/src/worker/ecs_worker.ts`)

- Instantiate `SpatialHashGrid` with `cellSize: 50` during initialization.
- Each tick, before `updateContextSystem()`, populate the grid with entity
  positions via a pre-allocated Float32Array buffer.

### 4. Test Updates (`packages/engine/src/__tests__/context_system.test.ts`)

- Create a `SpatialHashGrid` instance in test setup.
- Populate it with test entities before calling `updateContextSystem`.
- Update call signatures to match the new options-object API.

## Acceptance Criteria

1. `moon run engine:typecheck` passes with zero errors.
2. `moon run engine:test` passes — all existing context system tests pass
   with the spatial hash integration.
3. The context system no longer iterates all entities — it only checks
   candidates returned by the 3×3 neighborhood query.
4. The spatial hash correctly handles entities at the same cell, at cell
   boundaries, and across the 3×3 neighborhood.
