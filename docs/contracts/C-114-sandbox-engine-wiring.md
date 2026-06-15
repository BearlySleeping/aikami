## Metadata

| Field | Value |
|---|---|
| **Source** | Aikami reference: `knowledge/contracts/TEMPLATE.md` |
| **Target** | `apps/frontend/client/src/lib/views/dev/sandbox/` — Dev Sandbox Game Engine Integration |
| **Priority** | P1 — Essential for the vertical slice and validating the Web Worker ECS engine inside the Svelte UI. |
| **Dependencies** | `@aikami/engine` (`packages/frontend/engine`) |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Overview

Currently, `sandbox_view.svelte` initializes a raw PixiJS application rendering static rectangles. This contract wires up the actual `GameWorld` class and `EngineBridge` from our frontend engine package. We will instantiate the bitECS Web Worker, spawn a player, spawn an NPC, and allow the user to walk around and trigger an interaction event that reflects in the Svelte ViewModel.

## Design Reference

**Aikami pattern**: `packages/frontend/engine/src/game_world.ts`

Key structural elements:
- Use `createEngineBridge()` to establish the command/event channel.
- Instantiate `GameWorld` and pass it the `<canvas>` reference from Svelte.
- Use Svelte 5 runes (`$state`, `$effect`) in `sandbox_view_model.svelte.ts` to manage the engine lifecycle and react to interaction callbacks.

## Changes Detail

1. **`sandbox_view_model.svelte.ts`**:
   - Add properties for `engineBridge` and `gameWorld`.
   - Expose an `initializeEngine(canvas: HTMLCanvasElement)` method.
   - Expose a `$state` variable (e.g., `interactionMessage`) to display when the user interacts with an NPC.
   - Implement cleanup logic to call `gameWorld.destroy()` on unmount.

2. **`sandbox_view.svelte`**:
   - Remove the raw PixiJS boilerplate (`new Application()`, `Graphics()`, FPS counter).
   - In `onMount`, pass the bound `canvasElement` to `viewModel.initializeEngine()`.
   - Add a temporary HTML UI overlay that reacts to `viewModel.interactionMessage` to prove the interaction bridge works.

3. **`GameWorld` Initialization logic**:
   - Once initialized, emit commands via the bridge to spawn an NPC at a specific coordinate (if the worker doesn't spawn one by default).
   - Hook `gameWorld.onInteractRequest((npc) => { ... })` to update the ViewModel's state.

## Acceptance Criteria

### AC-1: Engine Initialization
**Given** the developer navigates to `/dev/sandbox`
**When** the component mounts
**Then** the PixiJS canvas renders the player (as defined by the engine's current `ENTITY_CREATED` logic) without crashing.

**Test Hooks**:
- Unit: ViewModel's `initializeEngine` creates `GameWorld`.
- Integration: Dev tools show the `ecs_worker.ts` web worker is running.

### AC-2: Player Movement
**Given** the engine is running
**When** the user presses `W/A/S/D` or `Arrow Keys`
**Then** the player entity moves across the canvas.

**Test Hooks**:
- Manual/Visual: Observe position updates on the canvas.

### AC-3: NPC Interaction
**Given** the player is moved near the spawned NPC
**When** the user presses `E` or `Enter`
**Then** the `interactRequestCallback` fires, and a Svelte HTML overlay displays "Interacting with [NPC_NAME]".

**Test Hooks**:
- Integration: Triggering the 'E' keydown event near the NPC updates the Svelte 5 `$state`.

**Watch Points**:
- The worker might need explicit instructions to spawn the NPC if `INITIALIZE_ENGINE` doesn't do it automatically. Use the bridge `SPAWN_NPC` command if necessary.

## Implementation Notes

1. **Files to modify**: 
   - `apps/frontend/client/src/lib/views/dev/sandbox/sandbox_view.svelte`
   - `apps/frontend/client/src/lib/views/dev/sandbox/sandbox_view_model.svelte.ts`
2. **Order of operations**: 
   - Update ViewModel to support `GameWorld` injection.
   - Rip out raw PixiJS code from the Svelte view and replace with `viewModel.initializeEngine(canvasElement)`.
   - Add the interaction callback hook in the ViewModel.
   - Add the Svelte markup to display the interaction state.
3. **Verification**: Navigate to `/dev/sandbox`, ensure the player square appears, walk up to the NPC square, press `E`, and verify the UI updates.

## Edge Cases & Gotchas

- **Canvas Size**: The canvas might not have correct dimensions immediately on mount. Ensure the CSS gives it explicit width/height or use a `ResizeObserver` if necessary, passing `canvas.clientWidth` to the PixiAppOptions.
- **Worker Path Resolution**: Ensure Vite resolves the `new Worker(new URL(..., import.meta.url))` correctly when instantiated from within the `@aikami/engine` package inside the SvelteKit app.
