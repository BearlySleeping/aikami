<!-- completed: 2026-06-29 -->
# Contract: C-118 — Save/Load UI & Engine Boundary

| Metadata | Value |
| --- | --- |
| Source | Architect |
| Target | `apps/frontend/client/src/lib/views` |
| Priority | P1 |
| Dependencies | MIG-002, C-117 |
| Status | completed |
| Version | 1.0.0 |

## Overview
Complete Step 4 of the hybrid cloud save pipeline. Wire the `GameStateSyncService` into the Svelte ViewModels so players can actually save their game from the active game view and load their saved slots from the dashboard/main menu.

## Design Reference
Follow the established MVVM (Model-View-ViewModel) pattern in Svelte 5. The Views (`.svelte` files) handle the UI buttons, the ViewModels (`.svelte.ts` files) orchestrate the logic, calling out to `GameStateSyncService` for cloud operations and `EngineBridge` / `EcsSerializer` for engine memory state.

## Architecture Directives
- **Game View (Save):** Update `game_view_model.svelte.ts` (or the pause menu equivalent) with a `saveGame(slotNumber: number)` method. It must extract the `world` state via `serializeWorld`, generate basic metadata (like current time or location), and push it via `GameStateSyncService`.
- **Dashboard View (Load):** Update `dashboard_view_model.svelte.ts` to load and display available `SaveSlot`s when the user logs in. Implement a `loadGame(slot: SaveSlot)` method that fetches the blob and routes the user into the game, passing the payload to `deserializeWorld`.
- **Loading States:** Ensure ViewModels track saving/loading `$state` so the UI can show a spinner. We are doing network requests here, so the user needs visual feedback.

## State & Data Models
    // Expected ViewModel extensions
    class GameViewModel {
        isSaving = $state(false);
        async saveGame(slotNumber: number) { ... }
    }
    
    class DashboardViewModel {
        saveSlots = $state<SaveSlot[]>([]);
        isLoadingSlots = $state(true);
        async loadSlots() { ... }
        async resumeGame(slot: SaveSlot) { ... }
    }

## Acceptance Criteria
- **Given** a player is active in the game world,
- **When** they trigger `saveGame(1)` via the UI/ViewModel,
- **Then** the UI shows a loading state, the `EcsSerializer` generates a payload, and `GameStateSyncService` successfully uploads it without crashing the game loop.
- [Test Hook] Ensure the ViewModel state correctly toggles `isSaving` true/false during the operation.

- **Given** a player is on the dashboard with existing save data,
- **When** the dashboard mounts,
- **Then** it displays their saved slots.
- **When** they click "Resume" on a slot,
- **Then** the game view loads, fetches the blob, and successfully hydrates the ECS world.

## Implementation Notes
1. Inject `GameStateSyncService` into `GameViewModel` and `DashboardViewModel`.
2. In `GameViewModel.saveGame`:
   - Set `isSaving = true`.
   - Call `serializeWorld(this.engineBridge.world)`.
   - Await `gameStateSyncService.saveGame(uid, slot, payload, metadata)`.
   - Set `isSaving = false` and show a success toast/snackbar if available.
3. In `DashboardViewModel`:
   - On init/mount, call `gameStateSyncService.listSlots(uid)` and populate the `$state` array.
   - Implement the resume flow: fetch payload -> set shared state -> navigate to `/game` -> `GameWorld` initializes with payload.

## Edge Cases & Gotchas
- **Cross-Route Payload Handoff:** When loading a game from the dashboard, you have to transition from the Dashboard route to the Game route while holding onto the downloaded ECS payload. You might need to put the downloaded payload into a temporary app-level store or `GameStateService` so the `GameViewModel` can pick it up when the route mounts.
- **Save Scumming/Spamming:** Disable the save button while `isSaving` is true to prevent users from firing 10 simultaneous Firebase Storage uploads.
