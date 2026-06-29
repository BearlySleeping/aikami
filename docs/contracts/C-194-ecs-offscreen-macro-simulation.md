## Metadata

| Field | Value |
|---|---|
| **Source** | Emergent World Overhaul Master Blueprint — Section 2 |
| **Target** | `packages/frontend/engine/src/systems/macro_simulation_system.ts` |
| **Priority** | P0 — Core multi-zone map lifecycle required to maintain schedule integrity across inactive sectors. |
| **Dependencies** | `docs/contracts/C-192-ecs-time-sliced-jps-pathfinder.md`, `docs/contracts/C-193-client-tool-streaming-orchestrator.md` |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview

This contract implements the two-tiered active/inactive simulation layer inside the bitECS Web Worker. Running real-time physics, geometric sight cones, and pathfinding frontiers for every character in every unloaded zone would quickly saturate thread budgets. 

To solve this, we are establishing a macro-simulation framework. Entities located in the player's active zone execute high-fidelity, per-frame systems. Entities located in inactive zones bypass physical movement entirely; instead, their positions are tracked via logical Map/Zone entity relations, and their GOAP planners update on low-frequency time-gate intervals representing coarse world time. Upon zone transitions, a hydration pipeline converts logical sector indices into absolute spatial hash coordinates instantly.

## Design Reference

Follow the layout pattern and rules established in:
- `packages/frontend/engine/src/systems/zoning_system.ts` for transition hooks.
- `packages/frontend/engine/src/math/spatial_hash_grid.ts` for local hash population.
- `.pi/skills/testing/SKILL.md` for test conventions.

All structural transitions must occur inside unproxied Web Worker memory to maintain cache coherence and avoid binding reactive traps during zone hydration sweeps.

## Architecture Directives

1. **Two-Tier Gating**: Systems like `SpatialVisionSystem`, `MovementSystem`, and `CollisionSystem` must filter queries using an explicit `ActiveZone` filter component tag, preventing inactive entity computation.
2. **Coarse Time-Gate Scheduler**: Implement a low-frequency tick loop inside `MacroSimulationSystem`. This loop matches the central timestamp clock and steps inactive agents through state changes on macro time updates (e.g., moving an off-screen NPC from home to work states by changing their sector key).
3. **Hydration Engine**: When a portal event changes the active zone identifier, the worker must execute a de-hydration sweep (removing exiting actors from the active spatial grid) and a hydration sweep (injecting entering actors into corresponding grid coordinates).

## State & Data Models

Conceptual interfaces and component definitions. Code blocks use 4-space indentation with NO backticks.

    // Component configurations for tracking entity location sectors
    interface MapLocationComponent {
        currentZoneId: Uint32Array;  // Entity ID of the active Map/Zone entity
        virtualGridX: Uint32Array;   // Coarse target X layout variable for offline tracking
        virtualGridY: Uint32Array;   // Coarse target Y layout variable for offline tracking
    }

    interface ZoneStatusComponent {
        isActive: Uint32Array;       // 1 if zone matches player's location, 0 otherwise
    }

## Scope Boundaries

- **In Scope**:
    - `MapLocationComponent` and `ZoneStatusComponent` bitECS schemas.
    - Low-frequency macro simulation processing loop updating virtual grids on time ticks.
    - Dynamic zone filtering guards injected across real-time high-fidelity systems.
    - Hydration/De-hydration processing loops pulling and pushing entities into active spatial hashes.
- **Out of Scope**:
    - String registry dictionary mapping optimizations (handled under C-195).
    - Database persistence synchronization layer rules (handled under C-195).

## Acceptance Criteria

### AC-1: High-Fidelity Gating Performance
**Given** Multiple NPCs tagged with `MapLocationComponent` pointing to inactive map sectors
**When** High-frequency frame loops (physics, path following, raycasting) execute inside the worker
**Then** Processing queries must completely ignore these entities, maintaining zero frame latency overhead.

### AC-2: Coarse Schedule State Shifts
**Given** An off-screen character with conditions tracking a time-gated daily routine layout
**When** The core clock triggers a milestone hour transition (e.g., from working hours to leisure hours)
**Then** The macro scheduler executes bitwise state modifications and updates the entity's virtual sector position variables without running path node expansions.

### AC-3: Portal Zone Hydration Tracking
**Given** The player entity steps through a gateway boundary, swapping the engine's target active sector ID
**When** The hydration lifecycle fires during the transition sequence
**Then** Old local entities are de-hydrated out of the spatial grid, and incoming zone characters are instantly injected into active coordinate hash blocks by index.

**Test Hooks**:
- Moon Task: `moon frontend-engine:test`
- Integration: Trigger cross-zone mock transitions to confirm macro-simulated entities map instantly to valid spatial coordinates upon zone initialization.
- E2E / Visual:
    - **Functional**: Unit tests covering hydration transforms inside `packages/frontend/engine/src/__tests__/macro_simulation.test.ts`. Full zoning integration tests handled via `apps/e2e/tests/game/zone_hydration.spec.ts`.
    - **Visual**: Update `apps/e2e/src/visual/suites/map.visual.ts` to capture the visual entry states of characters as they populate around the player immediately after crossing an interior portal boundary.
    
    Evaluation parameters:
    defineConfig({
        suite: "macro_simulation_hydration",
        cases: [{ name: "portal_hydration_pop", route: "/dev/sandbox/map?simulate_transition=true" }]
    });
    
    OpenRouter AI Evaluation Prompt:
    "Score 90+ if, immediately following a simulated room transition fade, all zone-resident NPCs appear correctly aligned with their specified grid tiles. No out-of-bounds positioning or overlapping collision stack offsets are permitted."

## Watch Points

- **Stale Grid Leakage**: If an actor is de-hydrated but their entity key isn't cleared out of the active `SpatialHashGrid` 1D array buckets, real-time sweeps will throw null pointer errors or hit phantom entities. Clean alignment is mandatory.
- **Clock Floating Overflows**: Ensure world time values use strict integer-based tracking variables. Floating point drifting on macro clock boundaries will cause off-screen state transitions to fall out of step.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Build location component structures and system gating layouts inside `packages/frontend/engine/src/systems/`.
2. **Phase 2 (Integration)**: Build out the hydration/de-hydration logic loops and wire them into the portal transition pipeline inside `ecs_worker.ts`.
3. **Phase 3 (Validation)**: Run `validate()`, verify execution test patterns pass, and run visual assessments using the Bun Visual suite to check alignment matching.
