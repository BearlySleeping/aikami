## Metadata

| Field | Value |
|---|---|
| **Source** | Architect MVP Polish |
| **Target** | `packages/frontend/engine/src/rendering/` — LPC Sprite rendering |
| **Priority** | P0 — Required for visual MVP completion |
| **Dependencies** | C-123, C-081 |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Overview

The player creates a customized character in `/setup`, but the game engine currently renders the default placeholder LPC sprite. We need to fulfill the rendering requirements by injecting the active Persona's visual traits into the ECS and layering the correct LPC spritesheets (body, hair, clothes) in PixiJS.

## Design Reference

Refer to `lpc_asset_catalog.ts` and the established `Appearance` component. 

## Architecture Directives

- During `INITIALIZE_ENGINE` or `LOAD_MAP`, the `playerData` payload must pass down the `appearance` fields extracted during Character Creation.
- Expand `SpriteComposer` or `tilemap_render_system` to dynamically load multiple textures from the LPC catalog based on the entity's `Appearance` component (e.g., base body -> pants -> shirt -> hair).
- Composite these textures into a single `Container` or use a `RenderTexture` cache to avoid massive draw calls for layered sprites.

## State & Data Models

    // Expected mapping from Persona to LPC
    export interface LpcRecipe {
        body: string; // e.g. 'light', 'dark', 'orc'
        hair: string; // e.g. 'long_blonde', 'short_brown'
        torso: string; // e.g. 'leather_armor'
        legs: string; // e.g. 'pants_green'
    }

## Acceptance Criteria

### AC-1: Dynamic Player Rendering
**Given** the player has created a character with specific traits (e.g., red hair, dark skin)
**When** the game canvas loads
**Then** the player sprite visually reflects these layered textures, animated correctly via the `AnimationController`.

**Test Hooks**:
- Visual: Use `apps/e2e/scripts/shared/screenshot.ts` in a Playwright test to verify the generated character sprite differs from the default white/gold tint box and the default male base.

## Implementation Notes

1. **Files to modify**: `create_player.ts`, `ecs_worker.ts`, `game_world.ts`, `lpc_asset_catalog.ts`
2. **Order of operations**:
   - Map Persona appearance traits to exact LPC asset URLs in the catalog.
   - Update `create_player.ts` to accept and set the `Appearance` component.
   - Update the render system to iterate over the `Appearance` layers and stack PixiJS Sprites inside the entity's container.

## Edge Cases & Gotchas

- **Z-Index Layering**: Strict ordering is required (Body -> Eyes -> Pants -> Shirt -> Hair -> Hats/Helmets). 
- **Texture Loading**: Ensure all layers are fully loaded via `Assets.load()` before displaying the entity, or handle pop-in gracefully.
