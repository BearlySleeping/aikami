# Contract: C-139 Isolated Dev Sandboxes & Map Wiring

## Goal
The engine can now parse maps, spawn entities, and transition zones, but the Svelte frontend never explicitly loads a map on boot, resulting in an empty canvas. This contract will wire up the main game initialization to load a starting map and create dedicated, isolated `/dev` routes to visually test tilemaps, collisions, and zoning.

## Tech Stack
- **Framework:** Svelte 5, SvelteKit Routing
- **Engine:** PixiJS v8, `GameWorld.loadMap()`

---

## Task 1: Create Test Map Assets
**Files:** 
- `apps/frontend/client/static/assets/maps/sandbox_zone_a.json`
- `apps/frontend/client/static/assets/maps/sandbox_zone_b.json`
- Ensure there is at least one simple tileset image (e.g., `apps/frontend/client/static/assets/images/tilesets/debug_tiles.png`).
- Create two minimal Tiled JSON maps. 
  - `sandbox_zone_a` should contain a floor layer, a collision wall layer, a couple of dummy NPC/prop spawn points, and a transition zone pointing to `sandbox_zone_b`.
  - `sandbox_zone_b` should just be a visually distinct room to confirm the transition worked, with a transition back to `sandbox_zone_a`.

## Task 2: Build the Isolated Map Sandbox Route
**Files:** 
- `apps/frontend/client/src/routes/dev/sandbox/map/+page.svelte`
- `apps/frontend/client/src/routes/dev/sandbox/map/map_sandbox_view_model.svelte.ts`
- Create a new SvelteKit route dedicated entirely to testing the map systems.
- In the ViewModel, instantiate the `GameWorld` (or use the existing engine bridge) and explicitly call `loadMap('sandbox_zone_a.json', 5, 5)` (or pixel coordinates, depending on the engine's coordinate system) on mount.
- Render the `game_canvas.svelte` component within this route.
- Include floating Dev UI buttons to manually trigger `loadMap('sandbox_zone_a.json')` and `loadMap('sandbox_zone_b.json')` for rapid testing.

## Task 3: Update the Dev Tools Panel
**File:** `apps/frontend/client/src/lib/components/dev/dev_tools_panel.svelte`
- Add a new section or button to the Dev Tools Panel titled "Map & Zoning Sandbox".
- Link this button to navigate to `/dev/sandbox/map`.

## Task 4: Wire Main Game Initialization
**File:** `apps/frontend/client/src/lib/services/game/game_state_service.svelte.ts` (or `game_canvas.svelte` / `menu_view_model.svelte.ts`)
- Currently, starting a "New Game" just mounts an empty ECS world.
- Update the "New Game" logic so that after the `GameWorld` is initialized, it immediately calls `loadMap('starting_village.json')` (or whatever your actual first map asset is called).
- If loading from a save (via `C-132`), ensure the map ID stored in the save file is passed to `loadMap()` so the player wakes up in the correct room.

## Acceptance Criteria
- [ ] Two debug map JSON files exist in the static assets directory.
- [ ] Navigating to `/dev/sandbox/map` successfully loads `sandbox_zone_a`, rendering tiles, NPCs, and walls.
- [ ] The player can physically walk into the transition zone in the sandbox and appear in `sandbox_zone_b` (testing C-135, C-136, C-137, and C-138 simultaneously).
- [ ] The main game loop now loads a default map instead of an empty canvas when "New Game" is selected.
