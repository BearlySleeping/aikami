<!-- completed: 2026-06-29 -->
<!-- audit: legacy — no execution report -->
## Metadata

| Field | Value |
|---|---|
| **Source** | Roadmap Phase 3: Stability, Memory, & Packaging |
| **Target** | `apps/frontend/client/src/lib/services/` and `packages/frontend/engine/` |
| **Priority** | P1 — Critical for long play sessions and stability |
| **Dependencies** | C-152, C-153, C-154 |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Overview

This contract bulletproofs the engine to handle extended play sessions. It introduces an Auto-Save mechanism tied to the map transition lifecycle, ensuring player progress is safely written to IndexedDB without manual intervention. Secondly, it audits and patches our PixiJS and Audio lifecycles to ensure proper garbage collection (`destroy()` calls) when unloading maps, preventing memory leaks and Out of Memory (OOM) browser crashes.

## Design Reference

We will hook into the existing `GameSaveService` for the auto-save functionality and audit our `AssetService` / `TextureManager` and `AudioService` implementations based on standard PixiJS v8 memory management practices.

## Architecture Directives

- **Auto-Save Hook:** Hook into the engine's `loadMap` or zone transition lifecycle. Whenever the player successfully loads into a new map/zone, trigger a background call to `GameSaveService.saveGame()`. 
- **Non-Blocking Saves:** Ensure that the save operation does not cause massive frame stutter. IndexedDB operations are asynchronous, but the state serialization should be efficient. Add a subtle UI toast or spinner (e.g., "Auto-Saving...") via the `GameUIViewModel`.
- **Memory Hardening (Graphics):** Audit the map unloading sequence. When a map is destroyed, ensure that `destroy({ children: true, texture: true })` (or equivalent PixiJS v8 destruction patterns) is called on Sprites and Containers that will not be reused. 
- **Memory Hardening (Audio):** Ensure that background music or ambient sound buffers tied to a specific map are stopped and their memory freed when transitioning to a new zone.
- **WebGPU Context:** Ensure the Kokoro/LLM WebGPU context doesn't leak memory during heavy combat/vendor interactions (verify `dispose` or `destroy` is called on old inference sessions if applicable).

## State & Data Models

- No new schemas. We are reinforcing the existing `GameSaveService` pipeline.

## Acceptance Criteria

### AC-1: Zone Transition Auto-Save
**Given** a player is exploring the world
**When** they transition from one map/zone to another
**Then** the game automatically serializes their current state and saves it to IndexedDB without requiring manual input.

### AC-2: Auto-Save UI Feedback
**Given** an auto-save is triggered
**When** the save is processing
**Then** a brief, non-intrusive "Auto-Saving..." notification or icon appears in the UI and disappears upon completion.

### AC-3: PixiJS Asset Cleanup
**Given** the player transitions between multiple maps
**When** profiling memory usage in Chrome DevTools
**Then** the GPU and JS Heap memory should stabilize and not exhibit a staircase memory leak pattern (old map textures must be destroyed).

### AC-4: Audio Buffer Cleanup
**Given** a map has specific background music
**When** the player leaves that map
**Then** the old audio buffer is stopped and dereferenced to free memory.

**Test Hooks**:
- Unit: Verify `GameSaveService.saveGame()` is called exactly once during the `loadMap` sequence.
- Manual: Watch the Chrome DevTools Memory tab and take Heap Snapshots before and after loading 5 different maps to verify garbage collection.

**Watch Points**:
- **Texture Caching:** Be careful not to destroy textures that are globally shared (like the UI, Player Sprite, or common UI icons). Only destroy map-specific assets (like Tiled tilesets).
- **Save State Integrity:** Ensure the auto-save captures the player's *new* coordinates in the new map, not their *old* coordinates from the previous map, otherwise they will be stuck in a load loop.

## Implementation Notes

1. **Files to modify**:
    - `packages/frontend/engine/src/core/game_world.ts` (or equivalent map loading system)
    - `apps/frontend/client/src/lib/services/game/game_save_service.svelte.ts` 
    - `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts` (for the auto-save toast)
    - `packages/frontend/engine/src/services/audio_service.ts` (audit)
2. **Order of operations**:
    - Implement the Auto-Save hook on map load completion.
    - Add the UI feedback.
    - Perform the memory audit and implement explicit `destroy()` calls on map unloads.
