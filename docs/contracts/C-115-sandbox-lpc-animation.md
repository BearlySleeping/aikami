## Metadata

| Field | Value |
|---|---|
| **Source** | Aikami `TODO.md` — Asset Pipeline & Animation Polish |
| **Target** | `packages/frontend/engine/src/game_world.ts` — Sandbox LPC Visuals |
| **Priority** | P1 — Visual parity for the vertical slice |
| **Dependencies** | C-114 |
| **Status** | completed |
| **Contract version** | 1.0.0 |

## Overview

In C-114, we successfully established the EngineBridge but relied on 48x48 colored PixiJS `Graphics` rectangles to represent our entities. The `@aikami/engine` package already contains an advanced LPC (Liberated Pixel Cup) render pipeline and `AnimationController` built during earlier contracts. This contract removes the placeholder rectangles, injects the LPC sprites, and maps the worker's velocity data to directional walking animations.

## Design Reference

**Aikami patterns**: 
- `packages/frontend/engine/src/rendering/animation_controller.ts`
- `packages/frontend/engine/src/rendering/sprite_composer.ts`
- The bitECS component structures in `packages/frontend/engine/src/components/`

## Architecture Directives

- Let Pi handle Svelte and PixiJS specific class instantiations depending on the exact shape of `SpriteComposer` or `AnimationController` already present in the codebase.
- The `RenderEntry` type in `GameWorld` needs to be expanded to track the `AnimationController` for each entity.
- The main thread render loop must determine the facing direction. It can do this by reading `Velocity` data from the SharedArrayBuffer, or by calculating positional deltas (dx, dy) across frames, to pass into the animation state machine.

## State & Data Models

Extend the `RenderEntry` in `GameWorld`:

    type RenderEntry = {
      displayObject: Container;
      animationController?: AnimationController; // NEW: The LPC animation driver
      tint: number;
      cullable: boolean;
    };

## Acceptance Criteria

### AC-1: LPC Sprite Rendering
**Given** the sandbox engine initializes
**When** the `ENTITY_CREATED` event fires for the player and NPC
**Then** `GameWorld` instantiates an LPC composed sprite (or fallback texture) instead of a `Graphics` rectangle, and adds it to the PixiJS stage.

**Test Hooks**:
- Integration: Dev tools PixiJS tab shows `Sprite` or `Container` objects with LPC textures, not `Graphics` primitives.

### AC-2: Directional Walking Animation
**Given** the player holds down `W`, `A`, `S`, or `D`
**When** the worker updates the entity's position/velocity
**Then** the main thread `_updateRenderFromBuffer` detects the movement vector, sets the `AnimationController` direction (Up, Left, Down, Right), and plays the "walk" animation loop.

**Test Hooks**:
- Manual/Visual: Character's legs move when moving, and the sprite faces the correct direction.

### AC-3: Idle State Resolution
**Given** the player releases all movement keys
**When** the entity comes to a halt (velocity hits 0)
**Then** the `AnimationController` transitions from "walk" to "idle", locking the sprite on the correct directional standing frame.

**Test Hooks**:
- Manual/Visual: Character stops animating but remains facing the last known direction.

## Implementation Notes

1. **Files to modify**: 
   - `packages/frontend/engine/src/game_world.ts`
   - Svelte view files (if the texture manager needs to be preloaded before canvas handoff).
2. **Order of operations**: 
   - Modify `GameWorld` constructor or initialization to ensure Svelte preloads required LPC textures via `TextureManager`.
   - In `_handleEntityCreated`, remove the `Graphics` block. Instantiate the LPC sprite/animator and attach it to the stage.
   - Update `_updateRenderFromBuffer` to read velocity/positional deltas from the `renderView` buffer.
   - Dispatch `play('walk', dir)` or `play('idle', dir)` to the `AnimationController` based on the delta.

## Edge Cases & Gotchas

- **SharedArrayBuffer Stride**: Make sure Svelte S5/bitECS `COMPONENT_STRIDE` aligns with where Svelte reads the `Velocity` (if `Velocity` is shared). If `Velocity` isn't shared in the buffer yet, calculate the delta using `x - lastX` and `y - lastY` directly in the main thread render loop.
- **Texture Loading Async Issues**: PixiJS v8 handles assets asynchronously. Ensure textures are fully loaded/awaited before `ENTITY_CREATED` tries to construct an `AnimationController`, otherwise Svelte might throw a texture missing error.
