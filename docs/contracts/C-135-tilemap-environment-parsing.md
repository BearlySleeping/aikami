<!-- completed: 2026-06-29 -->
<!-- audit: legacy — no execution report -->
# Contract: C-135 Tilemap & Environment Parsing

## Goal
Implement a map loading system that parses 2D tilemap data (JSON) and renders it using PixiJS v8. This system must handle multiple graphical layers (e.g., ground, walls, overlays) and establish a static collision grid for the physics system so the player cannot walk off the map or through walls.

## Tech Stack
- **Engine:** PixiJS v8, Web Worker ECS
- **Assets:** Standard 2D Tilemap JSON (Tiled format) & Spritesheets

---

## Task 1: Map Asset Loader
**File:** `packages/frontend/engine/src/assets/map_loader.ts`
- Create a service to fetch and parse map JSON files.
- The loader should extract:
  - `width`, `height`, and `tilewidth`/`tileheight`.
  - `tilesets` (references to image assets).
  - `layers` (arrays of tile IDs for rendering, plus a specific collision layer).
- Ensure integration with the existing PixiJS `Assets` bundle system so map images are loaded before the scene mounts.

## Task 2: Tilemap Rendering System
**File:** `packages/frontend/engine/src/systems/tilemap_render_system.ts`
- Build an ECS system responsible for rendering the static map.
- Iterate through the parsed map layers (bottom to top).
- **Optimization:** Instead of creating a distinct PixiJS `Sprite` for every single tile (which kills performance), use a `CompositeTilemap` or render the static background layers into a single cached `RenderTexture` (or use `@pixi/tilemap` if available for v8).
- Attach this rendered background to the main scene container, strictly behind the player's z-index.

## Task 3: Collision Grid Initialization
**File:** `packages/frontend/engine/src/systems/physics_system.ts` (or relevant collision module)
- Parse the dedicated `collision` layer from the map JSON.
- Translate the tile IDs into a 2D boolean grid (or an array of static collision bounding boxes).
- Update the player movement logic to check this grid before applying velocity, preventing the player from passing through solid tiles.

## Task 4: Unit & Visual Testing
- **File:** `packages/frontend/engine/src/assets/map_loader.test.ts`
  - Write Vitest unit tests to ensure the JSON parser correctly maps tile IDs and calculates dimensions.
- **File:** `apps/e2e/tests/game/map_rendering_visual.spec.ts`
  - Create a Playwright visual regression test that loads a small test map (e.g., 10x10 tiles with a wall and floor) and takes a snapshot to ensure PixiJS renders the grid accurately without seam bleeding.

## Acceptance Criteria
- [ ] Map JSON files are successfully parsed and cached.
- [ ] Static backgrounds render correctly in PixiJS without tanking framerate.
- [ ] Player entity respects the bounds and obstacles defined in the map's collision layer.
- [ ] Unit and Visual tests pass.
