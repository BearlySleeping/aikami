## Metadata

| Field | Value |
|---|---|
| **Source** | `RPG Map Transition ECS Design` (Deep Research) |
| **Target** | `packages/frontend/engine/src/systems/zoning_system.ts`, `game_world.ts`, `assets/map_loader.ts` |
| **Priority** | P0 — Eliminates main-thread stalls during transitions and prevents coordinate soft-locks |
| **Dependencies** | C-171 |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Overview

The current map transition logic destroys and instantiates thousands of entities directly within the active game world registry. This causes massive archetype fragmentation and stalls the game loop. Additionally, portals use hardcoded target coordinates which are highly brittle. This contract implements the "Staging World" pattern for background map loading and decoupling spatial coordinates via semantic Spawn Point identifiers.

## Design Reference

Follow the "The Staging World Pattern and Asynchronous Instantiation", "Decoupling Coordinates via Spawn Point Identifiers", and "Halting the ECS Simulation Contextually" sections from the `RPG Map Transition ECS Design` deep research document.

## Architecture Directives

1. **EngineState Singleton**: Create a global singleton entity with an `EngineState` component (values: `Active`, `Transitioning`). Core systems (Physics, Input, AI) must read this and return early (pause) if the state is `Transitioning`.
2. **Staging World Instantiation**: When a portal triggers, the `MapLoader` must NOT operate on the main ECS world. It must instantiate a completely isolated, temporary bitECS world (the Staging World).
3. **Decoupled Spawn Points**: Update the `Transition` (Portal) component to store a `targetMapId` and `targetSpawnId` instead of raw X/Y coordinates. Update the `MapLoader` to extract invisible `SpawnPoint` entities from the Tiled JSON.
4. **Memory Merge**: Once the Staging World finishes parsing the map and caching assets, the engine merges the new entities into the main world, translates the player to the matching `SpawnPoint` coordinate, and safely destroys the old map's hierarchy.

## State & Data Models

```typescript
export enum SimulationState {
    ACTIVE = 0,
    TRANSITIONING = 1
}

export const EngineState = {
    state: new Uint8Array(1) // Singleton, index 0
};

export const Portal = {
    // Hashes of the string IDs (e.g., hash('town_01')) to fit in TypedArrays
    targetMapHash: new Uint32Array(MAX_ENTITIES),
    targetSpawnHash: new Uint32Array(MAX_ENTITIES)
};

export const SpawnPoint = {
    spawnHash: new Uint32Array(MAX_ENTITIES)
};

```

## Scope Boundaries

* **In Scope:** - Implementation of the `EngineState` singleton and pausing core systems.
* Updating `map_loader.ts` to output to a Staging World.
* Refactoring `zoning_system.ts` and `game_world.ts` to execute the merge phase.
* Replacing hardcoded X/Y portal targets with `SpawnPoint` resolution.


* **Out of Scope:** - Generational Indices for dangling pointer protection (reserved for a future contract).
* Saving/loading persistent states like opened chests to a database.



## Acceptance Criteria

### AC-1: Contextual Simulation Halting

**Given** active NPCs moving around the map
**When** the player steps on a portal and triggers a transition
**Then** the `EngineState` becomes `TRANSITIONING`, the fade overlay appears, and all NPC movement/physics completely freeze without dropping the frame rate or stopping the PixiJS Ticker.

**Test Hooks**:

* Integration: Assert that setting `EngineState.state[0] = SimulationState.TRANSITIONING` causes `movement_system` to return early.

### AC-2: Staging World Isolation

**Given** an initiated map transition
**When** the new map is being loaded and parsed
**Then** the entity creation (`addEntity`) and component assignments occur exclusively in a temporary Staging World registry, leaving the active game world entirely unmutated until the merge phase.

**Test Hooks**:

* Integration: Mock `MapLoader` and verify it populates a secondary `IWorld` object, not the primary `game_world`.

### AC-3: Decoupled Coordinate Resolution

**Given** a merged new map
**When** the player's position is resolved
**Then** the engine queries the merged entities for a `SpawnPoint` whose `spawnHash` matches the portal's `targetSpawnHash`, and correctly updates the player's `GridPosition`.

**Test Hooks**:

* Unit: Test that `resolveSpawnPoint(world, targetHash)` returns the correct X/Y coordinates of the matching spawn entity.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Create the `EngineState`, `Portal`, and `SpawnPoint` components. Update your Tiled map JSONs to use string identifiers for spawns instead of raw coordinates, and implement a fast string-hashing function for the TypedArrays.
2. **Phase 2 (Integration)**: Add the early-return `EngineState` check to all your update systems (Movement, Interaction, AI).
3. **Phase 3 (Staging World)**: Rewrite the `game_world` load map pipeline. It should spawn a `createWorld()` staging context, pass it to the map loader, resolve the spawn point, merge the buffers into the main world, and translate the player.
4. **Phase 4 (Validation)**: Run the map transition E2E tests. The transition should be completely seamless and free of stutter.

## Edge Cases & Gotchas

* **String Hashing**: Because bitECS TypedArrays cannot store strings like `"spawn_from_forest"`, you must hash these strings into `Uint32` when parsing the Tiled JSON, and compare the numeric hashes at runtime.
* **Player Entity Protection**: During the merge and destroy phase of the old map, ensure you strictly filter out the Player entity (and global entities like the camera or inventory manager) so they are not accidentally destroyed.
