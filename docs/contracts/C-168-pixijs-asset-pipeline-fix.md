<!-- completed: 2026-06-29 -->
<!-- audit: legacy — no execution report -->
# Contract: C-168 PixiJS v8 Asset Pipeline Refactor

| Field | Value |
| --- | --- |
| Source | Architect |
| Target | packages/frontend/engine/src/rendering/, apps/frontend/client/src/lib/components/game/ |
| Priority | High |
| Dependencies | C-167 |
| Status | completed |
| Contract version | 1.0 |

## Overview
Refactor the overworld sprite rendering to fix the PixiJS v8 texture frame cropping bug. We are migrating away from synchronous Vite image imports to PixiJS's asynchronous `Assets.load()` and the native `Spritesheet` API to ensure proper WebGPU-compatible texture UV mapping.

## Design Reference
- PixiJS v8 documentation on `Assets` and `Spritesheet`.
- Existing texture management in `packages/frontend/engine/src/rendering/texture_manager.ts`.

## Architecture Directives
- **Drop Direct Vite Imports:** Remove `import image from './sheet.png'` for PixiJS textures. Pass raw URL strings (from the static folder) to the engine instead.
- **Async Asset Loading:** Ensure the engine's `TextureManager` uses `Assets.load(url)` to fetch the base image safely.
- **Spritesheet Generation:** Instead of manually hacking `new Texture({ source, frame: rect })`, construct a `Spritesheet` object with the loaded base texture and a dynamically generated JSON atlas defining the 64x64 frame coordinates. Await `sheet.parse()`.
- **Texture Assignment:** Assign the correctly parsed sub-texture (e.g., `sheet.textures['idle_down']`) to the Sprite.

## State & Data Models
    interface LpcAtlasData {
        frames: Record<string, { frame: { x: number, y: number, w: number, h: number } }>;
        meta: { image: string, format: string, size: { w: number, h: number }, scale: number };
    }

## Acceptance Criteria

- **AC1: Async Texture Resolution**
  - **Given** the overworld engine initializes a character entity
  - **When** the sprite component requests a texture
  - **Then** the engine fetches it asynchronously via `Assets.load()` without throwing WebGL context or UV fragmentation errors.
  
- **AC2: Accurate Frame Cropping**
  - **Given** the LPC walk spritesheet (576x256) is loaded via the new pipeline
  - **When** the player is in an idle state on the overworld map
  - **Then** the engine correctly extracts and renders only the single 64x64 frame.
  - *Test Hook:* The overworld canvas visual test must show a single correctly proportioned character, not the entire sprite grid.

## Implementation Notes
1. Update `texture_manager.ts` (or equivalent loader) to accept string URLs and return Promises.
2. Add a helper function to dynamically generate the `LpcAtlasData` JSON object. Since LPC spritesheets follow a strict grid (9 frames x 4 rows, 64x64px each), you can generate the frame mappings procedurally rather than hardcoding them.
3. Instantiate `new Spritesheet(baseTexture, atlasData)` and await its `parse()` method before trying to render.
4. Update `lpc_character_renderer.svelte` to handle the asynchronous loading phase before mounting the sprite to the stage.

## Edge Cases & Gotchas
- **Caching:** `Assets.load()` caches internally, but ensure we don't recreate the `Spritesheet` atlas object multiple times for NPCs that share the exact same base asset.
- **Race Conditions:** The Svelte component might try to render before the async `Assets.load()` completes. Implement a loading state or an invisible placeholder sprite until the texture resolves.
