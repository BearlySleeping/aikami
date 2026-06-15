# Contract: C-125 Game UI Overlay Architecture & State Sync

## Goal
Establish a reactive bridge between the ECS worker and the Svelte UI layer, allowing the game to dynamically mount UI overlays (like Pause Menu, Dialogue, or Combat) over the WebGL canvas without navigating to a new route.

## Context
In C-124, we created the `#game-ui-layer` container. Now we need a `GameUIViewModel` that listens to state changes emitted by the `EngineBridge` (or a dedicated `GameStateSync` service) and reactively mounts the correct Svelte components. For this MVP step, we will implement the foundational overlay router and a basic Pause Menu to allow the user to exit back to the Start Menu.

## Tasks

1. **Establish `GameStateSync` (if not already fully wired):**
   - Ensure there is a reactive service (e.g., `GameStateService.svelte.ts` or similar) that listens to messages from the `EngineBridge`.
   - It should expose a reactive `$state` property like `activeOverlay` (e.g., `'NONE' | 'PAUSE_MENU' | 'DIALOGUE' | 'COMBAT'`).

2. **Create the Game UI Controller:**
   - Create a new directory: `src/lib/views/game/ui/`.
   - Create `game_ui_view_model.svelte.ts`. This ViewModel should inject/reference the `GameStateSync` and handle logic for closing overlays (e.g., pressing `Escape` to close or open the pause menu).
   - Create `game_ui_view.svelte`. This view will live inside the `#game-ui-layer` from C-124. It should use an `{#if}` or `{#switch}` block based on `activeOverlay` to render specific overlay components.

3. **Implement the Pause Menu Overlay:**
   - Create a simple Svelte component (e.g., `src/lib/views/game/ui/overlays/pause_menu_overlay.svelte`).
   - Give it a semi-transparent dark background (`bg-base-300/80 backdrop-blur`) and center a menu with options:
     - **Resume Game** (Sends a message back to the ViewModel to set `activeOverlay = 'NONE'`)
     - **Settings** (For now, can just be a placeholder button or mount the settings component)
     - **Quit to Main Menu** (Calls the router to navigate back to `/`, ensuring `GameViewModel`'s `onDestroy` cleans up the engine).

4. **Wire Inputs:**
   - Ensure the `GameUIViewModel` (or an InputSystem in the ECS) captures the `Escape` key to toggle the `'PAUSE_MENU'` state. If captured in Svelte, it must tell the ECS to pause the physics/entities. If captured in ECS, the ECS must send an event to Svelte to show the menu. (Align with your existing input architecture).

## Out of Scope
- Building the actual Dialogue or Combat overlays (we are just setting up the router and the Pause menu for now).
- Deep settings menu integration inside the game (can defer to a polish contract).

## Acceptance Criteria
- While in the game, pressing `Escape` (or triggering the pause state) mounts the `PauseMenuOverlay` component over the game canvas.
- The game canvas remains visible behind the pause menu.
- Clicking "Resume" hides the menu.
- Clicking "Quit to Main Menu" destroys the game instance and returns the user to the `/` route safely without memory leaks.
- Typechecks and builds pass.
