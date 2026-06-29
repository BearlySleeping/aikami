<!-- completed: 2026-06-29 -->
## Metadata

| Field | Value |
|---|---|
| **Source** | `Dynamic Entity Spawning in PixiJS/bitECS` (Deep Research) |
| **Target** | `packages/frontend/engine/src/components/visual.ts`, `render_system.ts`, `entity_spawner.ts` — Decouple PixiJS objects from bitECS |
| **Priority** | P0 — Resolves critical cache-miss bottleneck and prepares for async asset loading |
| **Dependencies** | C-136 (Entity Spawner) |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Overview

The current implementation violates Data-Oriented Design by storing complex `PIXI.Sprite` references directly inside the bitECS `Sprite` component. This fragments memory, destroys cache locality, and prevents clean serialization. This contract replaces the object-heavy `Sprite` component with a pure numeric `Visual` component, utilizing bitECS v0.4.0's `observe` hooks to manage PixiJS object lifecycles entirely within the rendering domain.

## Design Reference

Follow the "Reactive Placeholder Architecture" and "Observer Pattern Integration" from the deep research.
- Reference `packages/frontend/engine/src/systems/render_system.ts` for the observer injection.
- Reference `packages/frontend/engine/src/systems/entity_spawner.ts` for where instantiation logic currently incorrectly creates PixiJS objects.

## Architecture Directives

1. **Eradicate Object Components**: Delete the current `Sprite` component. Re-engineer it as `Visual` containing strictly TypedArrays.
2. **Numeric Asset Mapping**: Implement a lightweight mapping structure (e.g., an enum or dictionary) that maps a `Uint16` integer to a PixiJS asset alias string (e.g., `1` -> `'asset_chest_wood'`).
3. **Observer-Driven Instantiation**: In the `RenderSystem` (or a dedicated `RenderObserverSystem`), register `onAdd(Visual)` and `onRemove(Visual)` observers.
4. **Decoupled Render Map**: The rendering system must maintain a private `Map<number, PIXI.Container | PIXI.Sprite>` connecting the `eid` to the visual object. The ECS world should never know about this Map.
5. **Memory Safety on Despawn**: The `onRemove(Visual)` hook must explicitly call `.destroy()` on the PixiJS object and remove it from the stage to prevent VRAM leaks.

## State & Data Models

```typescript
// Conceptual Component Definition
export const Visual = {
    // Integer ID corresponding to the asset dictionary/alias
    assetIndex: new Uint16Array(MAX_ENTITIES),
    // Hex color tint, useful for basic visual variations without new textures
    tint: new Uint32Array(MAX_ENTITIES),
    // Visibility flag (1 = visible, 0 = hidden)
    visible: new Uint8Array(MAX_ENTITIES)
};

// Conceptual Asset Dictionary
export enum AssetAlias {
    PLACEHOLDER = 0,
    PLAYER = 1,
    NPC_GANDALF = 2,
    PROP_CHEST = 3
    // ...
}

```

## Scope Boundaries

* **In Scope:** - Replacing the `Sprite` component with the `Visual` component.
* Setting up the `onAdd` and `onRemove` observers in the rendering logic.
* Refactoring `create_npc`, `create_player`, and `entity_spawner` to only assign numeric data.
* Adding a fallback/placeholder texture load during the `onAdd` event.


* **Out of Scope:** - WebGPU Tilemap rendering (handled in C-171).
* Map transition Staging Worlds (handled in C-172).
* Advanced animation frame ticking.



## Acceptance Criteria

### AC-1: Data-Oriented Component Purity

**Given** an active game world where entities have been spawned
**When** the bitECS memory arrays are inspected
**Then** no instances of `PIXI.Sprite` or `PIXI.Container` exist within any bitECS component structure, and `Visual.assetIndex` correctly stores the integer asset mapping.

**Test Hooks**:

* E2E / Visual: N/A

### AC-2: Reactive Visual Instantiation

**Given** the game loop is running
**When** the `EntitySpawner` attaches a `Visual` component to a new `eid`
**Then** the `onAdd` observer in the rendering system immediately fires, reads the `assetIndex`, spawns a PixiJS Sprite, and maps it in its local `SceneMap`.

**Test Hooks**:

* Integration: Run unit tests verifying `RenderSystem` correctly captures `observe(world, onAdd(Visual))`.

### AC-3: Safe Memory Reclamation

**Given** an entity with an active visual representation
**When** the entity is destroyed or its `Visual` component is removed
**Then** the `onRemove` observer fires, safely calls `.destroy({ children: true })` on the corresponding PixiJS object, and deletes the reference from the `SceneMap`.

**Test Hooks**:

* Integration: Verify via memory profiling or mocked unit tests that despawning an entity cleans up the PixiJS scene graph.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Delete `components/sprite.ts`, create `components/visual.ts` and the `AssetAlias` mapping. Fix all TypeScript errors in the spawner factories by replacing object assignment with `Visual.assetIndex[eid] = ...`.
2. **Phase 2 (Integration)**: Inject the `onAdd` and `onRemove` observer hooks into the `RenderSystem`. Create the private `Map<number, PIXI.Sprite>` to handle the ECS-to-Pixi correlation.
3. **Phase 3 (Validation)**: Run unit and E2E tests to verify sprites still appear exactly as they did before, but now driven reactively.

## Edge Cases & Gotchas

* **Asynchronous Loading**: The engine uses PixiJS `Assets.load()`. When `onAdd` fires, assign a pre-loaded placeholder texture synchronously to avoid invisible collisions, and resolve the true texture asynchronously. Ensure you check `hasComponent(world, Visual, eid)` inside the `.then()` block, in case the entity was destroyed before the network request finished.
* **Vite Asset Imports**: Be mindful of how PixiJS v8 handles Vite asset paths (as discovered in the `PixiJS V8 Direct Import Cropping` doc).
