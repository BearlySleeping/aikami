// docs/contracts/C-024-dynamic-sprite-caching.md
# Contract: C-024 Dynamic Sprite Caching & Composition

## Design References
- PixiJS v8 Texture & Assets Documentation
- Deep Research: PixiJS v8 Dynamic Sprite Caching
- Aikami Engine: `packages/engine/src/systems/render_system.ts`

## Detailed Changes
1. **ECS Component**: Create `packages/engine/src/components/appearance.ts`. Define a bitECS component that stores an array of integer IDs (or a fixed-size TypedArray of hashes) representing the asset layers.
2. **Texture Manager**: Create `packages/engine/src/rendering/texture_manager.ts`. Implement an LRU cache wrapper around `PixiJS.Assets`. It handles fetching URLs from Firebase (or mock local URLs for now) and tracks VRAM usage/last-accessed ticks.
3. **Sprite Composer**: Create `packages/engine/src/rendering/sprite_composer.ts`. Responsible for taking an entity's `Appearance` data, generating a PixiJS `Container`, async-loading the layers, and applying `cacheAsTexture` once fully assembled. 
4. **Render System Refactor**: Modify the main thread's `updateRenderFromBuffer` logic in `render_system.ts`. Transition from drawing primitive `Graphics` objects to mapping Entity IDs to `SpriteComposer` instances.

## Acceptance Criteria
- **Given** an entity is spawned with an `Appearance` component requiring 3 layers (body, shirt, sword).
- **When** the main thread receives the `ENTITY_CREATED` event.
- **Then** a placeholder object is immediately rendered at the entity's coordinates.
- **When** the `texture_manager` asynchronously resolves the 3 images.
- **Then** the `sprite_composer` replaces the placeholder, layers the sprites correctly, and flattens them into a cached texture.
- **When** the texture cache exceeds its configured capacity (e.g., 200MB or 1000 textures).
- **Then** the least recently accessed textures are forcefully evicted and destroyed from VRAM.

## Watch Points
- **Worker/Main Boundary**: The Worker only simulates `Position` and `Appearance` components. The Main Thread owns the PixiJS `Container` and `Texture` memory.
- **Memory Leaks**: Ensure that when an entity is destroyed via the Worker, the Main Thread correctly signals the `texture_manager` to decrement reference counts.
- **Z-Fighting**: Enforce a strict rendering order array for composite layers (e.g., skin always below armor).
