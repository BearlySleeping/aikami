# Contract: C-136 Entity & Prop Spawner

## Goal
Extend the map loading system to parse "Object Group" layers from Tiled JSON data. Use this data to dynamically spawn NPCs and interactive props into the ECS world, attaching the correct components (e.g., `NpcData`, `Sprite`, `Position`) so they can be rendered and interacted with via the dialogue system.

## Tech Stack
- **Engine:** Web Worker ECS, PixiJS v8
- **Data:** Tiled JSON Object Layers

---

## Task 1: Housekeeping - Fix Serializer Tests
**File:** `packages/frontend/engine/src/serialization/ecs_serializer.test.ts` (or equivalent test file)
- Identify and fix the 3 pre-existing test failures related to error message format mismatches in `ecs_serializer.ts`.
- Ensure the entire engine test suite returns to a 100% passing state before proceeding with new feature logic.

## Task 2: Parse Tiled Object Layers
**File:** `packages/frontend/engine/src/assets/map_loader.ts`
- Extend the map parsing logic to extract layers of type `"objectgroup"`.
- Map Tiled objects to a standardized `SpawnPoint` interface:
  - `id`: string
  - `type`: string (e.g., `'npc'`, `'prop'`)
  - `x`: number
  - `y`: number
  - `properties`: Record<string, any> (Custom properties defined in Tiled, such as `npcId` or `dialogueKey`).

## Task 3: Build the Entity Spawner System
**File:** `packages/frontend/engine/src/systems/entity_spawner.ts`
- Create a factory or ECS system responsible for digesting an array of `SpawnPoint` objects when a map is loaded.
- **Logic:**
  - For `type === 'npc'`: Create an entity with `Position` (mapped from Tiled `x`/`y`), `Sprite` (resolved via `lpc_asset_catalog`), `Interactable`, and `NpcData` (using the `npcId` from properties).
  - For `type === 'prop'`: Create static interactive or decorative entities.
- Ensure the newly spawned entities correctly register with the ECS so the `tilemap_render_system` and `interaction_system` pick them up.

## Task 4: Unit Testing
- **File:** `packages/frontend/engine/src/assets/map_loader.test.ts`
  - Add tests to verify that object layers are correctly parsed and custom properties are accurately extracted.
- **File:** `packages/frontend/engine/src/systems/entity_spawner.test.ts`
  - Write unit tests mocking the ECS world.
  - Pass a mock `SpawnPoint` array and assert that the correct entities and components are instantiated.

## Acceptance Criteria
- [ ] `ecs_serializer.test.ts` failures are fixed (test suite is 100% green).
- [ ] Map loader successfully extracts Tiled `objectgroup` data.
- [ ] `EntitySpawner` correctly translates spawn points into ECS entities with `NpcData` and `Position` components.
- [ ] All unit tests pass.
