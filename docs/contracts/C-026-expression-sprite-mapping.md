# Contract: C-026 Expression & Sprite State Mapping

## Design References

- RisuAI/SillyTavern Expression Systems (e.g., `public/img/default-expressions/joy.png`)
- Aikami AST Parser: `packages/shared/parser/`
- Aikami Engine: `packages/engine/src/worker/ecs_worker.ts`
- Aikami Engine: `packages/engine/src/rendering/sprite_composer.ts`

## Detailed Changes

1. **Event Propagation**: Ensure `EngineBridge.triggerMacro` correctly serializes macro events (e.g., `{ type: 'MACRO', name: 'anim', args: ['joy'], targetId: eid }`) and passes them via `postMessage` into the Web Worker.
2. **ECS Expression System**: Create `packages/engine/src/systems/expression_system.ts`. This system runs inside the worker and processes incoming `ANIMATION` or `MACRO` events from the bridge queue.
3. **Appearance Component Mutation**: When `expression_system.ts` receives an `anim:joy` macro for a specific Entity ID, it must mutate that entity's `Appearance` component. Specifically, it should update the integer representing the facial layer (e.g., `Appearance.layer1[eid] = TextureHashes.JOY`).
4. **Cache Invalidation Pipeline**: In the main thread (`render_system.ts` or `ecs_worker` message listener), detect when an entity's `Appearance` array changes. Call `invalidateComposedSprite(eid)` to force the `SpriteComposer` to refetch the new layer and rebuild the `cacheAsTexture`.

## Acceptance Criteria

- **Given** an NPC entity is rendered on screen with a neutral expression.
- **When** the AI generates a chat message containing `{{anim:joy}}`.
- **Then** the Svelte UI AST parser extracts the macro and sends it to the `EngineBridge`.
- **Then** the Web Worker processes the event and updates the NPC's `Appearance` component.
- **Then** the main thread detects the mutation, invalidates the sprite cache, and re-renders the NPC with the 'joy' texture layer seamlessly.

## Watch Points

- **Texture Preloading**: The `TextureManager` (C-024) must gracefully handle the asynchronous load of the new expression texture without causing the base body to flash or disappear during the swap.
- **Worker Concurrency**: Ensure the `postMessage` payload mapping macros to specific Entity IDs is correctly routed. The UI must know the `targetId` (the NPC speaking) when it evaluates the macro.
- **Layer Indexes**: Strictly define which index in the `Appearance.layers` array corresponds to the facial expression so equipment layers are not accidentally overwritten.
