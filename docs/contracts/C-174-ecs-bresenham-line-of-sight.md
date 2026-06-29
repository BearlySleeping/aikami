<!-- completed: 2026-06-29 -->
## Metadata

| Field | Value |
|---|---|
| **Source** | `ECS Grid Spatial Hashing and Collision` (Deep Research) |
| **Target** | `packages/frontend/engine/src/math/bresenham.ts`, `packages/frontend/engine/src/systems/ai_vision_system.ts` |
| **Priority** | P1 — Enables high-performance AI aggro and ranged interactions without raycasting physics overhead |
| **Dependencies** | C-173 |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Overview

Core RPG mechanics like AI aggro detection and ranged combat require rapid Line-of-Sight (LoS) calculations. Generating coordinate arrays for these lines causes severe heap allocations and garbage collection stutter. This contract adapts Bresenham's line algorithm into a pure, allocation-free ECS raycaster that directly interrogates the 1D Spatial Hash Grid cell-by-cell using integer math, terminating early if it hits a blocking bitmask.

## Design Reference

Follow the "Line-of-Sight: Bresenham's Algorithm in a Data-Oriented Context" and "Engineering the ECS-Native Raycaster" sections from the `ECS Grid Spatial Hashing and Collision` deep research document.

## Architecture Directives

1. **Pure Function Raycaster**: Implement `checkLineOfSight` as a pure mathematical utility. It must compute the next coordinate via error accumulation and immediately map it to the `SpatialGrid` index.
2. **Zero Allocation**: The algorithm MUST NOT generate or return an array of `{x, y}` objects. It must return a boolean (`true` if the line is clear, `false` if obstructed).
3. **Bitmask Evaluation**: At each grid cell traversed, traverse the `SpatialLink` intrusive linked list. Compare the target entity's `CollisionData.layer` against the provided `sightMask`. If `(sightMask & targetLayer) !== 0`, the line is blocked.
4. **AI Integration**: Create or update an AI vision/aggro system that utilizes this function to determine if an NPC can physically "see" the player before transitioning from `IDLE` to `CHASE` or triggering a dialogue radius.

## State & Data Models

    // checkLineOfSight signature (Pure Function)
    export const checkLineOfSight = (
        startX: number, 
        startY: number, 
        endX: number, 
        endY: number, 
        sightMask: number, // Bitmask defining what blocks vision (e.g., Walls)
        mapWidth: number, 
        mapHeight: number
    ): boolean;

## Scope Boundaries

- **In Scope:** - Implementation of the zero-allocation Bresenham raycaster.
  - Integration with the `SpatialGrid`, `SpatialLink`, and `CollisionData` arrays established in C-173.
  - Wiring the LoS check into NPC aggro/vision triggers.
- **Out of Scope:** - Fog of war rendering or global lighting calculations.
  - A* pathfinding graph generation.

## Acceptance Criteria

### AC-1: Zero-Allocation LoS Validation
**Given** two coordinates on the grid
**When** `checkLineOfSight` is executed
**Then** it calculates the trajectory using only integer addition/subtraction/bit-shifting, allocates 0 bytes on the heap, and returns `true` if unobstructed.

**Test Hooks**:
- Unit: Run unit tests covering all 8 octants of the Bresenham algorithm (positive/negative slopes, steep/shallow angles) to ensure standard line math is correct.

### AC-2: Mask-Based Occlusion
**Given** an entity between the start and end coordinates
**When** the raycaster evaluates the intermediate cell
**Then** if the entity's layer matches the `sightMask` (e.g., a High Wall), the function immediately returns `false`. If the entity does not match (e.g., Water or a Floor trigger), the ray continues.

**Test Hooks**:
- Unit: Mock a `SpatialGrid` and `CollisionData` arrays. Assert that a ray passing through a `WALL` layer returns `false`, while a ray passing through an `IGNORE_SIGHT` layer returns `true`.

### AC-3: AI Vision Integration
**Given** an active NPC and Player on the map
**When** the Player moves within the NPC's mathematical aggro radius but is positioned behind a solid wall
**Then** the AI vision system evaluates `checkLineOfSight` as `false` and prevents the NPC from triggering combat or dialogue.

**Test Hooks**:
- Integration: E2E or Sandbox test validating that an NPC does not trigger a reaction through solid collision geometry.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Implement `bresenham.ts` containing the `checkLineOfSight` function. Wire it to read from the global `SpatialGrid` and `SpatialLink` arrays exported from the collision system.
2. **Phase 2 (Integration)**: Inject the LoS check into `dialog_trigger_system.ts`, `encounter_system.ts`, or any AI state machines evaluating player proximity.
3. **Phase 3 (Validation)**: Run tests and ensure no heap memory spikes occur during dense AI scanning.

## Edge Cases & Gotchas

- **Grid Boundaries**: Ensure the raycaster includes bounds checking `(currentX < 0 || currentX >= mapWidth)` to prevent out-of-bounds array queries from crashing the thread or reading wrapping memory.
- **Start/End Cell Logic**: Depending on your collision layer setup, ensure the raycaster does not falsely flag the *origin* or *target* entity itself as a blocking obstacle if it matches the mask. You may need to bypass the check on the very first and very last iteration of the loop.
