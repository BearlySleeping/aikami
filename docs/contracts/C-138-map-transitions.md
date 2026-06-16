# Contract: C-138 Map Transitions (Zoning)

## Goal
Implement a zoning system that allows the player to seamlessly transition between different tilemaps. When the player steps on a designated "Transition Zone" object, the engine must halt movement, fade out, load the new map data, respawn entities, place the player at the target coordinates, and fade back in.

## Tech Stack
- **Engine:** PixiJS v8, Web Worker ECS
- **Framework:** Svelte 5 (for transition screen/fade overlay)
- **Data:** Tiled JSON (Object Layers for zones)

---

## Task 1: Parse Transition Zones
**File:** `packages/frontend/engine/src/assets/map_loader.ts`
- Extend the `SpawnPoint` or `ObjectLayer` parsing logic to recognize objects of `type === 'transition'`.
- Extract custom properties required for zoning:
  - `targetMap`: string (the ID/filename of the next map)
  - `targetX`: number
  - `targetY`: number

## Task 2: Build the Zoning System
**File:** `packages/frontend/engine/src/systems/zoning_system.ts`
- Create an ECS system that checks for overlap between the Player's `Position` (or bounding box) and any `Transition` entities.
- **Trigger Logic:**
  - Upon collision, immediately disable player input/movement to prevent multiple triggers.
  - Emit a `ZONE_TRIGGERED` message across the `EngineBridge` containing the `targetMap`, `targetX`, and `targetY`.

## Task 3: Handle the Map Transition Lifecycle
**File:** `packages/frontend/engine/src/engine_bridge.ts` & `game_world.ts`
- Implement a `loadMap(mapId, spawnX, spawnY)` orchestrator method.
- **Lifecycle:**
  1. Clear current static geometry, collision grid, and non-persistent entities (NPCs, props).
  2. Preserve the Player entity but update its `Position` component to `spawnX` and `spawnY`.
  3. Load the new map JSON via `map_loader`.
  4. Rebuild the `RenderTexture` for the new map's background and update the collision grid.
  5. Call the `EntitySpawner` to populate the new map's NPCs and props.
  6. Force a camera snap to the new player position to prevent panning across the void.
  7. Re-enable player movement.

## Task 4: Svelte Transition Overlay
**File:** `apps/frontend/client/src/lib/views/game/ui/overlays/transition_overlay.svelte`
- Create a simple, absolute-positioned black overlay (`z-index` above the canvas, below the UI).
- Use a Svelte 5 `$state` boolean (e.g., `isTransitioning`) controlled by the `GameStateService` or `GameUIViewModel`.
- Trigger CSS fade-in/fade-out animations when the frontend receives the `ZONE_TRIGGERED` event from the bridge, coordinating the fade with the async `loadMap` execution.

## Task 5: Unit & E2E Testing
- **File:** `packages/frontend/engine/src/systems/zoning_system.test.ts`
  - Write Vitest unit tests verifying that player coordinates overlapping a transition zone trigger the bridge event exactly once.
- **File:** `apps/e2e/tests/game/map_transitions.spec.ts`
  - Create a Playwright test with two connected sandbox maps.
  - Move the player onto the transition tile and assert that the new map renders and the player's coordinates reflect the `targetX/targetY`.

## Acceptance Criteria
- [ ] Tiled map objects with `type: 'transition'` are successfully parsed.
- [ ] Stepping on a transition zone emits an event and locks player input.
- [ ] `loadMap` successfully purges old map data and mounts the new map without memory leaks.
- [ ] Svelte UI provides a smooth visual fade during the transition.
- [ ] Unit and E2E tests pass cleanly.
