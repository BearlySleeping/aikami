## Metadata

| Field                | Value                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Source**           | `RPG Map Transition ECS Design` (Deep Research)                                                                    |
| **Target**           | `packages/frontend/engine/src/core/entity_reference.ts`, `systems/combat_system.ts`, `systems/ai_vision_system.ts` |
| **Priority**         | P1 — Prevents fatal ABA memory corruption and dangling pointers during mass map unloading                          |
| **Dependencies**     | C-172                                                                                                              |
| **Status**           | not_started                                                                                                        |
| **Contract version** | 1.0.0                                                                                                              |

## Overview

During map transitions, the engine destroys thousands of entities, and bitECS recycles their integer IDs. If an active system (like a delayed projectile or an aggroed NPC) holds a reference to a recycled ID, it will corrupt the newly spawned entity (the ABA problem). This contract implements "Generational Indices", wrapping the 32-bit entity ID and a 32-bit generation counter into a 64-bit safe reference, allowing the engine to mathematically prove if an entity has been destroyed and replaced.

## Design Reference

Follow the "Mitigating Dangling Pointers with Generational Indices" section from the `RPG Map Transition ECS Design` deep research document.

## Architecture Directives

1. **Generation Tracking**: Create a new bitECS component or a standalone `Uint32Array` called `EntityGeneration` that tracks the current generation of every possible `eid` index.
2. **Lifecycle Interception**: Hook into the entity destruction pipeline. When an entity is destroyed (e.g., during map unload or death), increment its index in the `EntityGeneration` array by 1.
3. **Reference Packing**: Create a pure utility function `createSafeRef(eid)` that packs the current `eid` and its current `generation` into a 64-bit float (JavaScript `number`), relying on standard math (e.g., `(generation * MAX_ENTITIES) + eid` or `Float64Array` bitwise packing).
4. **Reference Resolution**: Create a utility `resolveSafeRef(ref)` that unpacks the reference, checks the generation against the live `EntityGeneration` array, and returns the `eid` if they match, or `0` (null) if the generation has incremented (meaning the entity died).
5. **System Migration**: Any system or component that currently stores another entity's ID (like a `targetEid` for combat, homing missiles, or AI aggro) must be migrated to store and resolve this 64-bit safe reference instead.

## State & Data Models

```typescript
// Component to track generations globally
export const EntityGeneration = {
	// Increments every time this specific EID slot is destroyed and recycled
	current: new Uint32Array(MAX_ENTITIES),
};

// Target or memory components should use Float64Array to hold the large packed number
export const CombatTarget = {
	safeRef: new Float64Array(MAX_ENTITIES),
};
```

## Scope Boundaries

- **In Scope:** - Creating the `EntityGeneration` tracking array.
- Adding the increment logic to the entity despawn/unload pipeline.
- Creating `createSafeRef()` and `resolveSafeRef()` mathematical utilities.
- Refactoring any existing target-tracking components to use `Float64Array` and safe refs.

- **Out of Scope:** - GPU tile animation (reserved for C-177).
- Modifying the visual or collision systems (which don't store long-term delayed references).

## Acceptance Criteria

### AC-1: Generation Increment on Destruction

**Given** an active entity with `eid = 42` and `generation = 1`
**When** the entity is destroyed via the ECS engine
**Then** the `EntityGeneration.current[42]` is strictly incremented to `2`.

**Test Hooks**:

- Unit: Create an entity, check its generation, destroy it, and assert the generation array was incremented.

### AC-2: Safe Reference Resolution (Valid)

**Given** a live entity and a generated safe reference
**When** `resolveSafeRef(ref)` is called
**Then** it successfully extracts and returns the correct `eid`.

**Test Hooks**:

- Unit: Pack and unpack references mathematically and verify `resolveSafeRef` returns the exact `eid`.

### AC-3: ABA Rejection (Invalid)

**Given** an NPC holding a safe reference to a Player entity
**When** the Player entity is destroyed, the `eid` is recycled for a Tree entity, and the NPC attempts to `resolveSafeRef()`
**Then** the resolver detects a generation mismatch and returns `0` (or null), preventing the NPC from attacking the Tree.

**Test Hooks**:

- Integration: Simulate the ABA problem. Create Entity A, create a safe ref. Destroy Entity A. Create Entity B (which reuses Entity A's ID). Assert `resolveSafeRef` using the old reference returns `0`.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Implement `core/entity_reference.ts` with the `EntityGeneration` array and the math utilities for packing/unpacking the 64-bit reference.
2. **Phase 2 (Lifecycle)**: Inject the generation increment logic into the central area where your engine calls `removeEntity(world, eid)` (likely inside your ECS worker or `game_world.ts` clear functions).
3. **Phase 3 (Integration)**: Audit your existing components (`targetResolver`, AI memory, etc.). Change any `targetEid: Uint32Array` to `targetSafeRef: Float64Array` and wrap the reads/writes in the new utilities.

## Edge Cases & Gotchas

- **Bitwise Limitations in JS**: Standard JavaScript bitwise operators (`<<`, `>>`, `&`, `|`) cast numbers to **32-bit signed integers**. You cannot use them to pack a 64-bit number unless you use `BigInt`. It is vastly faster and easier to use safe integer math since JS `number` (Float64) can safely represent integers up to `9,007,199,254,740,991`.
- _Example pack_: `ref = (generation * 4294967296) + eid;`
- _Example unpack_: `eid = ref % 4294967296; generation = Math.floor(ref / 4294967296);`
