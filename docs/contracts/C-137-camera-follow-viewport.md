# Contract: C-137 Camera Follow & Viewport

## Goal
Implement a 2D camera system within the PixiJS v8 engine that smoothly tracks the player entity. The camera must automatically clamp to the boundaries of the loaded tilemap to prevent revealing the empty void outside the playable area.

## Tech Stack
- **Engine:** PixiJS v8, Web Worker ECS
- **Math:** Linear Interpolation (Lerp), Boundary Clamping

---

## Task 1: Camera Focus Component
**File:** `packages/frontend/engine/src/components/camera_focus.ts`
- Create a simple `CameraFocus` component (or a tag component) that can be attached to an entity.
- Attach this component to the Player entity during initialization or spawning so the camera system knows what to track.

## Task 2: Build the Camera System
**File:** `packages/frontend/engine/src/systems/camera_system.ts`
- Create a `CameraSystem` that runs every frame in the ECS update loop.
- **Tracking Logic:**
  - Find the entity with the `CameraFocus` component and extract its `Position`.
  - Apply linear interpolation (lerp) to smoothly transition the camera's current `x` and `y` coordinates toward the target entity's position.
- **Clamping Logic:**
  - Calculate the camera bounds using the screen dimensions and the loaded map dimensions (available from `GameWorld` or a `MapData` component).
  - Clamp the target coordinates so the camera's viewport never extends beyond `0, 0` or `mapWidth, mapHeight`.
- **Rendering:**
  - Apply the calculated coordinates to the main PixiJS `Container` (the world stage).
  - Typically, this involves setting the container's `pivot` to the camera's `x/y` and setting its `position` to `screenWidth / 2, screenHeight / 2` to keep the target centered.

## Task 3: Update Initialization & Screen Resizing
**File:** `packages/frontend/engine/src/engine_bridge.ts` & `game_world.ts`
- Ensure the `CameraSystem` is aware of the current canvas/screen dimensions.
- If the browser window or Svelte UI resizes, pass a `RESIZE` message across the Web Worker bridge so the `CameraSystem` updates its clamping bounds and center offset.

## Task 4: Unit & Visual Testing
- **File:** `packages/frontend/engine/src/systems/camera_system.test.ts`
  - Write Vitest unit tests for the camera math.
  - Assert that lerp applies correctly over multiple ticks.
  - Assert that clamping restricts the coordinates correctly when the target entity is placed at the extreme edges (e.g., `-100, -100` or `9999, 9999`).
- **File:** `apps/e2e/tests/game/camera_visual.spec.ts`
  - Create a Playwright visual or behavioral test.
  - Spawn a player at the edge of a map, move them toward the center, and verify the background container's transform updates correctly.

## Acceptance Criteria
- [ ] A `CameraFocus` component dictates the camera target.
- [ ] The world container smoothly follows the player using lerp.
- [ ] The camera strictly clamps to the map boundaries and does not show off-map areas.
- [ ] Window resize events correctly update the camera centering and boundary math.
- [ ] Unit tests for clamping and lerp math pass cleanly.
