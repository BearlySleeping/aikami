## Metadata

| Field | Value |
|---|---|
| **Source** | Zero-Allocation String Registry Optimization Research — Milestone 6 |
| **Target** | `packages/frontend/engine/src/services/string_registry_service.ts` |
| **Priority** | P0 — Essential boundary layer to eliminate heap allocation tracking from active engine loops. |
| **Dependencies** | `docs/contracts/C-194-ecs-offscreen-macro-simulation.md` |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview

This contract strips structural string allocations out of the bitECS component pipeline to guarantee zero-allocation loop tracking. JavaScript heap strings disrupt JIT compiler assumptions and generate memory spikes during continuous simulation iterations. 

We are introducing a centralized, unproxied integer-to-string lookup registry inside the Web Worker. Components will store purely sequential uint32 numeric handles that map back to memory records. This registry interfaces directly with the local desktop Turso (libsql) persistence engine and synchronizes asynchronously with remote data schemas via Firebase SQL Connect live update hooks.

## Design Reference

Follow the data-oriented rules established in:
- `Zero-Allocation String Registry Optimization` architectural findings.
- `packages/frontend/engine/src/config/memory_config.ts` for capacity mappings.

All string resolution must happen downstream from system ticks, ensuring the execution thread handles only flat binary vectors during game frame lookups.

## Architecture Directives

1. **Flat Handle Allocation**: Map strings to a sequential uint32 index tracking space. Once a text profile is registered, its lookup key remains immutable for the lifecycle of the execution instance.
2. **Unproxied Dictionary Map**: Store the lookup backing tables inside a raw JavaScript `Map<number, string>` object inside the worker thread. Completely isolate this structure from Svelte 5 reactive proxy bindings.
3. **Turso Persistence Hydration**: Build direct mapping wrappers that ingest row queries from the local Turso SQLite store and write sequentially indexed keys into the bitECS components during startup boots.
4. **Firebase SQL Connect Hooking**: Wire asynchronous synchronization events into Firebase SQL Connect live data handlers, updating local records cleanly without stalling active physics operations.

## State & Data Models

Conceptual interfaces for registry mapping and component definitions. Code blocks use 4-space indentation with NO backticks.

    // Flat numeric index definitions
    type RegistryHandle = number; // Raw uint32 key

    // bitECS binary structure definitions
    interface TextIdentityComponent {
        nameHandle: Uint32Array;        // Maps to the string registry key index
        dialogueScriptHandle: Uint32Array; // Maps to active conversation blocks
    }

    // Local unproxied worker memory registry cache
    type WorkerRegistryCache = Map<RegistryHandle, string>;

## Scope Boundaries

- **In Scope**:
    - Centralized `StringRegistryService` tracking numeric-to-string handles inside worker memory.
    - bitECS component schema updates converting old string stubs into flat uint32 views.
    - Local storage loading bridges reading from Turso relational rows into the engine map.
    - Asynchronous data syncing channels wiring Firebase SQL Connect delta lines.
- **Out of Scope**:
    - High-frequency spatial grid culling arrays (completed under C-194).
    - Client-side partial stream chunk token repairs (completed under C-193).

## Acceptance Criteria

### AC-1: Zero-Allocation String Tokenization
**Given** A continuous simulation track generating identity updates for 10,000 distinct actors
**When** Querying name details or textual labels inside the core system loops
**Then** Components map properties purely using flat uint32 integer values, triggering zero heap garbage collection or allocation operations on the hot path.

### AC-2: Turso Data Local Hydration
**Given** A fresh game boot sequence accessing an offline desktop save state profile
**When** Ingesting row records from the local Turso SQLite database container
**Then** Text properties are assigned sequential handle indices, populating the engine's unproxied binary structures instantly.

### AC-3: Firebase SQL Connect Synced Updates
**Given** An active network state where remote administrators modify NPC descriptive variables
**When** Firebase SQL Connect streams real-time data modification parameters down to the client browser
**Then** Delta keys pass into the worker registry without generating thread contention lockouts or disrupting current multi-threaded frame ticks.

**Test Hooks**:
- Moon Task: `moon frontend-engine:test`
- Integration: Run memory layout validation scripts to confirm zero HeapNumber allocations occur during text handle translations.
- E2E / Visual:
    - **Functional**: Unit testing profiles written inside `packages/frontend/engine/src/__tests__/string_registry.test.ts`. Full lifecycle database sync checks running in `apps/e2e/tests/game/registry_hydration.spec.ts`.
    - **Visual**: N/A (Pure data-oriented translation mechanism executing inside deep unproxied memory blocks).

## Watch Points

- **Handle Collision Vectors**: Ensure the handle sequence generator increments atomically. Reusing a uint32 handle reference across separate text items will cause name corruptions across entities.
- **Proxy Identity Hazard Rules**: Never send the internal `Map` object up into raw Svelte templates. The front-end view must query details strictly via primitive copies or copy strings using the ViewModel projection layer.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Build out the centralized `StringRegistryService` and the tracking components inside `packages/frontend/engine/src/services/`.
2. **Phase 2 (Integration)**: Connect hydration hooks to handle Turso rows and hook up the live synchronization pathways for Firebase SQL Connect streams.
3. **Phase 3 (Validation)**: Run `validate()`, profile heap allocation baselines under heavy stress limits, and verify all engine specs clear cleanly.
