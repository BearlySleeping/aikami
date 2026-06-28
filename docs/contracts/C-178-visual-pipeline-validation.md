## Metadata

| Field | Value |
|---|---|
| **Source** | Visual Sandbox Debugging Requirements |
| **Target** | `apps/frontend/client/static/assets/images/tilesets/debug_tiles.png`, `apps/frontend/client/static/assets/maps/debug_map.jton`, `map_sandbox_view_model.svelte.ts` |
| **Priority** | P0 — Visually validates the entire engine rewrite (C-171 through C-177) |
| **Dependencies** | C-175 |
| **Status** | completed |
| **Contract version** | 1.0.0 |

## Overview

The engine's underlying math and data structures have been completely rewritten for WebGPU and JTON, breaking the legacy sandbox maps. To visually verify that the chunk renderer, spatial hash grid, and JTON parser are functioning correctly, this contract establishes a minimal, color-coded debug tileset and a matching JTON map to render a verifiable test environment.

## Design Reference

Follow the JTON syntax defined in the completion summary of C-175.

## Architecture Directives

1. **Dummy Tileset**: Create a tiny 128x32 PNG file (`debug_tiles.png`) containing exactly four 32x32 colored squares:
   - Index 0: Green (Grass / Walkable)
   - Index 1: Blue (Water / Collision)
   - Index 2: Grey (Wall / Collision)
   - Index 3: Brown (Door / Interactable)
2. **Debug JTON Map**: Create a `debug_map.jton` file that uses this tileset. Paint a basic 10x10 map with grass, a water boundary, and a 3x3 grey house with a brown door.
3. **Sandbox Wiring**: Update `map_sandbox_view_model.svelte.ts` to load `debug_map.jton` instead of the legacy JSON maps.

## State & Data Models

```text
// Conceptual debug_map.jton
:map: 10 10 32 32
:tileset: debug 1 debug_tiles.png 128 32 32 32 0 4
:tiles: ground 1 (x, y, tileId)
0,0,0
1,0,0
2,0,0
// ... fill a 10x10 grid with 0 (Grass)
2,2,2
3,2,2
4,2,2
2,3,2
3,3,3 // Door
4,3,2
// ... (Grey House at 2,2)
:collision: (x, y)
2,2
4,2
2,3
4,3
// Note: Door at 3,3 is not in collision layer so player can walk on it
:spawn: 160 192 player town_spawn
]

```

## Scope Boundaries

* **In Scope:** - Generation of the `debug_tiles.png` and `debug_map.jton`.
* Updating the dev sandbox map view model to load the new file.
* Ensuring the engine correctly binds the `debug_tiles.png` as a `texture2d_array`.


* **Out of Scope:** - Restoring legacy maps (they will be deprecated/deleted later).
* High-fidelity LPC sprite rendering (keep the player as a simple block/placeholder for now).



## Acceptance Criteria

### AC-1: Visual Mesh Rendering

**Given** the map sandbox is loaded
**When** the user navigates to `/dev/sandbox/map`
**Then** the canvas correctly renders the 10x10 colored grid using the WebGPU chunk pipeline without throwing WebGL/WebGPU console errors.

**Test Hooks**:

* Integration: Run the dev server and manually inspect the canvas.

### AC-2: Spatial Hash Collisions

**Given** the debug map is rendered
**When** the player attempts to walk into the Grey (Wall) tiles
**Then** the `CollisionSystem` blocks movement, but allows movement onto the Green (Grass) and Brown (Door) tiles.

**Test Hooks**:

* Integration: Walk the player character against the grey blocks in the sandbox.

## Implementation Sequence

1. **Phase 1 (Assets)**: Generate `debug_tiles.png` using a simple script or canvas API. Write `debug_map.jton` by hand or via a quick script to fill the 10x10 coordinates.
2. **Phase 2 (Wiring)**: Update `map_sandbox_view_model.svelte.ts` to call `loadMap('/assets/maps/debug_map.jton')`.
3. **Phase 3 (Validation)**: Boot the sandbox and verify the chunks render.
