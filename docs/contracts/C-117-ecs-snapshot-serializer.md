<!-- completed: 2026-06-29 -->
# Contract: C-117 — ECS Snapshot Serializer

| Metadata | Value |
| --- | --- |
| Source | Architect |
| Target | `packages/frontend/engine` |
| Priority | P1 |
| Dependencies | C-114, C-115 |
| Status | completed |
| Version | 1.0.0 |

## Overview
Implement a local serialization and hydration pipeline for the bitECS game world. To support saving and loading the game state efficiently, we must extract the contiguous typed arrays of active entities into a portable snapshot payload, and be able to hydrate a fresh ECS world from that snapshot.

## Design Reference
The hybrid persistence pattern: separate high-frequency memory state (bitECS SoA) from relational cloud state (Data Connect). The ECS state is snapshotted into a dense format locally before any cloud synchronization occurs.

## Architecture Directives
- Create a serialization utility `EcsSerializer` in `packages/frontend/engine/src/serialization/ecs_serializer.ts`.
- The serializer must expose `serializeWorld(world): string` (returning a serialized JSON or base64 string of the packed component data) and `deserializeWorld(world, payload: string): void`.
- Do not serialize every component blindly. Define a strict list of persistent components (e.g., `Position`, `Appearance`, `CombatStats`). Ephemeral components (like `Velocity` or `DirtyGraphics`) should not be saved.
- Only extract array data for *active* entities in the world to keep the payload dense.

## State & Data Models
    // Example conceptual shape of the snapshot
    interface EcsSnapshot {
        version: string;
        timestamp: number;
        entities: number[]; // List of active EIDs
        components: {
            Position: { x: number[], y: number[] };
            Appearance: { textureId: number[] };
        };
    }

## Acceptance Criteria
- **Given** an active bitECS world populated with several entities containing `Position` and `Appearance` data,
- **When** `EcsSerializer.serializeWorld(world)` is called,
- **Then** it returns a non-empty, valid string payload representing the snapshot.
- [Test Hook] `engine/src/__tests__/serializer.test.ts` asserts payload generation.

- **Given** a valid snapshot payload string and a fresh, empty bitECS world,
- **When** `EcsSerializer.deserializeWorld(world, payload)` is called,
- **Then** the fresh world contains the exact same active entities with identical component values for the persistent components.
- [Test Hook] `engine/src/__tests__/serializer.test.ts` asserts hydration restores data accurately.

## Implementation Notes
1. Create `ecs_serializer.ts` and define the `EcsSnapshot` interface.
2. Implement `serializeWorld`:
   - Query all active entities using a broad bitECS query (or iterate known persistent entities).
   - For each persistent component, extract the slice of the typed array corresponding to the active entities.
   - Pack into the `EcsSnapshot` object and `JSON.stringify()`.
3. Implement `deserializeWorld`:
   - Parse the payload string.
   - Clear existing entities in the target world if necessary.
   - Loop through the payload's entity list, recreate them (`addEntity(world)`), and assign the saved component values.
4. Write comprehensive unit tests in `serializer.test.ts` verifying that non-persistent components (like `Velocity`) are safely ignored during hydration.

## Edge Cases & Gotchas
- **Entity ID drift:** In bitECS, Entity IDs (EIDs) are recycled. A restored world must carefully track EID assignment so that relational data (like an inventory item pointing to an owner's EID) doesn't break. For MVP, assume a global reset on load.
- **Buffer sharing:** Do not hold onto the raw bitECS `SharedArrayBuffer` references in the snapshot object. Always read the exact primitive values (or copy slices) to avoid shared memory corruption.
