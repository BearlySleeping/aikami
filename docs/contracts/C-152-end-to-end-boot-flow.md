<!-- completed: 2026-06-29 -->
<!-- audit: legacy — no execution report -->
## Metadata

| Field | Value |
|---|---|
| **Source** | Roadmap Phase 1: The Player Journey |
| **Target** | `apps/frontend/client/src/lib/views/` — End-to-End Boot Flow |
| **Priority** | P2 — Ties isolated sandboxes into a seamless player journey |
| **Dependencies** | C-121, C-123, C-132, C-138 |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Overview

This contract stitches together the Main Menu, Character Creation, and the Starting Map to create a seamless end-to-end boot flow. It ensures that clicking "New Game" leads to character creation and drops the player into the world with a fresh state, while "Continue" bypasses character creation and loads the player's saved IndexedDB state.

## Design Reference

We will build upon the existing `StartViewModel`, `CharacterViewModel`, and `GameViewModel` patterns, utilizing SvelteKit client-side routing via `RouterService`.

## Architecture Directives

- **Start Menu Updates:** Modify the `StartViewModel` to accurately distinguish between "New Game" and "Continue" based on the existence of save data. "New Game" should navigate to `/setup` (Character Creation).
- **Character Creation Completion:** Upon completing character creation in `CharacterViewModel`, the `enterWorld()` method should trigger the engine to spawn a fresh player entity, reset any stale inventory/state, and load the `starting_zone` map.
- **Continue Flow:** The "Continue" action in `StartViewModel` (or `MenuViewModel` depending on current wiring) should load the saved snapshot payload from `GameSaveService`, pass it via `GameLoadState`, and transition directly to `/game`.
- **State Reset:** Ensure that when starting a "New Game", `GameStateService` arrays (inventory, defeatedEnemies, quests) are cleared so previous play sessions do not leak into the new game.

## State & Data Models

No major schema changes. We will be interacting with existing models:
- `GameStateService`
- `GameSaveService`
- `GameWorld` initialization options.

## Acceptance Criteria

### AC-1: New Game Flow
**Given** the user is on the Start Menu and has no active save (or chooses New Game)
**When** the user clicks "New Game"
**Then** the user is routed to `/setup`

### AC-2: Enter World from Setup
**Given** the user has completed character creation on `/setup`
**When** the user clicks "Enter World"
**Then** `GameStateService` is cleared of stale data, the user is routed to `/game`, and the engine loads the starting map with a fresh player entity

### AC-3: Continue Game Flow
**Given** the user is on the Start Menu and has an existing IndexedDB save
**When** the user clicks "Continue"
**Then** the user is routed directly to `/game`, and the engine hydrates the player entity, inventory, and location from the save payload

**Test Hooks**:
- Unit: Update `StartViewModel` and `CharacterViewModel` tests to verify routing behavior and state reset calls.
- Integration: N/A
- CI: Standard build and typechecks.

**Watch Points**:
- Ensure `GameStateService` clears out `inventory` and `defeatedEnemies` on a New Game, otherwise state from a previous run or an aborted game might leak in.

## Implementation Notes

1. **Files to modify**:
    - `apps/frontend/client/src/lib/views/start/start_view_model.svelte.ts` (Add logic to check for saves and route "New Game" to `/setup`)
    - `apps/frontend/client/src/lib/views/start/start_view.svelte` (Update UI to reflect New Game vs Continue)
    - `apps/frontend/client/src/lib/views/character/create/character_view_model.svelte.ts` (Update `enterWorld` to reset `gameStateService` and pass initialization intent)
    - `apps/frontend/client/src/lib/services/game/game_state_service.svelte.ts` (Add a `reset()` method to clear arrays)
2. **Order of operations**:
    - Add `reset()` to `GameStateService`.
    - Update `StartViewModel` and UI for New Game / Continue branching.
    - Wire `CharacterViewModel.enterWorld()` to call `GameStateService.reset()` and route to `/game` with a fresh start intent.

## Edge Cases & Gotchas

- **Stale State Leakage**: If a user plays a game, quits to main menu, and hits "New Game", `GameStateService` (which is a singleton) will still hold their old inventory and defeated enemies. The explicit `reset()` call is critical.
- **Save Payload Hydration**: Ensure that the "Continue" flow accurately bypasses the fresh player initialization in `GameWorld.initialize()` if a `loadPayload` is provided.
