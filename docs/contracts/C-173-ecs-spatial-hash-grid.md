## Metadata

| Field | Value |
|---|---|
| **Source** | `ECS Grid Spatial Hashing and Collision` (Deep Research) |
| **Target** | `packages/frontend/engine/src/math/spatial_hash_grid.ts`, `systems/movement_system.ts`, `systems/collision_system.ts` |
| **Priority** | P0 — Replaces quadratic collision checks with constant-time memory lookups |
| **Dependencies** | C-172 |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview

The current movement and collision logic relies on sequential checks that do not fully leverage contiguous memory. This contract restructures spatial awareness by introducing a bounded 1D dense array (Spatial Hash Grid) coupled with an Intrusive Linked List to handle multiple entities occupying the same tile. It also separates movement into a two-phase pipeline: intent generation (`MoveIntent`) and intent resolution (`CollisionSystem`).

## Design Reference

Follow the "The Bounded Dense Array Topology", "Intrusive Linked Lists for Cell Overlap", and "The Movement Intent and Resolution Pipeline" sections from the `ECS Grid Spatial Hashing and Collision` deep research document.

## Architecture Directives

1. **The Spatial Grid**: Create a global `Uint32Array` representing the map grid (e.g., `MAP_WIDTH * MAP_HEIGHT`). The index is the flattened 1D coordinate; the value is the `eid` of the first entity in that cell.
2. **Intrusive Linked List**: Implement a `SpatialLink` component to handle tile overlap. If multiple entities share a tile, the `SpatialGrid` holds the head `eid`, and `SpatialLink.next[eid]` points to the subsequent entity.
3. **Move Intent Separation**: Entities no longer modify their own `GridPosition` directly. Input and AI systems write to a `MoveIntent` component. 
4. **Bitmask Collision**: Implement a `CollisionData` component containing `layer` and `mask` integers. The `CollisionSystem` reads `MoveIntent`, checks the target cell in the `SpatialGrid`, traverses the `SpatialLink` list, and resolves collisions using a bitwise `AND` (`&`) operator.

## State & Data Models

```typescript
// Component structures must use strict TypedArrays
export const GridPosition = {
    x: new Int16Array(MAX_ENTITIES),
    y: new Int16Array(MAX_ENTITIES)
};

export const MoveIntent = {
    dx: new Int8Array(MAX_ENTITIES),
    dy: new Int8Array(MAX_ENTITIES)
};

export const SpatialLink = {
    next: new Uint32Array(MAX_ENTITIES),
    prev: new Uint32Array(MAX_ENTITIES)
};

export const CollisionData = {
    layer: new Uint16Array(MAX_ENTITIES), // What this entity IS
    mask: new Uint16Array(MAX_ENTITIES)   // What this entity COLLIDES WITH
};

```

## Scope Boundaries

* **In Scope:** - Implementation of the `SpatialGrid` 1D array.
* Integration of `SpatialLink`, `MoveIntent`, and `CollisionData` components.
* Refactoring `movement_system.ts` and `collision_system.ts` to utilize the intent-resolve-apply pipeline.
* Defining initial bitmask collision layers (e.g., Player, NPC, Wall, Water).


* **Out of Scope:** - Bresenham's Line-of-Sight algorithm (reserved for C-174).
* Pathfinding algorithms (A* navmesh updates).



## Acceptance Criteria

### AC-1: Intrusive Linked List Registration

**Given** two entities spawned on the exact same X/Y grid coordinate
**When** the spatial registration observer processes them
**Then** the `SpatialGrid` at the flattened index holds the `eid` of the newest entity, and `SpatialLink.next[newest_eid]` correctly points to the older entity's `eid`.

**Test Hooks**:

* Unit: Test the `insertIntoSpatialGrid` and `removeFromSpatialGrid` helper functions to ensure pointers correctly stitch together when adding/removing the head or middle nodes.

### AC-2: Intent-Based Movement & Bitmask Resolution

**Given** an entity with `MoveIntent` set towards a cell occupied by a Wall entity
**When** the `CollisionSystem` executes
**Then** the system detects the Wall via the `SpatialGrid`, evaluates the bitwise `AND` against the moving entity's `mask`, detects a collision, zeros out the `MoveIntent` (`dx=0, dy=0`), and prevents the `GridPosition` from mutating.

**Test Hooks**:

* Integration: Run unit tests asserting that an entity with a `mask` ignoring walls successfully moves into the cell, while an entity with a standard collision mask is blocked.

### AC-3: Zero-Allocation Movement Loop

**Given** a continuous game loop with moving entities
**When** profiling the `MovementSystem` and `CollisionSystem`
**Then** no JavaScript array objects, vector objects, or temporary boundary objects are instantiated on the heap. All reads and writes target `Int8Array`, `Int16Array`, `Uint16Array`, and `Uint32Array` directly.

**Test Hooks**:

* Integration: Validate visually via E2E testing that character movement across the tilemap remains perfectly smooth and mathematically constrained to the grid.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Define the new components (`MoveIntent`, `SpatialLink`, `CollisionData`). Establish the global `SpatialGrid` array and write the observer hooks (`onAdd(GridPosition)`, `onRemove(GridPosition)`) to manage the intrusive linked list pointers.
2. **Phase 2 (Integration)**: Refactor `input_system` and AI logic to write to `MoveIntent` rather than `GridPosition`.
3. **Phase 3 (Validation)**: Rewrite `collision_system.ts` to iterate over `MoveIntent`, perform the bitwise mask check against the `SpatialGrid` target, and conditionally apply the translation to `GridPosition`. Run unit/E2E tests to verify grid movement integrity.

## Edge Cases & Gotchas

* **Grid Bounds Validation**: Before querying the `SpatialGrid` array, your `CollisionSystem` MUST ensure the intended `destX` and `destY` are within `0` and `MAP_WIDTH`/`MAP_HEIGHT`. Querying an out-of-bounds index will either return garbage data or crash the typed array mapping.
* **Null Pointers**: Ensure that an empty `SpatialLink.next` or an empty cell in the `SpatialGrid` is represented by `0` (assuming `eid 0` is reserved/null in bitECS).
