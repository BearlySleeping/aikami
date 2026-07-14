<!-- completed: 2026-06-29 -->
<!-- audit: legacy — no execution report -->
# Contract: C-124 Game Engine Initialization & Overlay Base

## Goal
Initialize the ECS worker and PixiJS canvas on the `/game` route, spawn the player's active persona into the world, and establish the base HTML structure for Z-indexed UI overlays.

## Context
The user has finished character creation and navigated to `/game`. We need to tear down the Svelte-heavy DOM of SvelteKit's layout, mount the WebGL canvas natively to the edges of the screen, start the Web Worker for the ECS, and inject the character data. We also must establish the overlay container so that when the ECS enters a state like `COMBAT`, Svelte can mount the Combat UI *over* the canvas without unmounting the game world.

## Tasks

1. **Wire the `/game` Route:**
   - Update `src/routes/game/+page.svelte` to instantiate and render the core game view (e.g., `src/lib/views/game/canvas/game_view.svelte` and its ViewModel).

2. **Setup the HTML/CSS Overlay Structure:**
   - In `game_view.svelte`, structure the DOM to have two distinct layers:
     ```html
     <div class="relative w-screen h-screen overflow-hidden">
       <div id="game-canvas-container" class="absolute inset-0 z-0"></div>
       
       <div id="game-ui-layer" class="absolute inset-0 z-10 pointer-events-none">
          </div>
     </div>
     ```

3. **Initialize Engine & Load Persona:**
   - In `GameViewModel` (or equivalent initialization logic), fetch the active character from `PersonaRepository`.
   - Initialize the `EngineBridge` / `PixiApp`.
   - Dispatch an event/command to the ECS to spawn the player at a default coordinate, passing in the Name, Stats, and Appearance/Avatar data from the Persona.
   - *Note: If a `GameWorld` sandbox script already handles map generation, reuse it or call it here to generate the base environment.*

4. **Handle Resize & Cleanup:**
   - Ensure the Svelte component handles `onDestroy` cleanly (terminating the ECS worker and destroying the PixiJS application to prevent memory leaks if they navigate back to the Start Menu).
   - Ensure the canvas resizes correctly to the window.

## Out of Scope
- Actually building the Combat or Trading Svelte views (we are just making the container for them).
- Complex map generation or loading tiled maps from Firebase (a hardcoded sandbox grid/map is fine for this step).

## Acceptance Criteria
- Navigating from `/setup` to `/game` successfully boots the engine.
- A player sprite is visible on the screen, representing the active persona.
- Svelte UI elements can be rendered on top of the canvas without interfering with the WebGL context.
- The `pointer-events-none` on the UI layer correctly allows clicks to pass through to the game canvas, unless clicking on an explicit UI button (`pointer-events-auto`).
- Typechecks and builds pass.
